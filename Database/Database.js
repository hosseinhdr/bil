const mysql = require('mysql2/promise');
const Logger = require('../src/Core/Logger');

class Database {
    constructor(config) {
        this.config = {
            host: config.host || 'localhost',
            port: config.port || 3306,
            user: config.user || 'root',
            password: config.password || '',
            database: config.database || 'telegram_db',

            // Pool configuration - OPTIMIZED
            waitForConnections: true,
            connectionLimit: 5,  // Reduced from 10 to 5
            maxIdle: 3,          // max idle connections
            idleTimeout: 60000,  // idle connections timeout
            queueLimit: 0,
            enableKeepAlive: true,
            keepAliveInitialDelay: 0,

            // Timeouts
            connectTimeout: 20000,
            timeout: 60000,

            // Other settings
            timezone: '+00:00',
            charset: 'utf8mb4',

            // Automatic reconnect
            autoReconnect: true,
            reconnectInterval: 2000
        };

        this.pool = null;
        this.logger = new Logger('Database');
        this.isConnected = false;

        // Statistics
        this.stats = {
            totalQueries: 0,
            failedQueries: 0,
            activeConnections: 0,
            idleConnections: 0
        };

        // Query queue for rate limiting
        this.queryQueue = [];
        this.isProcessingQueue = false;
        this.maxQueueSize = 100;
        this.queryDelay = 50; // ms between queries

        // Connection monitor
        this.monitorInterval = null;

        // Allowed tables for security
        this.allowedTables = [
            'detections', 'insightHistories', 'pushList',
            'campaigns', 'media', 'contents', 'campaignContents'
        ];
    }

    async connect() {
        try {
            this.logger.info('Creating database connection pool...');

            // Create the pool with optimized settings
            this.pool = mysql.createPool(this.config);

            // Test connection
            const connection = await this.pool.getConnection();

            // Set session variables for optimization
            await connection.execute("SET SESSION sql_mode='TRADITIONAL'");
            await connection.execute("SET SESSION wait_timeout=28800");
            await connection.execute("SET SESSION interactive_timeout=28800");

            connection.release();

            this.isConnected = true;

            // Start monitoring
            this.startMonitoring();

            // Start queue processor
            this.startQueueProcessor();

            this.logger.info('Database connected successfully', {
                host: this.config.host,
                database: this.config.database,
                poolSize: this.config.connectionLimit
            });

            return true;

        } catch (error) {
            this.logger.error('Database connection failed', error);
            this.isConnected = false;
            throw error;
        }
    }

    async disconnect() {
        this.logger.info('Closing database connections...');

        // Stop monitoring
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }

        // Clear queue
        this.queryQueue = [];

        // Close pool
        if (this.pool) {
            try {
                await this.pool.end();
                this.logger.info('Database pool closed');
            } catch (error) {
                this.logger.error('Error closing pool', error);
            }
        }

