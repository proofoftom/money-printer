const fs = require('fs');
const path = require('path');

class ErrorLogger {
  constructor(options = {}) {
    this.maxFileSize = options.maxFileSize || 500 * 1024 * 1024; // 500 MB default
    this.logDir = options.logDir || 'logs/errors';
    this.currentLogFile = null;
    this.summaryMetrics = {
      totalErrors: 0,
      errorsByType: {},
      errorsByComponent: {},
      criticalErrors: 0,
      recoveredErrors: 0,
      avgRecoveryTime: 0,
      totalRecoveryTime: 0
    };

    // Ensure log directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    this.rotateLogFileIfNeeded();
  }

  logError(errorData) {
    this.rotateLogFileIfNeeded();
    
    // Update summary metrics
    this.summaryMetrics.totalErrors++;
    
    // Track errors by type
    const errorType = errorData.type || 'unknown';
    this.summaryMetrics.errorsByType[errorType] = 
      (this.summaryMetrics.errorsByType[errorType] || 0) + 1;
    
    // Track errors by component
    const component = errorData.component || 'unknown';
    this.summaryMetrics.errorsByComponent[component] = 
      (this.summaryMetrics.errorsByComponent[component] || 0) + 1;
    
    // Track critical errors
    if (errorData.critical) {
      this.summaryMetrics.criticalErrors++;
    }

    // Track recovered errors and recovery time
    if (errorData.recovered) {
      this.summaryMetrics.recoveredErrors++;
      if (errorData.recoveryTime) {
        this.summaryMetrics.totalRecoveryTime += errorData.recoveryTime;
        this.summaryMetrics.avgRecoveryTime = 
          this.summaryMetrics.totalRecoveryTime / this.summaryMetrics.recoveredErrors;
      }
    }

    // Add timestamp and stack trace to log entry
    const logEntry = {
      timestamp: new Date().toISOString(),
      ...errorData,
      stack: errorData.error?.stack || errorData.stack || 'No stack trace available'
    };

    // Write to log file
    const logFile = this.getCurrentLogFile();
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
  }

  getCurrentLogFile() {
    const date = new Date().toISOString().split('T')[0];
    return path.join(this.logDir, `errors_${date}.json`);
  }

  rotateLogFileIfNeeded() {
    const logFile = this.getCurrentLogFile();
    
    if (this.currentLogFile !== logFile) {
      this.currentLogFile = logFile;
      if (!fs.existsSync(logFile)) {
        fs.writeFileSync(logFile, '');
      }
    }

    if (fs.existsSync(logFile) && fs.statSync(logFile).size > this.maxFileSize) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedFile = `${logFile}.${timestamp}`;
      fs.renameSync(logFile, rotatedFile);
      fs.writeFileSync(logFile, '');
    }
  }

  getErrorSummary() {
    return {
      ...this.summaryMetrics,
      errorRate: this.summaryMetrics.totalErrors / (Date.now() - this.startTime),
      recoveryRate: this.summaryMetrics.recoveredErrors / this.summaryMetrics.totalErrors,
      criticalErrorRate: this.summaryMetrics.criticalErrors / this.summaryMetrics.totalErrors
    };
  }
}

module.exports = ErrorLogger;
