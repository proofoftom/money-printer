const fs = require('fs');
const path = require('path');
const util = require('util');

class ErrorLogger {
  constructor() {
    this.logDir = path.join(process.cwd(), 'logs');
    this.errorLogDir = path.join(this.logDir, 'errors');
    this.consoleLogDir = path.join(this.logDir, 'console');
    this.ensureLogDirectories();
    this.setupConsoleCapture();
    this.setupUncaughtHandlers();
  }

  ensureLogDirectories() {
    [this.logDir, this.errorLogDir, this.consoleLogDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  getLogFileName(type = 'errors') {
    const date = new Date();
    return `${type}_${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.log`;
  }

  setupConsoleCapture() {
    const logFile = path.join(this.consoleLogDir, this.getLogFileName('console'));
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });

    // Store original console methods
    const originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      info: console.info
    };

    // Override console methods to write to both console and file
    ['log', 'error', 'warn', 'info'].forEach(method => {
      console[method] = (...args) => {
        const timestamp = new Date().toISOString();
        const message = util.format(...args);
        const logMessage = `[${timestamp}] [${method.toUpperCase()}] ${message}\n`;
        
        logStream.write(logMessage);
        originalConsole[method].apply(console, args);
      };
    });
  }

  setupUncaughtHandlers() {
    process.on('uncaughtException', (error) => {
      this.logError(error, { type: 'uncaughtException' });
      console.error('Uncaught Exception:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.logError(reason, { type: 'unhandledRejection', promise });
      console.error('Unhandled Rejection:', reason);
    });
  }

  formatError(error) {
    return {
      message: error.message,
      stack: error.stack,
      name: error.name,
      ...(error.code && { code: error.code }),
      ...(error.errno && { errno: error.errno }),
      ...(error.syscall && { syscall: error.syscall }),
      ...(error.path && { path: error.path })
    };
  }

  log(error, context = {}) {
    try {
      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        error: this.formatError(error),
        context
      };

      const logFile = path.join(this.errorLogDir, this.getLogFileName());
      const logMessage = `${JSON.stringify(logEntry, null, 2)}\n---\n`;
      
      fs.appendFileSync(logFile, logMessage);
    } catch (e) {
      console.error('Failed to log error:', e);
    }
  }

  // Alias for log method to maintain compatibility
  logError(error, context = {}) {
    return this.log(error, context);
  }
}

// Create a singleton instance
const errorLogger = new ErrorLogger();

module.exports = ErrorLogger;
