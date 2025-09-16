const Logger = require('./Logger');

class NotificationManager {
    constructor(telegramClient, config) {
        this.telegram = telegramClient;
        this.config = config;
        this.logger = new Logger('NotificationManager');

        // Channels for different types of notifications
        this.channels = {
            admin: config.adminUsername,
            ads: config.adsChannelId || config.adminUsername,
            views: config.viewsChannelId || config.adminUsername,
            deletions: config.deletionsChannelId || config.adminUsername
        };

        // Rate limiting
        this.messageQueue = [];
        this.isProcessing = false;
        this.messageDelay = 1000; // 1 second between messages
    }

    // Send to specific channel
    async sendToChannel(channel, message, parseMode = 'md') {
        if (!this.telegram || !this.telegram.isConnected()) {
            this.logger.warn('Telegram not connected, message not sent');
            return false;
        }

        try {
            // Add to queue
            this.messageQueue.push({ channel, message, parseMode });

            if (!this.isProcessing) {
                await this.processQueue();
            }

            return true;
        } catch (error) {
            this.logger.error('Failed to queue message', error);
            return false;
        }
    }

    async processQueue() {
        if (this.isProcessing || this.messageQueue.length === 0) return;

        this.isProcessing = true;

        while (this.messageQueue.length > 0) {
            const { channel, message, parseMode } = this.messageQueue.shift();

            try {
                await this.telegram.client.sendMessage(channel, {
                    message: message,
                    parseMode: parseMode
                });

                this.logger.debug('Message sent', { channel });

                // Rate limiting
                if (this.messageQueue.length > 0) {
                    await new Promise(resolve => setTimeout(resolve, this.messageDelay));
                }

            } catch (error) {
                this.logger.error('Failed to send message', error, { channel });

                // Handle flood wait
                if (error.message && error.message.includes('FLOOD_WAIT')) {
                    const seconds = parseInt(error.message.match(/\d+/)?.[0] || 60);
                    this.logger.warn(`Flood wait ${seconds} seconds`);
                    await new Promise(resolve => setTimeout(resolve, seconds * 1000));
                }
            }
        }

        this.isProcessing = false;
    }

    // Notification methods for different events
    async notifyAdmin(message) {
        return this.sendToChannel(this.channels.admin, message);
    }

    async notifyAdDetection(detectionInfo) {
        const message = this.formatAdDetection(detectionInfo);
        return this.sendToChannel(this.channels.ads, message);
    }

    async notifyViewUpdate(updateInfo) {
        const message = this.formatViewUpdate(updateInfo);
        return this.sendToChannel(this.channels.views, message);
    }

    async notifyDeletion(deletionInfo) {
        const message = this.formatDeletion(deletionInfo);
        return this.sendToChannel(this.channels.deletions, message);
    }

    async notifyStatus(statusInfo) {
        const message = this.formatStatus(statusInfo);
        return this.sendToChannel(this.channels.admin, message);
    }

    // Message formatters
    formatAdDetection(info) {
        let message = `🎯 **تبلیغ جدید**\n\n`;
        message += `📊 کمپین: ${info.campaignName}\n`;
        message += `📍 کانال: ${info.channelLink}\n`;

        if (info.channelDetails) {
            message += `👥 اعضا: ${info.channelDetails.participantsCount?.toLocaleString('fa-IR') || 'نامشخص'}\n`;
        }

        message += `📝 پیام: #${info.messageId}\n`;
        message += `👁 بازدید: ${(info.views || 0).toLocaleString('fa-IR')}\n`;
        message += `🔗 لینک: ${info.messageLink}\n`;
        message += `⏰ ${this.getIranTime()}`;

        return message;
    }

    formatViewUpdate(info) {
        let message = `📊 **آپدیت آمار**\n\n`;
        message += `📍 کانال: ${info.channelId}\n`;
        message += `📝 پیام: #${info.messageId}\n`;
        message += `👁 بازدید: ${info.views.toLocaleString('fa-IR')}\n`;
        message += `↗️ فوروارد: ${info.forwards.toLocaleString('fa-IR')}\n`;

        if (info.previousViews) {
            const diff = info.views - info.previousViews;
            if (diff > 0) {
                message += `📈 افزایش: +${diff.toLocaleString('fa-IR')}\n`;
            }
        }

        message += `⏰ ${this.getIranTime()}`;

        return message;
    }

    formatDeletion(info) {
        let message = `🗑 **پیام حذف شد**\n\n`;
        message += `📍 کانال: ${info.channelId}\n`;
        message += `📝 پیام‌ها: ${info.messageIds.slice(0, 5).join(', ')}`;

        if (info.messageIds.length > 5) {
            message += ` و ${info.messageIds.length - 5} پیام دیگر`;
        }

        message += `\n📊 کمپین: ${info.campaignName || 'نامشخص'}\n`;
        message += `⏰ ${this.getIranTime()}`;

        return message;
    }

    formatStatus(status) {
        let message = `📊 **گزارش وضعیت**\n\n`;
        message += `✅ سرویس: ${status.service}\n`;
        message += `⏱ آپتایم: ${this.formatUptime(status.uptime)}\n`;
        message += `💾 حافظه: ${status.memory.heap} MB\n`;
        message += `📨 پیام‌ها: ${status.messagesProcessed?.toLocaleString('fa-IR') || '0'}\n`;
        message += `🎯 تبلیغات: ${status.detectionsFound?.toLocaleString('fa-IR') || '0'}\n`;
        message += `⏰ ${this.getIranTime()}`;

        return message;
    }

    formatUptime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        if (hours > 0) {
            return `${hours} ساعت و ${minutes} دقیقه`;
        }
        return `${minutes} دقیقه`;
    }

    getIranTime() {
        return new Date().toLocaleString('fa-IR', {
            timeZone: 'Asia/Tehran',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    }
}

module.exports = NotificationManager;