        this.isConnected = false;
        this.pool = null;
    }

    // Main query method with queue and retry logic
    async query(sql, params = [], options = {}) {
        const queryInfo = {
            sql,
            params,
            options,
            retries: 0,
            maxRetries: options.maxRetries || 3
        };

        // Add to queue if too many active queries
        if (this.queryQueue.length >= this.maxQueueSize) {
            this.logger.warn('Query queue full, dropping oldest query');
            this.queryQueue.shift();
        }

        return new Promise((resolve, reject) => {
            this.queryQueue.push({
                ...queryInfo,
                resolve,
                reject,
                timestamp: Date.now()
            });

            if (!this.isProcessingQueue) {
                this.processQueue();
            }
        });
    }

    // Process queued queries with rate limiting
    async processQueue() {
        if (this.isProcessingQueue || this.queryQueue.length === 0) return;

        this.isProcessingQueue = true;

        while (this.queryQueue.length > 0) {
            const item = this.queryQueue.shift();

            // Skip old queries (older than 30 seconds)
            if (Date.now() - item.timestamp > 30000) {
                item.reject(new Error('Query timeout in queue'));
                continue;
            }

            try {
                const result = await this.executeQuery(item);
                item.resolve(result);
            } catch (error) {
                item.reject(error);
            }

            // Rate limiting
            if (this.queryQueue.length > 0) {
                await new Promise(resolve => setTimeout(resolve, this.queryDelay));
            }
        }

        this.isProcessingQueue = false;
    }

    // Execute single query with retry logic
    async executeQuery(queryInfo) {
        const { sql, params, options, retries, maxRetries } = queryInfo;

        let connection = null;
        const timer = this.logger.startTimer();

        try {
            // Check pool health
            if (!this.pool) {
                throw new Error('Database pool not initialized');
            }

            // Get connection with timeout
            connection = await Promise.race([
                this.pool.getConnection(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Connection timeout')), 10000)
                )
            ]);

            this.stats.totalQueries++;

            // Execute query
            const [rows] = await connection.execute(sql, params);

            // Log slow queries
            const duration = this.logger.endTimer(timer, 'Query execution');
            if (duration > 1000) {
                this.logger.warn('Slow query detected', {
                    duration,
                    sql: sql.substring(0, 100)
                });
            }

            return rows;

        } catch (error) {
            this.stats.failedQueries++;

            // Handle specific errors
            if (this.isConnectionError(error)) {
                this.logger.error('Connection error', error);

                if (retries < maxRetries) {
                    this.logger.info(`Retrying query (${retries + 1}/${maxRetries})`);

                    // Exponential backoff
                    const delay = Math.min(1000 * Math.pow(2, retries), 10000);
                    await new Promise(resolve => setTimeout(resolve, delay));

                    // Retry
                    queryInfo.retries++;
                    return this.executeQuery(queryInfo);
                }
            }

            throw error;

        } finally {
            // CRITICAL: Always release connection
            if (connection) {
                try {
                    connection.release();
                } catch (releaseError) {
                    this.logger.error('Failed to release connection', releaseError);

                    // Force destroy if release fails
                    try {
                        connection.destroy();
                    } catch (destroyError) {
                        this.logger.error('Failed to destroy connection', destroyError);
                    }
                }
            }
        }
    }

    // Simplified getData method using the queue
    async getData(query, params = []) {
        try {
            return await this.query(query, params);
        } catch (error) {
            this.logger.error('getData failed', error);
            return [];
        }
    }

    // Optimized insertData with prepared statements
    async insertData(table, data) {
        // Security check
        if (!this.allowedTables.includes(table)) {
            throw new Error(`Table '${table}' is not allowed`);
        }

        // Validate data
        if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
            throw new Error('Invalid data object');
        }

        const keys = Object.keys(data);
        const values = Object.values(data);

        const columns = keys.map(key => `\`${key}\``).join(', ');
        const placeholders = keys.map(() => '?').join(', ');

        const query = `INSERT INTO \`${table}\` (${columns}) VALUES (${placeholders})`;

        try {
            const result = await this.query(query, values);
            return result;
        } catch (error) {
            this.logger.error('insertData failed', error, { table });
            throw error;
        }
    }

    // Optimized updateData
    async updateData(table, data, condition) {
        // Security check
        if (!this.allowedTables.includes(table)) {
            throw new Error(`Table '${table}' is not allowed`);
        }

        // Validate inputs
        if (!data || Object.keys(data).length === 0) {
            throw new Error('Invalid data object');
        }

        if (!condition || Object.keys(condition).length === 0) {
            throw new Error('Invalid condition object');
        }

        const setClause = Object.keys(data).map(key => `\`${key}\` = ?`).join(', ');
        const whereClause = Object.keys(condition).map(key => `\`${key}\` = ?`).join(' AND ');
        const values = [...Object.values(data), ...Object.values(condition)];

        const query = `UPDATE \`${table}\` SET ${setClause} WHERE ${whereClause}`;

        try {
            const result = await this.query(query, values);
            return result;
        } catch (error) {
            this.logger.error('updateData failed', error, { table });
            throw error;
        }
    }

    // Batch insert for better performance
    async batchInsert(table, dataArray) {
        if (!this.allowedTables.includes(table)) {
            throw new Error(`Table '${table}' is not allowed`);
        }

        if (!Array.isArray(dataArray) || dataArray.length === 0) {
            throw new Error('Invalid data array');
        }

        const keys = Object.keys(dataArray[0]);
        const columns = keys.map(key => `\`${key}\``).join(', ');

        const placeholders = dataArray.map(() =>
            `(${keys.map(() => '?').join(', ')})`
        ).join(', ');

        const values = dataArray.flatMap(item => keys.map(key => item[key]));

        const query = `INSERT INTO \`${table}\` (${columns}) VALUES ${placeholders}`;

        try {
            const result = await this.query(query, values);
            return result;
        } catch (error) {
            this.logger.error('batchInsert failed', error, { table, count: dataArray.length });
            throw error;
        }
    }

    // Health check
    async ping() {
        try {
            const result = await this.query('SELECT 1 as ping', [], { maxRetries: 1 });
            return result && result[0]?.ping === 1;
        } catch (error) {
            this.logger.error('Ping failed', error);
            return false;
        }
    }

    // Monitor pool health
    startMonitoring() {
        this.monitorInterval = setInterval(async () => {
            if (!this.pool) return;

            try {
                const poolStats = this.getPoolStats();

                // Log if connections are high
                if (poolStats.activeConnections > this.config.connectionLimit * 0.8) {
                    this.logger.warn('High connection usage', poolStats);
                }

                // Log statistics every 5 minutes
                if (this.stats.totalQueries % 100 === 0) {
                    this.logger.info('Database statistics', {
                        ...this.stats,
                        ...poolStats
                    });
                }

                // Clean up idle connections
                if (poolStats.idleConnections > this.config.maxIdle) {
                    this.logger.info('Cleaning idle connections');
                    await this.pool.query('SELECT 1'); // This forces cleanup
                }

            } catch (error) {
                this.logger.error('Monitoring error', error);
            }
        }, 30000); // Every 30 seconds
    }

    // Get pool statistics
    getPoolStats() {
        if (!this.pool || !this.pool.pool) {
            return {
                activeConnections: 0,
                idleConnections: 0,
                waitingClients: 0
            };
        }

        const pool = this.pool.pool;

        return {
            activeConnections: pool._allConnections.length - pool._freeConnections.length,
            idleConnections: pool._freeConnections.length,
            waitingClients: pool._waitingClients.length,
            totalConnections: pool._allConnections.length,
            connectionLimit: this.config.connectionLimit
        };
    }

    // Check if error is connection-related
    isConnectionError(error) {
        const connectionErrors = [
            'PROTOCOL_CONNECTION_LOST',
            'ECONNREFUSED',
            'ETIMEDOUT',
            'ECONNRESET',
            'ENOTFOUND',
            'ER_CON_COUNT_ERROR',
            'ER_TOO_MANY_USER_CONNECTIONS',
            'ER_USER_LIMIT_REACHED',
            'ER_OUT_OF_RESOURCES',
            'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR'
        ];

        return error.fatal ||
            connectionErrors.includes(error.code) ||
            error.message?.includes('Too many connections');
    }

    // Execute raw query (use with caution)
    async execute(sql, params = []) {
        return this.query(sql, params);
    }

    // Transaction support
    async transaction(callback) {
        let connection = null;

        try {
            connection = await this.pool.getConnection();
            await connection.beginTransaction();

            const result = await callback(connection);

            await connection.commit();
            return result;

        } catch (error) {
            if (connection) {
                await connection.rollback();
            }
            throw error;

        } finally {
            if (connection) {
                connection.release();
            }
        }
    }
}

module.exports = Database;