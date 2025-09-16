require('dotenv').config();

class Config {
    constructor() {
        this.validateEnvironment();

        // Telegram
        this.apiId = parseInt(process.env.API_ID);
        this.apiHash = process.env.API_HASH;
        this.sessionPath = process.env.SESSION_PATH;
        this.observerTgUserId = process.env.OBSERVER_TELEGRAM_USER_ID;

        // Database
        this.dbConfig = {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT_WRITE) || 3306,
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASS || '',
            database: process.env.DB_NAME || 'telegram_db'
        };

        // Notifications
        this.adminUsername = process.env.ADMIN_USERNAME;
        this.adsChannelId = process.env.ADS_CHANNEL_ID || this.adminUsername;
        this.viewsChannelId = process.env.VIEWS_CHANNEL_ID || this.adminUsername;
        this.deletionsChannelId = process.env.DELETIONS_CHANNEL_ID || this.adminUsername;

        // Service settings
        this.updateInterval = parseInt(process.env.UPDATE_INTERVAL) || 15;
        this.statusReportInterval = parseInt(process.env.STATUS_REPORT_INTERVAL) || 60; // minutes

        // Logging
        this.logLevel = process.env.LOG_LEVEL || 'info';
        this.logConsole = process.env.LOG_CONSOLE === 'true';
        this.environment = process.env.NODE_ENV || 'production';
    }

    validateEnvironment() {
        const required = ['API_ID', 'API_HASH', 'ADMIN_USERNAME', 'SESSION_PATH'];
        const missing = required.filter(key => !process.env[key]);

        if (missing.length > 0) {
            console.error('Missing required environment variables:', missing);
            process.exit(1);
        }
    }
}

module.exports = Config;