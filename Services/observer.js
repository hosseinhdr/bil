require('dotenv').config({ path: './.env' });
const Config = require('../src/Core/Config');
const TelegramManager = require('../src/Core/TelegramManager');
const Database = require('../Database/Database');
const AdsFinder = require('../src/Core/AdsFinder');

async function main() {
    const config = new Config();

    // Initialize components
    const telegram = new TelegramManager(
        config.apiId,
        config.apiHash,
        config.sessionPath
    );

    const database = new Database(config.dbConfig);

    // Connect to services
    const hasSession = await telegram.checkSession();
    if (!hasSession) {
        console.error('No session found. Please run Scripts/create-sessions.js');
        process.exit(1);
    }

    await telegram.connect();
    await database.connect();

    // Start AdsFinder
    const adsFinder = new AdsFinder(telegram, database, config);
    await adsFinder.start();

    // Keep process alive
    process.stdin.resume();
}

if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = main;