const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for logs
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json(),
    winston.format.printf(({ timestamp, level, message, service, ...metadata }) => {
        let msg = `${timestamp} [${service || 'APP'}] ${level}: ${message}`;

        if (Object.keys(metadata).length > 0) {
            msg += ` ${JSON.stringify(metadata)}`;
        }

        return msg;
    })
);

// Console format with colors
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, service }) => {
        return `${timestamp} [${service || 'APP'}] ${level}: ${message}`;
    })
);

class Logger {
    constructor(serviceName = 'APP') {
        this.serviceName = serviceName;

        const logLevel = process.env.LOG_LEVEL || 'info';
        const isDevelopment = process.env.NODE_ENV === 'development';

        this.winston = winston.createLogger({
            level: logLevel,
            format: logFormat,
            defaultMeta: { service: serviceName },
            transports: [
                // Error log file
                new winston.transports.File({
                    filename: path.join(logsDir, `${serviceName}-error.log`),
                    level: 'error',
                    maxsize: 10485760, // 10MB
                    maxFiles: 5
                }),
                // Combined log file
                new winston.transports.File({
                    filename: path.join(logsDir, `${serviceName}-combined.log`),
                    maxsize: 10485760, // 10MB
                    maxFiles: 10
                })
            ]
        });

        // Add console transport in development
        if (isDevelopment || process.env.LOG_CONSOLE === 'true') {
            this.winston.add(new winston.transports.Console({
                format: consoleFormat
            }));
        }
    }

    info(message, meta = {}) {
        this.winston.info(message, meta);
    }

    error(message, error = null, meta = {}) {
        if (error instanceof Error) {
            this.winston.error(message, {
                ...meta,
                error: error.message,
                stack: error.stack
            });
        } else {
            this.winston.error(message, meta);
        }
    }

    warn(message, meta = {}) {
        this.winston.warn(message, meta);
    }

    debug(message, meta = {}) {
        this.winston.debug(message, meta);
    }

    // Performance logging
    startTimer() {
        return Date.now();
    }

    endTimer(startTime, operation) {
        const duration = Date.now() - startTime;
        this.info(`${operation} completed`, { duration_ms: duration });
        return duration;
    }
}

module.exports = Logger;