const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug'
};

class Logger {
  constructor(config) {
    this.config = config;
    
    // Ensure logs directory exists relative to app directory
    const appDir = process.cwd();
    this.logDir = path.join(appDir, 'logs');
    
    // Debug log directory creation
    console.log('Creating logs directory:', this.logDir);
    
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

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
        })
      ]
    });

    // Only add file transport if logging is enabled
    if (this.enabled) {
      const fileTransport = new winston.transports.DailyRotateFile({
        dirname: this.logDir,
        filename: 'money-printer-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxSize: config.LOGGING_SETTINGS?.MAX_SIZE || '20m',
        maxFiles: config.LOGGING_SETTINGS?.MAX_FILES || '14d',
        format: combine(
          timestamp(),
          json()
        )
      });

      // Add error handler for file transport
      fileTransport.on('error', (error) => {
        console.error('Error writing to log file:', error);
      });

      this.logger.add(fileTransport);
    }

    // Log startup information
    this.info('Logger initialized', { 
      logDir: this.logDir,
      enabled: this.enabled,
      level: config.LOG_LEVEL || 'info'
    });
  }

  _log(level, message, metadata = {}) {
    if (!this.enabled) return;

    try {
      this.logger.log({
        level,
        message,
        ...metadata,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error writing log:', error);
      console.log(level, message, metadata);
    }
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
