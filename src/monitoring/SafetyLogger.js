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

  updateMetrics(checkData) {
    this.metrics.totalChecks++;
    
    if (checkData.passed) {
      this.metrics.approvedChecks++;
    } else {
      this.metrics.failedChecks++;
      
      // Update failure reasons
      if (checkData.reason) {
        this.metrics.failureReasons[checkData.reason] = 
          (this.metrics.failureReasons[checkData.reason] || 0) + 1;
      }
    }
  }

  getMetrics() {
    return { ...this.metrics };
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
