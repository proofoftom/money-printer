const fs = require('fs');
const path = require('path');

class ErrorLogger {
  constructor() {
    this.logDir = path.join(process.cwd(), 'logs', 'errors');
    this.ensureLogDirectory();
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  getLogFileName() {
    const date = new Date();
    return `errors_${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.json`;
  }

  log(error, context = {}) {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        error: {
          message: error.message,
          stack: error.stack,
          ...error
        },
        context
      };

      const logFile = path.join(this.logDir, this.getLogFileName());
      
      let entries = [];
      if (fs.existsSync(logFile)) {
        const content = fs.readFileSync(logFile, 'utf8');
        entries = content ? JSON.parse(content) : [];
      }
      
      entries.push(logEntry);
      
      fs.writeFileSync(logFile, JSON.stringify(entries, null, 2));
    } catch (e) {
      console.error('Failed to log error:', e);
    }
  }

  // Alias for log method to maintain compatibility
  logError(error, context = {}) {
    return this.log(error, context);
  }
}

module.exports = ErrorLogger;
