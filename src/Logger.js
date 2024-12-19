const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');

const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug'
};

class Logger {
  constructor(config) {
    this.config = config;
    this.logDir = path.join(process.cwd(), 'logs');
    this.enabled = config.LOGGING_ENABLED !== false;

    const { combine, timestamp, json, colorize, printf } = winston.format;

    // Custom format for console output
    const consoleFormat = printf(({ level, message, timestamp, ...metadata }) => {
      const metadataStr = Object.keys(metadata).length
        ? `\n${JSON.stringify(metadata, null, 2)}`
        : '';
      return `${timestamp} ${level}: ${message}${metadataStr}`;
    });

    // Create logger instance
    this.logger = winston.createLogger({
      level: config.LOG_LEVEL || 'info',
      format: combine(
        timestamp(),
        json()
      ),
      transports: [
        // Console transport with colors
        new winston.transports.Console({
          format: combine(
            colorize(),
            timestamp(),
            consoleFormat
          )
        }),
        // File transport with daily rotation
        new winston.transports.DailyRotateFile({
          dirname: this.logDir,
          filename: 'money-printer-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '14d',
          format: combine(
            timestamp(),
            json()
          )
        })
      ]
    });

    // Log startup message
    this.info('Logger initialized', { logDir: this.logDir });
  }

  _log(level, message, metadata = {}) {
    if (!this.enabled) return;

    this.logger.log({
      level,
      message,
      ...metadata,
      timestamp: new Date().toISOString()
    });
  }

  error(message, metadata = {}) {
    this._log(LOG_LEVELS.ERROR, message, metadata);
  }

  warn(message, metadata = {}) {
    this._log(LOG_LEVELS.WARN, message, metadata);
  }

  info(message, metadata = {}) {
    this._log(LOG_LEVELS.INFO, message, metadata);
  }

  debug(message, metadata = {}) {
    this._log(LOG_LEVELS.DEBUG, message, metadata);
  }

  // Helper method to log errors with stack traces
  logError(error, metadata = {}) {
    this.error(error.message, {
      ...metadata,
      stack: error.stack,
      name: error.name
    });
  }
}

module.exports = {
  Logger,
  LOG_LEVELS
};
