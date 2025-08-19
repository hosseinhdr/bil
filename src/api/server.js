import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import logger from '../utils/logger.js';
import compression from 'compression';
import { rateMonitor } from '../middleware/smartRateMonitor.js';
import {
    globalRateLimiter,
    rateLimiters,
    getRateLimitStatus,
    resetRateLimit
} from '../middleware/rateLimiter.js';
import { SessionAuthAPI } from './sessionAuth.js';
import { AutoOptimizer } from '../services/AutoOptimizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class APIServer {
    constructor(telegramManager, database, monitoringService, operationQueue, config) {
        this.app = express();
        this.telegramManager = telegramManager;
        this.database = database;
        this.monitoringService = monitoringService;
        this.operationQueue = operationQueue;
        this.config = config;
        this.server = null;

        this.sessionAuthAPI = new SessionAuthAPI(database, config);
        this.rateMonitor = rateMonitor;

        // Initialize Auto-Optimizer
        this.autoOptimizer = new AutoOptimizer(telegramManager, database);

        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        this.app.use(compression());
        this.app.use(express.json({ limit: '1mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));

        this.app.use(cors({
            origin: this.config?.server?.corsOrigin || '*',
            credentials: true,
            maxAge: 86400
        }));

        this.app.use(globalRateLimiter);

        this.app.use((req, res, next) => {
            if (req.path.startsWith('/api/')) {
                logger.info(`${req.method} ${req.path} from ${req.ip}`);
            }
            next();
        });

        const staticOptions = {
            maxAge: '1d',
            etag: true,
            lastModified: true
        };

        this.app.use(express.static(path.join(__dirname, '../../public'), staticOptions));
    }

    setupRoutes() {
        // API Key validation middleware
        const validateApiKey = async (req, res, next) => {
            const apiKey = req.headers['x-api-key'] || req.query.api_key;

            if (!apiKey) {
                return res.status(401).json({
                    success: false,
                    error: 'API key required'
                });
            }

            try {
                const isValid = await this.database.validateApiKey(apiKey);

                if (!isValid) {
                    return res.status(401).json({
                        success: false,
                        error: 'Invalid API key'
                    });
                }

                req.apiKey = apiKey;
                req.validatedApiKey = isValid;
                next();
            } catch (error) {
                logger.error('API key validation error:', error);
                res.status(500).json({
                    success: false,
                    error: 'Authentication error'
                });
            }
        };

        const requireAdmin = async (req, res, next) => {
            const apiKey = req.headers['x-api-key'] || req.query.api_key;
            const isMaster = await this.database.isMasterKey(apiKey);

            if (!isMaster) {
                return res.status(403).json({
                    success: false,
                    error: 'Admin access required'
                });
            }

            next();
        };

        // Public Routes
        this.app.get('/', (req, res) => res.redirect('/login'));
        this.app.get('/login', (req, res) => {
            res.sendFile(path.join(__dirname, '../../public/admin-login.html'));
        });
        this.app.get('/admin', (req, res) => {
            res.sendFile(path.join(__dirname, '../../public/index.html'));
        });

        this.app.get('/api', (req, res) => {
            res.json({
                name: 'Telegram Channel Manager API',
                version: '2.2.0',
                status: 'operational'
            });
        });

        this.app.get('/health', async (req, res) => {
            try {
                const health = await this.getHealthStatus();
                res.json(health);
            } catch (error) {
                res.status(500).json({
                    status: 'error',
                    error: error.message
                });
            }
        });

        // Swagger documentation
        this.app.use('/api-docs', swaggerUi.serve);
        this.app.get('/api-docs', (req, res, next) => {
            try {
                const swaggerDocument = YAML.load(path.join(__dirname, '../../docs/swagger.yaml'));
                swaggerUi.setup(swaggerDocument)(req, res, next);
            } catch (error) {
                logger.error('Failed to load Swagger:', error);
                res.status(500).send('Documentation not available');
            }
        });

        // Metrics
        this.app.get('/metrics', (req, res) => {
            if (!this.monitoringService) {
                return res.status(503).send('Monitoring service not available');
            }

            const metrics = this.monitoringService.getPrometheusMetrics();
            res.set('Content-Type', 'text/plain');
            res.send(metrics);
        });

        // Session Authentication Routes
        this.sessionAuthAPI.setupRoutes(this.app, requireAdmin);

        // ===== NEW: Auto-Optimization Routes =====

        // Get optimization status
        this.app.get('/api/session/optimize/status', validateApiKey, async (req, res) => {
            try {
                const status = await this.autoOptimizer.getStatus();
                res.json({
                    success: true,
                    data: status
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Run optimization
        this.app.post('/api/session/optimize', validateApiKey, async (req, res) => {
            try {
                const { type = 'balance' } = req.body;
                const result = await this.autoOptimizer.optimize(type);

                res.json({
                    success: true,
                    result
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Get optimization suggestions
        this.app.get('/api/session/optimize/suggestions', validateApiKey, async (req, res) => {
            try {
                const suggestions = await this.autoOptimizer.getSuggestions();
                res.json({
                    success: true,
                    suggestions
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // ===== NEW: Performance Monitoring Routes =====

        // Get performance metrics
        this.app.get('/api/monitoring/performance', validateApiKey, async (req, res) => {
            try {
                const { period = '1h' } = req.query;
                const metrics = await this.getPerformanceMetrics(period);

                res.json({
                    success: true,
                    data: metrics
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Get rate limit metrics
        this.app.get('/api/monitoring/rate-limits', validateApiKey, async (req, res) => {
            try {
                const limits = this.rateMonitor.getStats();
                res.json({
                    success: true,
                    data: limits
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // ===== NEW: Alert Configuration Routes =====

        // Get alert configuration
        this.app.get('/api/alerts/config', validateApiKey, async (req, res) => {
            try {
                const config = await this.database.getAlertConfig();
                res.json({
                    success: true,
                    config
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Update alert configuration
        this.app.post('/api/alerts/config', validateApiKey, async (req, res) => {
            try {
                const config = req.body;
                await this.database.saveAlertConfig(config);

                res.json({
                    success: true,
                    message: 'Alert configuration updated'
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Get active alerts
        this.app.get('/api/alerts/active', validateApiKey, async (req, res) => {
            try {
                const alerts = await this.database.getActiveAlerts();
                res.json({
                    success: true,
                    alerts
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Acknowledge alert
        this.app.post('/api/alerts/:alertId/acknowledge', validateApiKey, async (req, res) => {
            try {
                const { alertId } = req.params;
                await this.database.acknowledgeAlert(alertId);

                res.json({
                    success: true,
                    message: 'Alert acknowledged'
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // ===== Existing Routes =====

        this.app.get('/api/session/status', validateApiKey, async (req, res) => {
            try {
                const status = await this.telegramManager.getSessionsStatus();
                res.json(status);
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Channel operations
        this.app.post('/api/channel/join',
            validateApiKey,
            rateLimiters.join,
            async (req, res) => {
                try {
                    const { channel } = req.body;

                    if (!channel) {
                        return res.status(400).json({
                            success: false,
                            error: 'Channel parameter required'
                        });
                    }

                    const result = await this.telegramManager.joinChannel(channel);
                    res.json(result);

                } catch (error) {
                    res.status(500).json({
                        success: false,
                        error: error.message
                    });
                }
            }
        );

        this.app.post('/api/channel/leave',
            validateApiKey,
            rateLimiters.leave,
            async (req, res) => {
                try {
                    const { channelId, sessionName } = req.body;

                    if (!channelId) {
                        return res.status(400).json({
                            success: false,
                            error: 'Channel ID required'
                        });
                    }

                    const result = await this.telegramManager.leaveChannel(channelId, sessionName);
                    res.json(result);

                } catch (error) {
                    res.status(500).json({
                        success: false,
                        error: error.message
                    });
                }
            }
        );

        this.app.get('/api/channel/info',
            validateApiKey,
            rateLimiters.info,
            async (req, res) => {
                try {
                    const { channel } = req.query;

                    if (!channel) {
                        return res.status(400).json({
                            success: false,
                            error: 'Channel parameter required'
                        });
                    }

                    const result = await this.telegramManager.getChannelInfo(channel);
                    res.json(result);

                } catch (error) {
                    res.status(500).json({
                        success: false,
                        error: error.message
                    });
                }
            }
        );

        this.app.get('/api/channel/list',
            validateApiKey,
            rateLimiters.list,
            async (req, res) => {
                try {
                    const result = await this.telegramManager.listAllChannels();
                    res.json(result);
                } catch (error) {
                    res.status(500).json({
                        success: false,
                        error: error.message
                    });
                }
            }
        );

        this.app.post('/api/channel/cleanup',
            validateApiKey,
            rateLimiters.cleanup,
            async (req, res) => {
                try {
                    const { days = 7 } = req.body;
                    const result = await this.telegramManager.leaveInactiveChannels(days);
                    res.json(result);
                } catch (error) {
                    res.status(500).json({
                        success: false,
                        error: error.message
                    });
                }
            }
        );

        // API Key Management
        this.app.post('/api/keys/generate', requireAdmin, async (req, res) => {
            try {
                const { name, description } = req.body;

                if (!name) {
                    return res.status(400).json({
                        success: false,
                        error: 'Name is required'
                    });
                }

                const result = await this.database.generateApiKey(name, description);
                res.json(result);
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        this.app.post('/api/keys/recover', async (req, res) => {
            try {
                const { name, recoveryToken } = req.body;

                if (!name || !recoveryToken) {
                    return res.status(400).json({
                        success: false,
                        error: 'Name and recovery token required'
                    });
                }

                const result = await this.database.recoverApiKey(name, recoveryToken);
                res.json(result);
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Monitoring endpoints
        this.app.get('/api/monitoring/status', validateApiKey, (req, res) => {
            if (!this.monitoringService) {
                return res.status(503).json({
                    success: false,
                    error: 'Monitoring service not available'
                });
            }

            res.json({
                success: true,
                data: this.monitoringService.getStats()
            });
        });

        this.app.get('/api/monitoring/realtime', validateApiKey, async (req, res) => {
            try {
                const realtime = await this.getRealtimeMetrics();
                res.json({
                    success: true,
                    data: realtime
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Rate limit status
        this.app.get('/api/ratelimit/status', validateApiKey, getRateLimitStatus);

        // 404 handler
        this.app.use((req, res) => {
            if (req.path.startsWith('/api/')) {
                res.status(404).json({
                    success: false,
                    error: 'Endpoint not found'
                });
            } else {
                res.redirect('/login');
            }
        });

        // Error handler
        this.app.use((err, req, res, next) => {
            logger.error('Express error:', err);
            res.status(500).json({
                success: false,
                error: 'Internal server error'
            });
        });
    }

    async getHealthStatus() {
        const health = {
            status: 'healthy',
            timestamp: new Date(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            services: {}
        };

        health.services.database = {
            connected: this.database?.isConnected || false
        };

        const sessions = this.telegramManager?.sessions || [];
        health.services.telegram = {
            totalSessions: sessions.length,
            connectedSessions: sessions.filter(s => s.isConnected).length
        };

        health.services.monitoring = {
            active: this.monitoringService?.isRunning || false
        };

        const memoryUsageMB = health.memory.rss / (1024 * 1024);
        if (memoryUsageMB > 800) {
            health.status = 'degraded';
            health.warning = 'High memory usage';
        }

        if (!health.services.database.connected ||
            health.services.telegram.connectedSessions === 0) {
            health.status = 'degraded';
        }

        return health;
    }

    async getRealtimeMetrics() {
        const sessions = await this.telegramManager.getSessionsStatus();
        const capacity = await this.telegramManager.getCapacityStats();
        const performance = this.monitoringService ? this.monitoringService.getStats() : {};

        return {
            timestamp: new Date(),
            sessions: sessions.data,
            capacity,
            performance,
            health: await this.getHealthStatus()
        };
    }

    async getPerformanceMetrics(period) {
        // Get metrics based on period
        const now = Date.now();
        let startTime;

        switch(period) {
            case '1h':
                startTime = now - 3600000;
                break;
            case '24h':
                startTime = now - 86400000;
                break;
            case '7d':
                startTime = now - 604800000;
                break;
            default:
                startTime = now - 3600000;
        }

        // Get metrics from database
        const metrics = await this.database.getPerformanceMetrics(startTime, now);

        return {
            period,
            startTime: new Date(startTime),
            endTime: new Date(now),
            metrics
        };
    }

    async start() {
        const port = process.env.API_PORT || 3000;
        const host = process.env.API_HOST || '0.0.0.0';

        return new Promise((resolve, reject) => {
            this.server = this.app.listen(port, host, () => {
                logger.info(`🌐 API Server running at http://${host}:${port}`);
                logger.info(`📚 API Documentation at http://${host}:${port}/api-docs`);
                logger.info(`🎛️ Admin Panel at http://${host}:${port}/admin`);
                resolve();
            });

            this.server.keepAliveTimeout = 5000;
            this.server.headersTimeout = 10000;
            this.server.on('error', reject);
        });
    }

    async stop() {
        if (this.server) {
            return new Promise((resolve) => {
                this.server.close(() => {
                    logger.info('API Server stopped');
                    resolve();
                });
            });
        }
    }
}

export default APIServer;