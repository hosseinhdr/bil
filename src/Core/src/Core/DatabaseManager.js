const Database = require('../../Database/Database');
const Logger = require('./Logger');

class DatabaseManager {
    constructor(config) {
        this.config = config;
        this.database = null;
        this.logger = new Logger('DatabaseManager');

        // Retry configuration
        this.maxRetries = 5;
        this.retryDelay = 5000;
        this.retryCount = 0;

        // Health check
        this.healthCheckInterval = null;
        this.isHealthy = false;
    }

    async initialize() {
        this.logger.info('Initializing database manager');

        try {
            this.database = new Database(this.config);
            await this.connect();

            // Start health monitoring
            this.startHealthCheck();

            return true;
        } catch (error) {
            this.logger.error('Failed to initialize database', error);
            return false;
        }
    }

    async connect() {
        try {
            await this.database.connect();
            this.isHealthy = true;
            this.retryCount = 0;

            this.logger.info('Database connected successfully');

        } catch (error) {
            this.isHealthy = false;

            if (this.retryCount < this.maxRetries) {
                this.retryCount++;

                this.logger.warn(`Connection failed, retrying (${this.retryCount}/${this.maxRetries})`);

                await new Promise(resolve => setTimeout(resolve, this.retryDelay));

                return this.connect();
            }

            throw new Error('Max database connection retries exceeded');
        }
    }

    startHealthCheck() {
        this.healthCheckInterval = setInterval(async () => {
            try {
                const isAlive = await this.database.ping();

                if (!isAlive && this.isHealthy) {
                    this.logger.error('Database connection lost');
                    this.isHealthy = false;

                    // Try to reconnect
                    await this.reconnect();

                } else if (isAlive && !this.isHealthy) {
                    this.logger.info('Database connection restored');
                    this.isHealthy = true;
                }

                // Check pool statistics
                const stats = this.database.getPoolStats();

                if (stats.waitingClients > 0) {
                    this.logger.warn('Clients waiting for connection', stats);
                }

            } catch (error) {
                this.logger.error('Health check failed', error);
            }
        }, 10000); // Every 10 seconds
    }

    async reconnect() {
        this.logger.info('Attempting to reconnect...');

        try {
            if (this.database) {
                await this.database.disconnect();
            }

            await new Promise(resolve => setTimeout(resolve, 2000));

            await this.connect();

        } catch (error) {
            this.logger.error('Reconnection failed', error);
        }
    }

    async executeQuery(query, params = []) {
        if (!this.isHealthy) {
            throw new Error('Database is not healthy');
        }

        try {
            return await this.database.getData(query, params);
        } catch (error) {
            this.logger.error('Query execution failed', error);

            // If connection error, mark as unhealthy
            if (this.database.isConnectionError(error)) {
                this.isHealthy = false;
            }

            throw error;
        }
    }

    async cleanup() {
        this.logger.info('Cleaning up database manager');

        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }

        if (this.database) {
            await this.database.disconnect();
            this.database = null;
        }

        this.isHealthy = false;
    }

    // Proxy methods with health check
    async getData(query, params) {
        return this.executeQuery(query, params);
    }

    async insertData(table, data) {
        if (!this.isHealthy) {
            throw new Error('Database is not healthy');
        }

        return this.database.insertData(table, data);
    }

    async updateData(table, data, condition) {
        if (!this.isHealthy) {
            throw new Error('Database is not healthy');
        }

        return this.database.updateData(table, data, condition);
    }

    async batchInsert(table, dataArray) {
        if (!this.isHealthy) {
            throw new Error('Database is not healthy');
        }

        return this.database.batchInsert(table, dataArray);
    }

    async transaction(callback) {
        if (!this.isHealthy) {
            throw new Error('Database is not healthy');
        }

        return this.database.transaction(callback);
    }

    getStatus() {
        return {
            healthy: this.isHealthy,
            retryCount: this.retryCount,
            stats: this.database ? this.database.getPoolStats() : null,
            queryStats: this.database ? {
                total: this.database.stats.totalQueries,
                failed: this.database.stats.failedQueries
            } : null
        };
    }
}

module.exports = DatabaseManager;