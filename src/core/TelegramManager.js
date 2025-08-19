import { TelegramSession } from './TelegramSession.js';
import { SessionPool } from './SessionPool.js';
import logger from '../utils/logger.js';
import { rateMonitor } from '../middleware/smartRateMonitor.js';

class TelegramManager {
    constructor(config, database, operationQueue) {
        this.config = config;
        this.database = database;
        this.operationQueue = operationQueue;
        this.sessions = [];
        this.sessionPool = null;
        this.isInitialized = false;
        this.rateMonitor = rateMonitor;
    }

    async initialize() {
        logger.info('📱 Initializing Telegram Manager...');

        // Initialize sessions
        for (const sessionConfig of this.config.telegram.sessions) {
            const session = new TelegramSession(
                sessionConfig.name,
                sessionConfig.string,
                this.config.telegram.apiId,
                this.config.telegram.apiHash,
                sessionConfig.isPremium
            );
            this.sessions.push(session);
        }

        // Connect all sessions
        const connectionPromises = this.sessions.map(session => session.connect());
        const results = await Promise.allSettled(connectionPromises);

        const connectedSessions = results.filter(r => r.status === 'fulfilled' && r.value === true);

        if (connectedSessions.length === 0) {
            throw new Error('No sessions could be connected');
        }

        logger.info(`✅ Connected ${connectedSessions.length}/${this.sessions.length} sessions`);

        // Initialize session pool
        const activeSessions = this.sessions.filter(s => s.isConnected);
        if (activeSessions.length > 0) {
            this.sessionPool = new SessionPool(activeSessions);
            logger.info('✅ Session pool initialized');
        }

        this.isInitialized = true;
        return true;
    }

    async joinChannel(channelIdentifier) {
        if (!this.sessionPool) {
            throw new Error('No active sessions available');
        }

        // Queue the operation
        if (this.operationQueue) {
            return new Promise((resolve, reject) => {
                this.operationQueue.add(async () => {
                    try {
                        const result = await this._performJoin(channelIdentifier);
                        resolve(result);
                    } catch (error) {
                        reject(error);
                    }
                }, 8);
            });
        }

        return this._performJoin(channelIdentifier);
    }

    async _performJoin(channelIdentifier) {
        const session = await this.sessionPool.getAvailableSession();

        if (!session) {
            throw new Error('No available sessions with free capacity');
        }

        // Check rate limit
        const canProceed = this.rateMonitor.canPerformOperation('join', session.name);
        if (!canProceed.allowed) {
            throw new Error(`Rate limit: ${canProceed.reason}. Wait ${canProceed.waitTime}ms`);
        }

        try {
            const result = await session.joinChannel(channelIdentifier);

            // Record success
            this.rateMonitor.recordOperation('join', session.name, true);

            // Save to database
            if (this.database?.isConnected) {
                await this.database.registerChannel({
                    id: result.channelId,
                    username: result.channelUsername,
                    title: result.channelTitle,
                    isPublic: !!result.channelUsername
                });

                await this.database.linkSessionToChannel(session.name, result.channelId);
                await this.database.updateSessionChannelCount(session.name, 1);
            }

            logger.info(`✅ Joined channel: ${result.channelTitle} using ${session.name}`);
            return result;

        } catch (error) {
            logger.error(`Failed to join channel: ${error.message}`);
            this.rateMonitor.recordOperation('join', session.name, false, error.message);

            if (error.message.includes('FLOOD_WAIT')) {
                const waitTime = parseInt(error.message.match(/\d+/)?.[0] || 60);
                session.floodWaitUntil = new Date(Date.now() + waitTime * 1000);
            }

            throw error;
        }
    }

    async leaveChannel(channelId, sessionName = null) {
        let session;

        if (sessionName) {
            session = this.getSessionByName(sessionName);
            if (!session) {
                throw new Error(`Session ${sessionName} not found`);
            }
        } else {
            session = await this.findSessionWithChannel(channelId);
            if (!session) {
                throw new Error('Channel not found in any session');
            }
        }

        const canProceed = this.rateMonitor.canPerformOperation('leave', session.name);
        if (!canProceed.allowed) {
            throw new Error(`Rate limit: ${canProceed.reason}. Wait ${canProceed.waitTime}ms`);
        }

        try {
            const result = await session.leaveChannel(channelId);
            this.rateMonitor.recordOperation('leave', session.name, true);

            if (this.database?.isConnected) {
                await this.database.unlinkSessionFromChannel(session.name, channelId);
                await this.database.updateSessionChannelCount(session.name, -1);
            }

            logger.info(`✅ Left channel ${channelId} from ${session.name}`);
            return result;

        } catch (error) {
            logger.error(`Failed to leave channel: ${error.message}`);
            this.rateMonitor.recordOperation('leave', session.name, false, error.message);
            throw error;
        }
    }

    async getChannelInfo(channelIdentifier) {
        const session = this.getFirstConnectedSession();

        if (!session) {
            throw new Error('No connected sessions available');
        }

        try {
            const info = await session.getChannelInfo(channelIdentifier);
            this.rateMonitor.recordOperation('info', session.name, true);
            return { success: true, data: info };
        } catch (error) {
            logger.error(`Failed to get channel info: ${error.message}`);
            this.rateMonitor.recordOperation('info', session.name, false, error.message);
            throw error;
        }
    }

