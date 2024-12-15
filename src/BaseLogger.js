const fs = require('fs');
const path = require('path');

class BaseLogger {
  constructor({ logDir }) {
    this.logDir = logDir;
    this.maxLogSize = 500 * 1024 * 1024; // 500MB
    this.ensureLogDirectory();
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  getCurrentLogFile() {
    const date = new Date().toISOString().split('T')[0];
    return path.join(this.logDir, `${this.getLogPrefix()}_${date}.json`);
  }

  rotateLogFileIfNeeded(logFile) {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > this.maxLogSize) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedFile = `${logFile}.${timestamp}`;
      fs.renameSync(logFile, rotatedFile);
    }
  }

  log(data) {
    const logFile = this.getCurrentLogFile();
    this.rotateLogFileIfNeeded(logFile);
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      ...data
    };

    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
  }

  getLogPrefix() {
    throw new Error('getLogPrefix must be implemented by child classes');
  }
}

module.exports = BaseLogger;
