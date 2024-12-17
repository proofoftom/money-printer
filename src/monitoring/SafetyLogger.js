const fs = require('fs');
const path = require('path');
const config = require('../utils/config');

class SafetyLogger {
  constructor({ logDir = 'logs/safety' } = {}) {
    this.logDir = logDir;
    this.currentDate = null;
    this.currentLogFile = null;
    this.metrics = {
      totalChecks: 0,
      approvedChecks: 0,
      failedChecks: 0,
      failureReasons: {}
    };

    // Create log directory if it doesn't exist
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    this.updateLogFile();
  }

  updateLogFile() {
    const date = new Date().toISOString().split('T')[0];
    if (this.currentDate !== date) {
      this.currentDate = date;
      this.currentLogFile = path.join(this.logDir, `safety_checks_${date}.json`);
      
      // Initialize new log file if it doesn't exist
      if (!fs.existsSync(this.currentLogFile)) {
        fs.writeFileSync(this.currentLogFile, '[]');
      }
    }
  }

  logCheck(checkData) {
    this.updateLogFile();
    this.updateMetrics(checkData);

    const logEntry = {
      timestamp: new Date().toISOString(),
      ...checkData
    };

    fs.appendFileSync(this.currentLogFile, JSON.stringify(logEntry) + '\n');
  }

  logSafetyCheck(token, approved, failedChecks = []) {
    const checkData = {
      mint: token.mint,
      approved,
      marketCap: token.marketCap,
      volume: token.volume,
      price: token.currentPrice,
      state: token.state,
      failedChecks: failedChecks.map(check => ({
        name: check.name,
        reason: check.reason,
        actual: check.actual,
        configPath: check.configPath
      }))
    };

    this.logCheck(checkData);
  }

  rotateLogFileIfNeeded() {
    const stats = fs.statSync(this.currentLogFile);
    const fileSizeInMB = stats.size / (1024 * 1024);
    
    if (fileSizeInMB >= config.LOGGING.MAX_LOG_FILE_SIZE_MB) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedFile = this.currentLogFile.replace('.json', `_${timestamp}.json`);
      fs.renameSync(this.currentLogFile, rotatedFile);
      fs.writeFileSync(this.currentLogFile, '[]');
    }
  }

  cleanupOldLogs() {
    const files = fs.readdirSync(this.logDir)
      .filter(file => file.startsWith('safety_checks_'))
      .map(file => ({
        name: file,
        path: path.join(this.logDir, file),
        stats: fs.statSync(path.join(this.logDir, file))
      }))
      .sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime());

    let totalSize = 0;
    for (const file of files) {
      totalSize += file.stats.size;
      if (totalSize > config.LOGGING.MAX_TOTAL_LOG_SIZE_MB * 1024 * 1024) {
        fs.unlinkSync(file.path);
      }
    }
  }

  updateMetrics(checkData) {
    this.metrics.totalChecks++;
    
    if (checkData.approved) {
      this.metrics.approvedChecks++;
    } else {
      this.metrics.failedChecks++;
      checkData.failedChecks.forEach(check => {
        const reason = check.name;
        this.metrics.failureReasons[reason] = (this.metrics.failureReasons[reason] || 0) + 1;
      });
    }
  }

  getMetrics() {
    return { ...this.metrics };
  }

  getFormattedMetrics() {
    return {
      ...this.metrics,
      approvalRate: (this.metrics.approvedChecks / this.metrics.totalChecks * 100).toFixed(2) + '%',
      failureRate: (this.metrics.failedChecks / this.metrics.totalChecks * 100).toFixed(2) + '%',
      topFailureReasons: Object.entries(this.metrics.failureReasons)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {})
    };
  }

  clearMetrics() {
    this.metrics = {
      totalChecks: 0,
      approvedChecks: 0,
      failedChecks: 0,
      failureReasons: {}
    };
  }

  rotateLogs(maxFiles = 7) {
    const files = fs.readdirSync(this.logDir)
      .filter(file => file.startsWith('safety_checks_'))
      .sort((a, b) => b.localeCompare(a));

    if (files.length > maxFiles) {
      files.slice(maxFiles).forEach(file => {
        fs.unlinkSync(path.join(this.logDir, file));
      });
    }
  }
}

module.exports = SafetyLogger;