    async listAllChannels() {
        const allChannels = {};
        let totalChannels = 0;

        for (const session of this.sessions) {
            if (!session.isConnected) continue;

            try {
                const channels = await session.listChannels();
                allChannels[session.name] = channels;
                totalChannels += channels.length;
                this.rateMonitor.recordOperation('list', session.name, true);
            } catch (error) {
                logger.error(`Failed to list channels for ${session.name}:`, error.message);
                allChannels[session.name] = [];
                this.rateMonitor.recordOperation('list', session.name, false, error.message);
            }
        }

        return {
            success: true,
            data: {
                total: totalChannels,
                bySession: allChannels
            }
        };
    }

    async leaveInactiveChannels(days = 7) {
        const leftChannels = [];
        let totalLeft = 0;

        for (const session of this.sessions) {
            if (!session.isConnected) continue;

            try {
                const channels = await session.listChannels();
                const now = Date.now();
                const daysInMs = days * 24 * 60 * 60 * 1000;

                for (const channel of channels) {
                    const lastMessageTime = channel.lastMessageDate ?
                        new Date(channel.lastMessageDate * 1000).getTime() : 0;

                    if ((now - lastMessageTime) > daysInMs) {
                        try {
                            await session.leaveChannel(channel.id);
                            leftChannels.push({
                                id: channel.id,
                                title: channel.title,
                                sessionName: session.name
                            });
                            totalLeft++;
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        } catch (error) {
                            logger.error(`Failed to leave channel ${channel.title}:`, error.message);
                        }
                    }
                }
            } catch (error) {
                logger.error(`Failed to process channels for ${session.name}:`, error.message);
            }
        }

        logger.info(`🧹 Cleanup complete: Left ${totalLeft} inactive channels`);
        return { success: true, totalLeft, leftChannels };
    }

    async getSessionsStatus() {
        const status = {
            total: this.sessions.length,
            active: 0,
            inactive: 0,
            totalChannelsUsed: 0,
            totalCapacity: 0,
            sessions: []
        };

        for (const session of this.sessions) {
            const sessionStatus = session.getStatus();

            if (session.isConnected) {
                status.active++;
            } else {
                status.inactive++;
            }

            status.totalChannelsUsed += session.currentChannelsCount;
            status.totalCapacity += session.maxChannels;
            status.sessions.push(sessionStatus);
        }

        return { success: true, data: status };
    }

    async getCapacityStats() {
        const stats = {
            total: { used: 0, max: 0, percentage: 0 },
            sessions: []
        };

        for (const session of this.sessions) {
            stats.total.used += session.currentChannelsCount || 0;
            stats.total.max += session.maxChannels || 0;

            stats.sessions.push({
                name: session.name,
                used: session.currentChannelsCount || 0,
                max: session.maxChannels || 0,
                percentage: session.maxChannels > 0
                    ? Math.round((session.currentChannelsCount / session.maxChannels) * 100)
                    : 0
            });
        }

        if (stats.total.max > 0) {
            stats.total.percentage = Math.round((stats.total.used / stats.total.max) * 100);
        }

        if (this.sessionPool) {
            stats.pool = await this.sessionPool.getPoolStats();
        }

        return stats;
    }

    getSessionByName(name) {
        return this.sessions.find(s => s.name === name);
    }

    getFirstConnectedSession() {
        return this.sessions.find(s => s.isConnected);
    }

    async findSessionWithChannel(channelId) {
        for (const session of this.sessions) {
            if (!session.isConnected) continue;

            try {
                const channels = await session.listChannels();
                if (channels.some(c => c.id === channelId)) {
                    return session;
                }
            } catch (error) {
                logger.debug(`Error checking channels for ${session.name}:`, error.message);
            }
        }
        return null;
    }

    async reconnectSession(sessionName) {
        const session = this.getSessionByName(sessionName);

        if (!session) {
            throw new Error(`Session ${sessionName} not found`);
        }

        const result = await session.reconnect();

        if (this.database?.isConnected) {
            await this.database.updateSessionStatus(
                sessionName,
                result,
                result ? 'healthy' : 'disconnected'
            );
        }

        if (this.sessionPool) {
            if (result) {
                this.sessionPool.addSession(session);
            } else {
                this.sessionPool.removeSession(sessionName);
            }
        }

        return result;
    }

    async shutdown() {
        logger.info('Shutting down Telegram Manager...');

        if (this.sessionPool) {
            this.sessionPool.stopAutoRotation();
        }

        const disconnectPromises = this.sessions.map(async (session) => {
            try {
                await session.disconnect();
            } catch (error) {
                logger.debug(`Error disconnecting ${session.name}:`, error.message);
            }
        });

        await Promise.allSettled(disconnectPromises);
        this.isInitialized = false;
        logger.info('Telegram Manager shut down complete');
    }

    getRateLimitStatus() {
        return this.rateMonitor.getStats();
    }

    getRateLimitRecommendations() {
        return this.rateMonitor.getAllRecommendations();
    }
}

export { TelegramManager };