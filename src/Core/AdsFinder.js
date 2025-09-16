const BaseService = require('./BaseService');
const NotificationManager = require('./NotificationManager');
const { NewMessage } = require('telegram/events');

class AdsFinder extends BaseService {
    constructor(telegramManager, database, config) {
        super('AdsFinder', config);

        this.telegram = telegramManager;
        this.database = database;
        this.notifications = new NotificationManager(telegramManager, config);

        this.currentUserId = null;
        this.processedMessages = new Map(); // Changed to Map with LRU
        this.maxProcessedMessages = 10000;

        // Statistics
        this.stats = {
            messagesProcessed: 0,
            detectionsFound: 0,
            deletionsDetected: 0
        };

        // Cache
        this.queryCache = new Map();
        this.CACHE_TTL = 5 * 60 * 1000;

        // Status report interval (hourly)
        this.statusReportInterval = null;
    }

    async initialize() {
        // Get current user
        const me = await this.telegram.getMe();
        if (!me) throw new Error('Cannot get user info');

        this.currentUserId = me.id;
        this.logger.info('Initialized', { userId: this.currentUserId });

        // Test database
        await this.testDatabaseConnection();

        // Start services
        await this.setupEventListeners();
        this.startStatusReporting();

        // Initial notification
        await this.notifications.notifyAdmin('✅ AdsFinder شروع به کار کرد');
    }

    async cleanup() {
        if (this.statusReportInterval) {
            clearInterval(this.statusReportInterval);
        }

        await this.removeEventListeners();
        await this.notifications.notifyAdmin('🔴 AdsFinder متوقف شد');

        this.processedMessages.clear();
        this.queryCache.clear();
    }

    async performHealthCheck() {
        const me = await this.telegram.getMe();
        if (!me) throw new Error('Telegram connection lost');

        const dbTest = await this.database.ping();
        if (!dbTest) this.logger.warn('Database ping failed');

        return true;
    }

    startStatusReporting() {
        // Report every hour to admin PV
        this.statusReportInterval = setInterval(async () => {
            const status = this.getStatus();
            status.messagesProcessed = this.stats.messagesProcessed;
            status.detectionsFound = this.stats.detectionsFound;

            await this.notifications.notifyStatus(status);
        }, this.config.statusReportInterval * 60 * 1000);
    }

    async testDatabaseConnection() {
        try {
            const result = await this.database.getData('SELECT 1 as test', []);
            this.logger.info('Database connection tested');
            return true;
        } catch (error) {
            this.logger.error('Database connection failed', error);
            return false;
        }
    }

    async setupEventListeners() {
        const client = this.telegram.client;
        if (!client) throw new Error('Telegram client not initialized');

        const messageHandler = async (event) => {
            if (!this.isRunning) return;

            try {
                const className = event.className || event.constructor.name;

                if (className === 'UpdateNewChannelMessage' || className === 'UpdateNewMessage') {
                    await this.handleChannelMessage(event);
                } else if (className === 'UpdateDeleteChannelMessages') {
                    await this.handleDeletedMessages(event);
                }
            } catch (error) {
                this.logger.error('Event processing failed', error);
            }
        };

        client.addEventHandler(messageHandler);
        this.eventHandler = messageHandler;

        this.logger.info('Event listeners setup completed');
    }

    async removeEventListeners() {
        if (this.telegram.client && this.eventHandler) {
            this.telegram.client.removeEventHandler(this.eventHandler);
            this.logger.info('Event listeners removed');
        }
    }

    async handleChannelMessage(event) {
        const timer = this.logger.startTimer();

        try {
            const message = event.message;
            if (!message || message.out || !message.post) return;

            const channelId = message.peerId.channelId || message.peerId;
            const messageKey = `${channelId}_${message.id}`;

            // LRU cache management
            if (this.processedMessages.has(messageKey)) return;

            if (this.processedMessages.size >= this.maxProcessedMessages) {
                const firstKey = this.processedMessages.keys().next().value;
                this.processedMessages.delete(firstKey);
            }

            this.processedMessages.set(messageKey, Date.now());
            this.stats.messagesProcessed++;

            // Check for forwarded message
            if (message.fwdFrom) {
                const forwardInfo = {
                    channelId: this.cleanChannelId(channelId),
                    messageId: message.id,
                    date: message.date,
                    views: message.views || 0,
                    forwards: message.forwards || 0,
                    fromChannelId: null,
                    fromMessageId: null
                };

                if (message.fwdFrom.fromId) {
                    forwardInfo.fromChannelId = this.cleanChannelId(
                        message.fwdFrom.fromId.channelId || message.fwdFrom.fromId
                    );
                }

                if (message.fwdFrom.channelPost) {
                    forwardInfo.fromMessageId = message.fwdFrom.channelPost;
                }

                if (forwardInfo.fromChannelId && forwardInfo.fromMessageId) {
                    const result = await this.checkForwardedMessage(forwardInfo);

                    if (result.detected) {
                        const channelDetails = await this.getChannelInfo(channelId);
                        result.channelDetails = channelDetails;
                        result.messageLink = this.generateMessageLink(channelId, message.id, channelDetails);
                        result.channelLink = this.generateChannelLink(channelId, channelDetails);

                        await this.saveDetection(result);
                        await this.notifications.notifyAdDetection(result);
                        this.stats.detectionsFound++;
                    }
                }
            }
        } finally {
            this.logger.endTimer(timer, 'Message processing');
        }
    }

