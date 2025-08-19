import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import logger from '../utils/logger.js';

class TelegramNotifier {
    constructor(config) {
        this.config = config;
        this.client = null;
        this.isConnected = false;
        this.adminUserId = config.telegram?.adminUserId || process.env.ADMIN_USER_ID;
        this.adminUsername = config.telegram?.adminUsername || process.env.ADMIN_USERNAME;
        this.enabled = !!(this.adminUserId || this.adminUsername);
    }

    async connect() {
        if (!this.enabled) {
            logger.info('Telegram Notifier is disabled (no admin user configured)');
            return false;
        }

        try {
            // Use the first available session for notifications
            const sessions = this.config.telegram.sessions;
            if (!sessions || sessions.length === 0) {
                logger.warn('No sessions available for notifications');
                return false;
            }

            const sessionData = sessions[0];

            this.client = new TelegramClient(
                new StringSession(sessionData.string),
                this.config.telegram.apiId,
                this.config.telegram.apiHash,
                {
                    connectionRetries: 3,
                    baseLogger: {
                        error: () => {},
                        warn: () => {},
                        info: () => {},
                        debug: () => {}
                    }
                }
            );

            await this.client.connect();
            this.isConnected = true;

            logger.info('✅ Telegram Notifier connected');
            return true;

        } catch (error) {
            logger.error('Failed to connect Telegram Notifier:', error);
            this.isConnected = false;
            return false;
        }
    }

    async disconnect() {
        if (this.client) {
            await this.client.disconnect();
            this.isConnected = false;
            logger.info('Telegram Notifier disconnected');
        }
    }

    async sendNotification(message, type = 'info') {
        if (!this.enabled || !this.isConnected) {
            return false;
        }

        try {
            const emoji = {
                'success': '✅',
                'error': '❌',
                'warning': '⚠️',
                'info': 'ℹ️',
                'critical': '🚨'
            };

            const formattedMessage = `${emoji[type] || 'ℹ️'} **Telegram Channel Manager**\n\n${message}`;

            // Try to send by user ID first
            if (this.adminUserId) {
                try {
                    await this.client.sendMessage(this.adminUserId, {
                        message: formattedMessage,
                        parseMode: 'markdown'
                    });
                    return true;
                } catch (error) {
                    logger.debug('Failed to send by user ID, trying username...');
                }
            }

            // Try by username
            if (this.adminUsername) {
                const username = this.adminUsername.startsWith('@')
                    ? this.adminUsername
                    : '@' + this.adminUsername;

                await this.client.sendMessage(username, {
                    message: formattedMessage,
                    parseMode: 'markdown'
                });
                return true;
            }

            return false;

        } catch (error) {
            logger.error('Failed to send notification:', error);
            return false;
        }
    }

    async sendDailyReport(stats) {
        const report = `📊 **گزارش روزانه سیستم**
        
📅 تاریخ: ${new Date().toLocaleDateString('fa-IR')}
⏱ Uptime: ${stats.uptime}

**📱 وضعیت سشن‌ها:**
- کل سشن‌ها: ${stats.totalSessions}
- سشن‌های فعال: ${stats.activeSessions}
- ظرفیت استفاده شده: ${stats.capacityPercent}%

**📢 کانال‌ها:**
- کل کانال‌ها: ${stats.totalChannels}
- عضویت امروز: ${stats.joinedToday}
- خروج امروز: ${stats.leftToday}

**📈 عملکرد:**
- کل درخواست‌ها: ${stats.totalRequests}
- خطاها: ${stats.totalErrors}
- مصرف حافظه: ${stats.memoryUsage}MB

**🔑 API Keys:**
- کلیدهای فعال: ${stats.activeApiKeys}
- درخواست‌های امروز: ${stats.apiRequestsToday}`;

        return this.sendNotification(report, 'info');
    }
}

export { TelegramNotifier };