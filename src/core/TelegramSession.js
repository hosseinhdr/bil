import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Api } from 'telegram';
import logger from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

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

            logger.info(`✅ ${this.name} connected successfully`);
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
            if (inviteLink.includes('t.me/joinchat/') || inviteLink.includes('t.me/+')) {
                // Private channel with invite link
                let hash;

                if (inviteLink.includes('t.me/+')) {
                    // Extract hash from t.me/+hash format
                    const parts = inviteLink.split('t.me/+');
                    hash = parts[1];
                } else {
                    // Extract hash from t.me/joinchat/hash format
                    const parts = inviteLink.split('t.me/joinchat/');
                    hash = parts[1];
                }

                // Clean the hash - remove any query parameters or additional path
                hash = hash.split('?')[0].split('/')[0].trim();

                logger.info(`Attempting to join with hash: ${hash}`);

                result = await this.client.invoke(
                    new Api.messages.ImportChatInvite({ hash })
                );
            } else {
                // Public channel
                const username = inviteLink.replace('@', '').replace('https://t.me/', '').split('?')[0];
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

    /**
     * Get channel info with profile photo
     * Supports: numeric ID, username, public link, private invite link
     */
    async getChannelInfo(channelIdentifier) {
        try {
            logger.info(`Getting channel info for: ${channelIdentifier}`);

            let entity = null;
            let channelInfo = {};

            // 1. Handle numeric ID (channel ID or access hash)
            if (/^-?\d+$/.test(channelIdentifier)) {
                logger.info('Detected numeric ID format');

                try {
                    // Try different ID formats
                    let channelId = channelIdentifier;

                    // If it doesn't start with -, try adding -100 prefix (supergroup format)
                    if (!channelId.startsWith('-')) {
                        // Try with -100 prefix first (most common for channels/supergroups)
                        try {
                            const superGroupId = `-100${channelId}`;
                            entity = await this.client.getEntity(superGroupId);
                            logger.info(`Found channel with ID: ${superGroupId}`);
                        } catch (e) {
                            // If that fails, try with just negative
                            try {
                                const negativeId = `-${channelId}`;
                                entity = await this.client.getEntity(negativeId);
                                logger.info(`Found channel with ID: ${negativeId}`);
                            } catch (e2) {
                                // Try as is
                                entity = await this.client.getEntity(channelId);
                                logger.info(`Found channel with ID: ${channelId}`);
                            }
                        }
                    } else {
                        entity = await this.client.getEntity(channelId);
                    }
                } catch (error) {
                    logger.error(`Failed to get entity by ID: ${error.message}`);

                    // Try to find in dialogs
                    const dialogs = await this.client.getDialogs({ limit: 1000 });
                    const targetId = channelIdentifier.replace('-100', '').replace('-', '');

                    for (const dialog of dialogs) {
                        if (dialog.entity?.id?.toString() === targetId ||
                            dialog.entity?.id?.toString() === `-${targetId}` ||
                            dialog.entity?.id?.toString() === `-100${targetId}`) {
                            entity = dialog.entity;
                            logger.info('Found channel in dialogs');
                            break;
                        }
                    }

                    if (!entity) {
                        throw new Error(`Channel with ID ${channelIdentifier} not found. Make sure you're a member of this channel.`);
                    }
                }
            }

            // 2. Handle invite links (both formats: t.me/joinchat/hash and t.me/+hash)
            else if (channelIdentifier.includes('t.me/joinchat/') || channelIdentifier.includes('t.me/+')) {
                logger.info('Detected invite link format');

                let hash;

                // Extract hash from URL
                if (channelIdentifier.includes('t.me/+')) {
                    // Format: https://t.me/+hash or t.me/+hash
                    const parts = channelIdentifier.split('t.me/+');
                    if (parts.length > 1) {
                        hash = parts[1];
                    } else {
                        throw new Error('Invalid invite link format');
                    }
                } else if (channelIdentifier.includes('t.me/joinchat/')) {
                    // Format: https://t.me/joinchat/hash or t.me/joinchat/hash
                    const parts = channelIdentifier.split('t.me/joinchat/');
                    if (parts.length > 1) {
                        hash = parts[1];
                    } else {
                        throw new Error('Invalid invite link format');
                    }
                } else {
                    throw new Error('Invalid invite link format');
                }

                // Clean the hash - remove any query parameters, fragments, or additional path
                hash = hash.split('?')[0].split('#')[0].split('/')[0].trim();

                // Remove any URL encoding issues
                hash = decodeURIComponent(hash);

                logger.info(`Checking invite with hash: ${hash}`);

                try {
                    const inviteResult = await this.client.invoke(
                        new Api.messages.CheckChatInvite({ hash })
                    );

                    logger.info(`Invite check result: ${inviteResult.className}`);

                    if (inviteResult.className === 'ChatInviteAlready') {
                        // We're already a member
                        const chat = inviteResult.chat;

                        try {
                            // Try to get full channel info
                            const fullChannel = await this.client.invoke(
                                new Api.channels.GetFullChannel({ channel: chat })
                            );

                            const channel = fullChannel.chats?.[0];

                            channelInfo = {
                                id: channel.id?.toString(),
                                title: channel.title,
                                username: channel.username || null,
                                about: fullChannel.fullChat?.about || null,
                                participantsCount: fullChannel.fullChat?.participantsCount || 0,
                                isPublic: false,
                                isPrivate: true,
                                sessionName: this.name,
                                profilePhotoPath: null,
                                isMember: true
                            };

                            // Try to download photo
                            if (channel.photo) {
                                try {
                                    channelInfo.profilePhotoPath = await this.downloadChannelPhoto(chat, channel.id);
                                } catch (photoError) {
                                    logger.error(`Failed to download photo: ${photoError.message}`);
                                }
                            }

                            return channelInfo;

                        } catch (fullError) {
                            logger.error(`Failed to get full channel: ${fullError.message}`);

                            // Return basic info
                            return {
                                id: chat.id?.toString(),
                                title: chat.title,
                                username: null,
                                about: null,
                                participantsCount: chat.participantsCount || 0,
                                isPublic: false,
                                isPrivate: true,
                                sessionName: this.name,
                                profilePhotoPath: null,
                                isMember: true
                            };
                        }

                    } else if (inviteResult.className === 'ChatInvite') {
                        // Not a member - return preview
                        return {
                            id: null,
                            title: inviteResult.title,
                            about: inviteResult.about || null,
                            participantsCount: inviteResult.participantsCount || 0,
                            isPublic: inviteResult.isPublic || false,
                            isPrivate: !inviteResult.isPublic,
                            isBroadcast: inviteResult.broadcast || false,
                            isMegagroup: inviteResult.megagroup || false,
                            isVerified: inviteResult.verified || false,
                            sessionName: this.name,
                            profilePhotoPath: null,
                            preview: true,
                            needsToJoin: true,
                            inviteHash: hash,
                            isMember: false
                        };
                    }

                } catch (inviteError) {
                    logger.error(`Invite check error: ${inviteError.message}`);

                    if (inviteError.message.includes('INVITE_HASH_INVALID')) {
                        throw new Error('Invalid invite link - the link may be expired or incorrect');
                    } else if (inviteError.message.includes('INVITE_HASH_EXPIRED')) {
                        throw new Error('Invite link has expired');
                    }

                    throw inviteError;
                }
            }

            // 3. Handle public links and usernames
            else if (channelIdentifier.includes('t.me/')) {
                logger.info('Detected public link format');

                // Extract username from t.me/username format
                let username;
                const parts = channelIdentifier.split('t.me/');

                if (parts.length > 1) {
                    username = parts[1].split('?')[0].split('#')[0].split('/')[0].trim();
                } else {
                    throw new Error('Invalid public link format');
                }

                // Make sure it's not an invite link that we missed
                if (username.startsWith('+') || username === 'joinchat') {
                    throw new Error('This appears to be an invite link. Please check the format.');
                }

                logger.info(`Attempting to get entity for username: ${username}`);
                entity = await this.client.getEntity(username);
            }
            else if (channelIdentifier.startsWith('@')) {
                logger.info('Detected username with @ format');
                entity = await this.client.getEntity(channelIdentifier);
            }
            else {
                logger.info('Assuming username without @ format');
                entity = await this.client.getEntity(channelIdentifier);
            }

            // If we have entity, get full channel info
            if (entity) {
                logger.info('Getting full channel info for entity');

                const fullChannel = await this.client.invoke(
                    new Api.channels.GetFullChannel({ channel: entity })
                );

                const channel = fullChannel.chats?.[0];

                channelInfo = {
                    id: channel.id?.toString(),
                    title: channel.title,
                    username: channel.username || null,
                    about: fullChannel.fullChat?.about || null,
                    participantsCount: fullChannel.fullChat?.participantsCount || 0,
                    isPublic: !!channel.username,
                    isPrivate: !channel.username,
                    sessionName: this.name,
                    profilePhotoPath: null,
                    isMember: true
                };

                // Download profile photo if exists
                if (channel.photo) {
                    try {
                        channelInfo.profilePhotoPath = await this.downloadChannelPhoto(entity, channel.id);
                    } catch (photoError) {
                        logger.error(`Failed to download profile photo: ${photoError.message}`);
                    }
                }
            }

            return channelInfo;

        } catch (error) {
            logger.error(`${this.name} failed to get channel info: ${error.message}`);
            throw error;
        }
    }

    /**
     * Download channel profile photo to temp file
     */
    async downloadChannelPhoto(entity, channelId) {
        try {
            // Create temp directory if not exists
            const tempDir = path.join(os.tmpdir(), 'telegram-channel-photos');
            await fs.mkdir(tempDir, { recursive: true });

            // Generate unique filename
            const timestamp = Date.now();
            const photoPath = path.join(tempDir, `channel_${channelId}_${timestamp}.jpg`);

            // Download the photo
            const buffer = await this.client.downloadProfilePhoto(entity, {
                isBig: true
            });

            if (buffer) {
                // Save to file
                await fs.writeFile(photoPath, buffer);

                logger.info(`✅ Profile photo saved to: ${photoPath}`);

                // Schedule deletion after 1 hour
                setTimeout(async () => {
                    try {
                        await fs.unlink(photoPath);
                        logger.debug(`Deleted temp photo: ${photoPath}`);
                    } catch (err) {
                        // File might already be deleted
                    }
                }, 3600000); // 1 hour

                return photoPath;
            }

            return null;

        } catch (error) {
            logger.error('Failed to download channel photo:', error.message);
            return null;
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