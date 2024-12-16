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
      errorsByTimestamp: {},
      mostFrequentErrors: [],
      lastError: null,
      averageErrorsPerHour: 0
    };

    // Ensure log directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    this.rotateLogFileIfNeeded();
  }

  rotateLogFileIfNeeded() {
    const timestamp = new Date().toISOString().split('T')[0];
    const newLogFile = path.join(this.logDir, `errors-${timestamp}.log`);

    if (this.currentLogFile !== newLogFile) {
      this.currentLogFile = newLogFile;
    }

    if (fs.existsSync(this.currentLogFile)) {
      const stats = fs.statSync(this.currentLogFile);
      if (stats.size >= this.maxFileSize) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rotatedFile = path.join(this.logDir, `errors-${timestamp}.log`);
        fs.renameSync(this.currentLogFile, rotatedFile);
      }
    }
  }

  logError(error, component = 'unknown', additionalContext = {}) {
    this.rotateLogFileIfNeeded();

    const timestamp = new Date().toISOString();
    const errorType = error.name || 'UnknownError';
    const errorMessage = error.message || 'No error message provided';
    const stackTrace = error.stack || 'No stack trace available';

    const logEntry = {
      timestamp,
      errorType,
      component,
      message: errorMessage,
      stackTrace,
      context: additionalContext
    };

    // Update summary metrics
    this.summaryMetrics.totalErrors++;
    this.summaryMetrics.lastError = {
      timestamp,
      type: errorType,
      component,
      message: errorMessage
    };

    // Update error type counts
    this.summaryMetrics.errorsByType[errorType] = 
      (this.summaryMetrics.errorsByType[errorType] || 0) + 1;

    // Update component counts
    this.summaryMetrics.errorsByComponent[component] = 
      (this.summaryMetrics.errorsByComponent[component] || 0) + 1;

    // Update timestamp metrics
    const hourKey = timestamp.split(':')[0];
    this.summaryMetrics.errorsByTimestamp[hourKey] = 
      (this.summaryMetrics.errorsByTimestamp[hourKey] || 0) + 1;

    // Write to log file
    const logString = JSON.stringify(logEntry, null, 2) + '\n';
    fs.appendFileSync(this.currentLogFile, logString);

    this.updateMostFrequentErrors();
    this.calculateAverageErrorsPerHour();
  }

  updateMostFrequentErrors() {
    const errorTypes = Object.entries(this.summaryMetrics.errorsByType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => ({ type, count }));

    this.summaryMetrics.mostFrequentErrors = errorTypes;
  }

  calculateAverageErrorsPerHour() {
    const timestamps = Object.keys(this.summaryMetrics.errorsByTimestamp);
    if (timestamps.length > 0) {
      const totalErrors = Object.values(this.summaryMetrics.errorsByTimestamp)
        .reduce((sum, count) => sum + count, 0);
      this.summaryMetrics.averageErrorsPerHour = totalErrors / timestamps.length;
    }
  }

  getSummaryMetrics() {
    return this.summaryMetrics;
  }

  clearMetrics() {
    this.summaryMetrics = {
      totalErrors: 0,
      errorsByType: {},
      errorsByComponent: {},
      errorsByTimestamp: {},
      mostFrequentErrors: [],
      lastError: null,
      averageErrorsPerHour: 0
    };
  }
}

module.exports = ErrorLogger;
