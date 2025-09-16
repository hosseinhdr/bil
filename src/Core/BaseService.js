const Logger = require('./Logger');

class BaseService {
    constructor(serviceName, config) {
        this.serviceName = serviceName;
        this.config = config;
        this.logger = new Logger(serviceName);

        this.isRunning = false;
        this.shutdownInProgress = false;
        this.startTime = Date.now();

        // Health check
        this.healthCheckInterval = null;
        this.healthCheckFailures = 0;
        this.maxHealthCheckFailures = 3;

        // Memory monitoring
        this.memoryCheckInterval = null;
    }

    async initialize() {
        throw new Error('initialize() must be implemented by subclass');
    }

    async start() {
        if (this.isRunning) {
            this.logger.warn(`${this.serviceName} already running`);
            return;
        }

        this.logger.info(`Starting ${this.serviceName}...`);

        try {
            await this.initialize();
            this.isRunning = true;
            this.startTime = Date.now();

            this.setupHealthCheck();
            this.setupMemoryMonitoring();
            this.setupSignalHandlers();

            this.logger.info(`${this.serviceName} started successfully`);

        } catch (error) {
            this.logger.error(`Failed to start ${this.serviceName}`, error);
            throw error;
        }
    }

    async stop() {
        if (!this.isRunning) {
            this.logger.warn(`${this.serviceName} already stopped`);
            return;
        }

        this.logger.info(`Stopping ${this.serviceName}...`);
        this.isRunning = false;

        // Clear intervals
        this.clearAllIntervals();

        // Subclass cleanup
        await this.cleanup();

        this.logger.info(`${this.serviceName} stopped`);
    }

    async cleanup() {
        // Override in subclass
    }

    setupHealthCheck() {
        this.healthCheckInterval = setInterval(async () => {
            if (!this.isRunning || this.shutdownInProgress) return;

            try {
                await this.performHealthCheck();
                this.healthCheckFailures = 0;
            } catch (error) {
                this.healthCheckFailures++;
                this.logger.error('Health check failed', error, {
                    failures: this.healthCheckFailures
                });

                if (this.healthCheckFailures >= this.maxHealthCheckFailures) {
                    await this.handleHealthCheckFailure();
                }
            }
        }, 30000); // 30 seconds
    }

    async performHealthCheck() {
        // Override in subclass
        return true;
    }

    async handleHealthCheckFailure() {
        this.logger.error('Max health check failures reached, restarting...');
        await this.restart();
    }

    async restart() {
        this.logger.info(`Restarting ${this.serviceName}...`);
        await this.stop();
        await new Promise(resolve => setTimeout(resolve, 5000));
        await this.start();
    }

    setupMemoryMonitoring() {
        this.memoryCheckInterval = setInterval(() => {
            const memUsage = process.memoryUsage();
            const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);

            if (heapUsedMB > 800) {
                this.logger.warn('High memory usage detected', {
                    heap_mb: heapUsedMB
                });

                if (global.gc) {
                    global.gc();
                    this.logger.info('Forced garbage collection');
                }
            }
        }, 60000); // 1 minute
    }

    setupSignalHandlers() {
        const shutdown = async (signal) => {
            if (this.shutdownInProgress) return;

            this.shutdownInProgress = true;
            this.logger.info(`Received ${signal}, shutting down...`);

            await this.stop();

            setTimeout(() => {
                process.exit(0);
            }, 5000);
        };

        process.once('SIGINT', () => shutdown('SIGINT'));
        process.once('SIGTERM', () => shutdown('SIGTERM'));
    }

    clearAllIntervals() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }

        if (this.memoryCheckInterval) {
            clearInterval(this.memoryCheckInterval);
            this.memoryCheckInterval = null;
        }
    }

    getUptime() {
        return Math.floor((Date.now() - this.startTime) / 1000);
    }

    getStatus() {
        const memUsage = process.memoryUsage();

        return {
            service: this.serviceName,
            running: this.isRunning,
            uptime: this.getUptime(),
            memory: {
                heap: Math.round(memUsage.heapUsed / 1024 / 1024),
                rss: Math.round(memUsage.rss / 1024 / 1024)
            },
            healthCheckFailures: this.healthCheckFailures
        };
    }
}

module.exports = BaseService;