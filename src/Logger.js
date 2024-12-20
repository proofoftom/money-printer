const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
  SAFETY: 'safety'
};

class DashboardTransport extends winston.Transport {
  constructor(dashboard) {
    super();
    this.dashboard = dashboard;
  }

  log(info, callback) {
    setImmediate(() => {
      if (this.dashboard) {
        const { level, message, ...metadata } = info;
        const metadataStr = Object.keys(metadata).length > 0 ? 
          `\n${JSON.stringify(metadata, null, 2)}` : '';
        
        switch(level) {
          case 'error':
            this.dashboard.emit('alert', `ERROR: ${message}${metadataStr}`);
            break;
          case 'warn':
            this.dashboard.emit('alert', `WARN: ${message}${metadataStr}`);
            break;
          case 'safety':
            break;
          default:
            this.dashboard.emit('log', `${level.toUpperCase()}: ${message}${metadataStr}`);
        }
      }
    });

    callback();
  }
}

class Logger {
  constructor(config) {
    this.config = config;
    this.dashboard = null;
    
    const appDir = process.cwd();
    this.logDir = path.join(appDir, 'logs');
    
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    this.enabled = config.LOGGING_ENABLED !== false;

    const { combine, timestamp, json } = winston.format;

    this.logger = winston.createLogger({
      level: config.LOG_LEVEL || 'info',
      format: combine(
        timestamp(),
        json()
      ),
      transports: [
        new DashboardTransport(null),
        new winston.transports.DailyRotateFile({
          filename: path.join(this.logDir, 'money-printer-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '14d'
        }),
        new winston.transports.DailyRotateFile({
          filename: path.join(this.logDir, 'error-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '14d',
          level: 'error'
        }),
        new winston.transports.DailyRotateFile({
          filename: path.join(this.logDir, 'safety-checks-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '30d',
          level: 'safety'
        })
      ]
    });

    this.logger.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      safety: 4
    };

    this.debug('Logger initialized', {
      logDir: this.logDir,
      enabled: this.enabled
    });
  }

  setDashboard(dashboard) {
    this.dashboard = dashboard;
    this.logger.transports.forEach((transport) => {
      if (transport instanceof DashboardTransport) {
        transport.dashboard = dashboard;
      }
    });
  }

  logSafetyCheck(token, result, type) {
    if (!this.enabled) return;

    this.logger.log('safety', 'Safety check result', {
      token: {
        symbol: token.symbol,
        mint: token.mint,
        marketCapSol: token.marketCapSol,
        liquiditySol: token.liquiditySol,
        holderCount: token.holderCount,
        transactionCount: token.transactionCount,
        age: (Date.now() - token.minted) / 1000
      },
      result,
      type,
      timestamp: Date.now()
    });
  }

  error(message, metadata = {}) {
    if (!this.enabled) return;
    this.logger.error(message, metadata);
  }

  warn(message, metadata = {}) {
    if (!this.enabled) return;
    this.logger.warn(message, metadata);
  }

  info(message, metadata = {}) {
    if (!this.enabled) return;
    this.logger.info(message, metadata);
  }

  debug(message, metadata = {}) {
    if (!this.enabled) return;
    this.logger.debug(message, metadata);
  }

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
