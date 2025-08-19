import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Api } from 'telegram';
import logger from '../utils/logger.js';

class TelegramSession {
    constructor(name, sessionString, apiId, apiHash, isPremium = false) {
        this.name = name;
        this.sessionString = sessionString;
        this.apiId = apiId;
        this.apiHash = apiHash;
        this.isPremium = isPremium;
        this.client = null;
        this.isConnected = false;
        this.currentChannelsCount = 0;
        this.maxChannels = isPremium ? 1000 : 500;
        this.healthStatus = 'healthy';
        this.lastError = null;
        this.connectionAttempts = 0;
        this.maxConnectionAttempts = 3;
        this.floodWaitUntil = null;
        this.lastActivity = new Date();
    }

    async connect(retryCount = 0) {
        try {
            logger.info(`🔄 Connecting session ${this.name}...`);

            this.client = new TelegramClient(
                new StringSession(this.sessionString),
                this.apiId,
                this.apiHash,
                {
                    connectionRetries: 5,
                    retryDelay: 1000,
                    baseLogger: {
                        error: () => {},
                        warn: () => {},
                        info: () => {},
                        debug: () => {}
                    }
                }
            );

            await this.client.connect();

            // Test connection
            const me = await this.client.getMe();

            this.isConnected = true;
            this.connectionAttempts = 0;
            this.healthStatus = 'healthy';

            // Update premium status based on actual account
            this.isPremium = me.premium || false;
            this.maxChannels = this.isPremium ? 1000 : 500;

            // Get current channels count
            await this.updateChannelsCount();

            logger.info(`✅ ${this.name} connected successfully`); // استفاده از info به جای success
            logger.info(`   Premium: ${this.isPremium ? 'Yes ⭐' : 'No'}`);
            logger.info(`   Channels: ${this.currentChannelsCount}/${this.maxChannels}`);

            return true;

        } catch (error) {
            this.connectionAttempts++;
            this.lastError = error.message;

            logger.error(`❌ ${this.name} connection failed (Attempt ${retryCount})`);
            logger.error(`   Reason: ⚠️ ${error.message}`);

            // Handle specific errors
            if (error.message.includes('AUTH_KEY_INVALID')) {
                this.healthStatus = 'critical';
                logger.error(`   Session expired - needs re-authentication`);
                return false;
            }

            if (error.message.includes('FLOOD_WAIT')) {
                const waitTime = parseInt(error.message.match(/\d+/)?.[0] || 60);
                this.floodWaitUntil = new Date(Date.now() + waitTime * 1000);
                this.healthStatus = 'warning';
                logger.warn(`   Flood wait until: ${this.floodWaitUntil.toLocaleTimeString()}`);

                // Wait and retry
                if (retryCount < this.maxConnectionAttempts) {
                    await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                    return this.connect(retryCount + 1);
                }
            }

            // Retry logic
            if (retryCount < this.maxConnectionAttempts) {
                logger.info(`   Retrying in 5 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
                return this.connect(retryCount + 1);
            }

            this.isConnected = false;
            this.healthStatus = 'critical';
            return false;
        }
    }

    async updateChannelsCount() {
        try {
            const dialogs = await this.client.getDialogs({ limit: 1000 });
            const channels = dialogs.filter(dialog =>
                dialog.isChannel || dialog.entity?.broadcast
            );
            this.currentChannelsCount = channels.length;
            return this.currentChannelsCount;
        } catch (error) {
            logger.error(`Failed to update channels count for ${this.name}:`, error.message);
            return 0;
        }
    }

    async joinChannel(inviteLink) {
        // Check flood wait
        if (this.floodWaitUntil && new Date() < this.floodWaitUntil) {
            const waitSeconds = Math.ceil((this.floodWaitUntil - new Date()) / 1000);
            throw new Error(`Flood wait active. Wait ${waitSeconds} seconds`);
        }

        // Check capacity
        if (this.currentChannelsCount >= this.maxChannels) {
            throw new Error(`Session ${this.name} has reached maximum capacity (${this.maxChannels} channels)`);
        }

        try {
            let result;

            // Handle different link formats
            if (inviteLink.startsWith('https://t.me/joinchat/') || inviteLink.startsWith('https://t.me/+')) {
                // Private channel with invite link
                const hash = inviteLink.startsWith('https://t.me/+')
                    ? inviteLink.split('+')[1]
                    : inviteLink.split('/').pop();

                result = await this.client.invoke(
                    new Api.messages.ImportChatInvite({ hash })
                );
            } else {
                // Public channel
                const username = inviteLink.replace('@', '').replace('https://t.me/', '');
                const entity = await this.client.getEntity(username);

                result = await this.client.invoke(
                    new Api.channels.JoinChannel({ channel: entity })
                );
            }

            this.currentChannelsCount++;
            this.lastActivity = new Date();

            // Get channel info
            const chat = result.chats?.[0] || result.chat;

            return {
                success: true,
                channelId: chat?.id?.toString(),
                channelTitle: chat?.title || 'Unknown',
                channelUsername: chat?.username || null,
                sessionUsed: this.name,
                sessionCapacity: `${this.currentChannelsCount}/${this.maxChannels}`,
                remainingSlots: this.maxChannels - this.currentChannelsCount
            };

        } catch (error) {
            logger.error(`${this.name} failed to join channel:`, error.message);

            // Handle flood wait
            if (error.message.includes('FLOOD_WAIT')) {
                const waitTime = parseInt(error.message.match(/\d+/)?.[0] || 60);
                this.floodWaitUntil = new Date(Date.now() + waitTime * 1000);
                this.healthStatus = 'warning';
            }

            throw error;
        }
    }

    async leaveChannel(channelId) {
        try {
            const entity = await this.client.getEntity(channelId);

            await this.client.invoke(
                new Api.channels.LeaveChannel({ channel: entity })
            );

            this.currentChannelsCount = Math.max(0, this.currentChannelsCount - 1);
            this.lastActivity = new Date();

            return {
                success: true,
                message: `Left channel ${channelId}`,
                sessionName: this.name
            };

        } catch (error) {
            logger.error(`${this.name} failed to leave channel:`, error.message);
            throw error;
        }
    }

    async getChannelInfo(channelIdentifier) {
        try {
            const entity = await this.client.getEntity(channelIdentifier);

            // Get full channel info
            const fullChannel = await this.client.invoke(
                new Api.channels.GetFullChannel({ channel: entity })
            );

            const channel = fullChannel.chats?.[0];

            return {
                id: channel.id?.toString(),
                title: channel.title,
                username: channel.username || null,
                about: fullChannel.fullChat?.about || null,
                participantsCount: fullChannel.fullChat?.participantsCount || 0,
                isPublic: !!channel.username,
                sessionName: this.name
            };

        } catch (error) {
            logger.error(`${this.name} failed to get channel info:`, error.message);
            throw error;
        }
    }

    async listChannels() {
        try {
            const dialogs = await this.client.getDialogs({ limit: 1000 });

            const channels = dialogs
                .filter(dialog => dialog.isChannel || dialog.entity?.broadcast)
                .map(dialog => ({
                    id: dialog.entity.id?.toString(),
                    title: dialog.entity.title,
                    username: dialog.entity.username || null,
                    participantsCount: dialog.entity.participantsCount || 0,
                    isPublic: !!dialog.entity.username,
                    unreadCount: dialog.unreadCount || 0,
                    lastMessage: dialog.message?.message || null,
                    lastMessageDate: dialog.message?.date
                }));

            return channels;

        } catch (error) {
            logger.error(`${this.name} failed to list channels:`, error.message);
            throw error;
        }
    }

    async reconnect() {
        logger.info(`🔄 Reconnecting session ${this.name}...`);

        if (this.client) {
            try {
                await this.client.disconnect();
            } catch (error) {
                logger.debug(`Error disconnecting ${this.name}:`, error.message);
            }
        }

        this.isConnected = false;
        return this.connect();
    }

    async disconnect() {
        if (this.client && this.isConnected) {
            try {
                await this.client.disconnect();
                this.isConnected = false;
                logger.info(`${this.name} disconnected`);
            } catch (error) {
                logger.error(`Error disconnecting ${this.name}:`, error.message);
            }
        }
    }

    getStatus() {
        return {
            name: this.name,
            connected: this.isConnected,
            isPremium: this.isPremium,
            channelsUsed: this.currentChannelsCount,
            maxChannels: this.maxChannels,
            usage: `${Math.round((this.currentChannelsCount / this.maxChannels) * 100)}%`,
            health: this.healthStatus,
            lastError: this.lastError,
            floodWait: this.floodWaitUntil ? this.floodWaitUntil.toISOString() : null,
            lastActivity: this.lastActivity.toISOString()
        };
    }
}

export { TelegramSession };