    async handleDeletedMessages(event) {
        try {
            const channelId = this.cleanChannelId(event.channelId);
            const messageIds = event.messages || [];

            if (messageIds.length === 0) return;

            this.logger.info('Messages deleted', {
                channel: channelId,
                count: messageIds.length
            });

            const query = `
                SELECT d.pushId, d.postId, c.name AS campaignName
                FROM detections d
                JOIN pushList p ON p.id = d.pushId
                JOIN campaigns c ON c.id = p.campaignId
                JOIN media m ON m.id = p.mediaId
                WHERE m.mediaIdentifier = ?
                  AND d.postId IN (${messageIds.map(() => '?').join(',')})
            `;

            const params = [channelId, ...messageIds];
            const results = await this.database.getData(query, params);

            if (results && results.length > 0) {
                for (const row of results) {
                    await this.saveRemovalDetection(row);
                }

                await this.notifications.notifyDeletion({
                    channelId,
                    messageIds,
                    campaignName: results[0].campaignName
                });

                this.stats.deletionsDetected += results.length;
            }
        } catch (error) {
            this.logger.error('Failed to process deleted messages', error);
        }
    }

    async checkForwardedMessage(forwardInfo) {
        const cacheKey = `check_${forwardInfo.fromChannelId}_${forwardInfo.fromMessageId}`;

        // Check cache
        const cached = this.queryCache.get(cacheKey);
        if (cached && (Date.now() - cached.time < this.CACHE_TTL)) {
            return cached.result;
        }

        try {
            const query = `
                SELECT 
                    p.id AS pushId,
                    c.name AS campaignName,
                    con.channelId, con.messageId,
                    con.forwardFromChannelId, con.forwardFromMessageId,
                    p.editedChannelId, p.editedMessageIds
                FROM pushList p
                JOIN campaigns c ON c.id = p.campaignId
                JOIN campaignContents cc ON cc.id = p.contentId
                JOIN contents con ON con.id = cc.contentId
                JOIN media m ON m.id = p.mediaId
                WHERE c.status != 'ENDED'
                  AND c.medium = 'TELEGRAM'
                  AND p.status IN ('APPROVED', 'DETECTED')
                  AND m.mediaIdentifier = ?
            `;

            const results = await this.database.getData(query, [
                this.cleanChannelId(forwardInfo.channelId)
            ]);

            if (!results || results.length === 0) {
                const result = { detected: false };
                this.queryCache.set(cacheKey, { result, time: Date.now() });
                return result;
            }

            for (const row of results) {
                const searchingChannelId = row.editedContentChannelId ||
                    row.forwardFromChannelId ||
                    row.channelId;

                let isMatch = false;

                if (row.editedMessageIds) {
                    try {
                        const messageIds = JSON.parse(row.editedMessageIds);
                        isMatch = Array.isArray(messageIds) &&
                            messageIds.includes(forwardInfo.fromMessageId);
                    } catch (e) {
                        this.logger.error('Failed to parse editedMessageIds', e);
                    }
                } else {
                    const searchingMessageId = row.forwardFromMessageId || row.messageId;
                    isMatch = forwardInfo.fromChannelId == this.cleanChannelId(searchingChannelId) &&
                        forwardInfo.fromMessageId == searchingMessageId;
                }

                if (isMatch) {
                    const result = {
                        detected: true,
                        pushId: row.pushId,
                        campaignName: row.campaignName,
                        ...forwardInfo
                    };

                    this.queryCache.set(cacheKey, { result, time: Date.now() });
                    return result;
                }
            }

            const result = { detected: false };
            this.queryCache.set(cacheKey, { result, time: Date.now() });
            return result;

        } catch (error) {
            this.logger.error('Database check failed', error);
            return { detected: false, error: error.message };
        }
    }

    async saveDetection(detectionInfo) {
        try {
            const data = {
                type: 'PLACEMENT',
                pushId: detectionInfo.pushId,
                postId: detectionInfo.messageId,
                actionTime: detectionInfo.date * 1000,
                finder: this.currentUserId
            };

            const result = await this.database.insertData('detections', data);
            this.logger.info('Detection saved', { id: result.insertId });
            return result.insertId;

        } catch (error) {
            this.logger.error('Failed to save detection', error);
            return null;
        }
    }

    async saveRemovalDetection(row) {
        try {
            const data = {
                type: 'REMOVE',
                pushId: row.pushId,
                postId: row.postId,
                actionTime: Date.now(),
                finder: this.currentUserId
            };

            await this.database.insertData('detections', data);
            this.logger.info('Removal saved', { pushId: row.pushId });

        } catch (error) {
            this.logger.error('Failed to save removal', error);
        }
    }

    async getChannelInfo(channelId) {
        try {
            const id = channelId.toString().startsWith('-100') ?
                channelId : `-100${channelId}`;

            const entity = await this.telegram.client.getEntity(id);

            if (entity) {
                return {
                    username: entity.username || null,
                    title: entity.title || 'Unknown',
                    isPublic: !!entity.username,
                    participantsCount: entity.participantsCount || 0
                };
            }

            return null;
        } catch (error) {
            this.logger.error('Failed to get channel info', error);
            return null;
        }
    }

    generateMessageLink(channelId, messageId, channelDetails) {
        if (channelDetails && channelDetails.username) {
            return `https://t.me/${channelDetails.username}/${messageId}`;
        }
        return `https://t.me/c/${this.cleanChannelId(channelId)}/${messageId}`;
    }

    generateChannelLink(channelId, channelDetails) {
        if (channelDetails && channelDetails.username) {
            return `@${channelDetails.username}`;
        }
        return `ID: ${this.cleanChannelId(channelId)}`;
    }

    cleanChannelId(channelId) {
        const id = String(channelId);
        return id.startsWith('-100') ? id.substring(4) : id;
    }
}

module.exports = AdsFinder;