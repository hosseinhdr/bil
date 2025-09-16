const BaseService = require('./BaseService');
const NotificationManager = require('./NotificationManager');

class ViewUpdater extends BaseService {
    constructor(telegramManager, database, config) {
        super('ViewUpdater', config);

        this.telegram = telegramManager;
        this.database = database;
        this.notifications = new NotificationManager(telegramManager, config);

        this.isUpdating = false;
        this.updateInterval = null;
        this.updateCount = 0;

        // Cache
        this.cachedDialogs = [];
        this.lastDialogsCacheTime = 0;
        this.dialogsCacheTTL = 30 * 60 * 60 * 1000;

        // Statistics
        this.stats = {
            totalUpdates: 0,
            successfulUpdates: 0,
            failedUpdates: 0
        };

        // Previous views tracking for diff calculation
        this.previousViews = new Map();
    }

    async initialize() {
        this.logger.info('Initializing ViewUpdater');

        // Test connections
        const me = await this.telegram.getMe();
        if (!me) throw new Error('Cannot verify Telegram connection');

        await this.testDatabaseConnection();

        // Start update cycle
        this.startUpdateCycle();

        // Initial notification
        await this.notifications.notifyAdmin(
            `🔄 ViewUpdater شروع به کار کرد\n` +
            `⏱️ بروزرسانی هر ${this.config.updateInterval} دقیقه`
        );

        // Perform first update
        await this.performUpdate();
    }

    async cleanup() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }

        await this.notifications.notifyAdmin('⏹️ ViewUpdater متوقف شد');

        this.cachedDialogs = [];
        this.previousViews.clear();
    }

    async performHealthCheck() {
        const me = await this.telegram.getMe();
        if (!me) throw new Error('Telegram connection lost');

        const dbTest = await this.database.ping();
        if (!dbTest) throw new Error('Database connection lost');

        return true;
    }

    async testDatabaseConnection() {
        try {
            const result = await this.database.getData('SELECT 1 as test', []);
            this.logger.info('Database connection tested');
            return true;
        } catch (error) {
            this.logger.error('Database test failed', error);
            throw error;
        }
    }

    startUpdateCycle() {
        this.updateInterval = setInterval(async () => {
            if (!this.isUpdating && this.isRunning) {
                await this.performUpdate();
            }
        }, this.config.updateInterval * 60 * 1000);

        this.logger.info('Update cycle started', {
            interval: this.config.updateInterval
        });
    }

    async performUpdate() {
        if (this.isUpdating) {
            this.logger.warn('Update already in progress');
            return;
        }

        this.isUpdating = true;
        const timer = this.logger.startTimer();

        let updatedCount = 0;
        let errorCount = 0;

        try {
            this.logger.info('Starting view update process');

            // Get items to update with parameterized query
            const query = `
                SELECT
                    m.mediaIdentifier,
                    m.username,
                    p.id as pushId,
                    c.name as campaignName
                FROM pushList p
                JOIN media m ON m.id = p.mediaId
                JOIN campaigns c ON c.id = p.campaignId
                WHERE p.status = 'DETECTED'
                  AND m.medium = 'TELEGRAM'
                  AND c.status IN ('ON_GOING', 'SHOT', 'PAUSE')
                  ${this.config.observerTgUserId ? 'AND m.observerTgUserId = ?' : ''}
                ORDER BY p.id DESC
                LIMIT 100
            `;

            const params = this.config.observerTgUserId ?
                [this.config.observerTgUserId] : [];

            const results = await this.database.getData(query, params);

            if (!results || results.length === 0) {
                this.logger.info('No items to update');
                return;
            }

            this.logger.info(`Found ${results.length} items to update`);

            // Get cached dialogs
            const dialogsArray = await this.getDialogs();
            const dialogsSet = new Set(dialogsArray.map(id => String(id)));

            // Process items
            for (const row of results) {
                try {
                    const result = await this.processItem(row, dialogsSet);

                    if (result.success) {
                        updatedCount++;

                        // Check for significant view changes
                        const previousView = this.previousViews.get(result.pushId) || 0;
                        if (result.views > previousView) {
                            await this.notifications.notifyViewUpdate({
                                channelId: row.mediaIdentifier,
                                messageId: result.messageId,
                                views: result.views,
                                forwards: result.forwards,
                                previousViews: previousView
                            });
                        }

                        this.previousViews.set(result.pushId, result.views);
                    } else {
                        errorCount++;
                    }

                } catch (error) {
                    this.logger.error(`Error processing item ${row.pushId}`, error);
                    errorCount++;
                }
            }

            // Update statistics
            this.updateCount++;
            this.stats.totalUpdates++;
            this.stats.successfulUpdates += updatedCount;
            this.stats.failedUpdates += errorCount;

            const duration = this.logger.endTimer(timer, 'Update process');

            this.logger.info('Update completed', {
                updated: updatedCount,
                errors: errorCount,
                duration: Math.round(duration / 1000)
            });

        } catch (error) {
            this.logger.error('Update process failed', error);

        } finally {
            this.isUpdating = false;
        }
    }

    async processItem(row, dialogsSet) {
        const channelId = `-100${row.mediaIdentifier}`;
        const pushId = row.pushId;

        // Check membership
        if (!dialogsSet.has(channelId) && !dialogsSet.has(row.mediaIdentifier)) {
            this.logger.debug(`Not member of channel ${channelId}`);
            return { success: false, notMember: true };
        }

        // Get detection info
        const detectionQuery = `
            SELECT * FROM detections 
            WHERE pushId = ? AND type = 'PLACEMENT' 
            ORDER BY id DESC LIMIT 1
        `;

        const detections = await this.database.getData(detectionQuery, [pushId]);

        if (!detections || detections.length === 0) {
            return { success: false, noDetection: true };
        }

        const detection = detections[0];
        const messageId = detection.postId;

        try {
            // Get message stats
            const messages = await this.telegram.client.getMessages(channelId, {
                ids: [parseInt(messageId)]
            });

            if (!messages || messages.length === 0 || !messages[0]) {
                return { success: false, messageNotFound: true };
            }

            const views = messages[0].views || 0;
            const forwards = messages[0].forwards || 0;

            // Save to database
            await this.database.insertData('insightHistories', {
                pushId: pushId,
                viewCount: views,
                share: forwards
            });

            return {
                success: true,
                pushId,
                messageId,
                views,
                forwards
            };

        } catch (error) {
            if (error.message?.includes('FLOOD_WAIT')) {
                const seconds = parseInt(error.message.match(/\d+/)?.[0] || 60);
                this.logger.warn(`Flood wait ${seconds}s`);
                await new Promise(r => setTimeout(r, seconds * 1000));
            }

            throw error;
        }
    }

    async getDialogs() {
        const now = Date.now();

        if (this.cachedDialogs.length === 0 ||
            (now - this.lastDialogsCacheTime) > this.dialogsCacheTTL) {

            this.logger.info('Refreshing dialogs cache');

            try {
                this.cachedDialogs = await this.telegram.getDialogIds(1000);
                this.lastDialogsCacheTime = now;

                this.logger.info(`Cached ${this.cachedDialogs.length} dialogs`);
            } catch (error) {
                this.logger.error('Failed to refresh dialogs', error);
            }
        }

        return this.cachedDialogs;
    }
}

module.exports = ViewUpdater;