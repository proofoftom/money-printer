const fs = require('fs');
const path = require('path');

class ErrorLogger {
  constructor(options = {}) {
    this.maxFileSize = options.maxFileSize || 500 * 1024 * 1024; // 500 MB default
    
    // Use absolute path for log directory
    const rootDir = path.dirname(require.main.filename);
    this.logDir = options.logDir 
      ? path.resolve(options.logDir)
      : path.join(rootDir, '..', 'logs', 'errors');
    
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

    try {
      // Ensure log directory exists
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      this.rotateLogFileIfNeeded();
    } catch (err) {
      console.error('Failed to initialize error logger:', err);
      // Fall back to console.error if we can't write to files
      this.useConsoleOnly = true;
    }
  }

  rotateLogFileIfNeeded() {
    try {
      const timestamp = new Date().toISOString().split('T')[0];
      const newLogFile = path.join(this.logDir, `errors_${timestamp}.json`);

      if (this.currentLogFile !== newLogFile) {
        this.currentLogFile = newLogFile;
        // Create the file if it doesn't exist with valid JSON array
        if (!fs.existsSync(this.currentLogFile)) {
          fs.writeFileSync(this.currentLogFile, '[\n', 'utf8');
        }
      }

      if (fs.existsSync(this.currentLogFile)) {
        const stats = fs.statSync(this.currentLogFile);
        if (stats.size >= this.maxFileSize) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const rotatedFile = path.join(this.logDir, `errors_${timestamp}.json`);
          fs.renameSync(this.currentLogFile, rotatedFile);
          // Create new file with valid JSON array
          fs.writeFileSync(this.currentLogFile, '[\n', 'utf8');
        }
      }
    } catch (err) {
      console.error('Failed to rotate log file:', err);
      this.useConsoleOnly = true;
    }
  }

  logError(error, component = 'unknown', additionalContext = {}) {
    try {
      // Ensure error is an Error object
      const errorObj = error instanceof Error ? error : new Error(error?.toString() || 'Unknown error');
      
      this.rotateLogFileIfNeeded();

      const timestamp = new Date().toISOString();
      const errorType = errorObj.name || 'UnknownError';
      const errorMessage = errorObj.message || 'No error message provided';
      const stackTrace = errorObj.stack || new Error().stack;

      const logEntry = {
        timestamp,
        errorType,
        component,
        message: errorMessage,
        stackTrace,
        context: {
          ...additionalContext,
          processUptime: process.uptime(),
          memoryUsage: process.memoryUsage()
        }
      };

      // Update summary metrics
      this.updateMetrics(logEntry);

      // Write to log file or console
      if (!this.useConsoleOnly) {
        try {
          // Append to JSON array with proper formatting
          const logString = JSON.stringify(logEntry, null, 2);
          fs.appendFileSync(this.currentLogFile, logString + ',\n');
        } catch (writeErr) {
          console.error('Failed to write to log file:', writeErr);
          this.useConsoleOnly = true;
          // Fall back to console logging
          console.error('Error Log Entry:', logEntry);
        }
      } else {
        console.error('Error Log Entry:', logEntry);
      }
    } catch (err) {
      // Last resort error handling
      console.error('Critical error in error logger:', err);
      console.error('Original error:', error);
    }
  }

  updateMetrics(logEntry) {
    try {
      const { errorType, component, timestamp } = logEntry;
      
      this.summaryMetrics.totalErrors++;
      this.summaryMetrics.lastError = {
        timestamp,
        type: errorType,
        component,
        message: logEntry.message
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

      this.updateMostFrequentErrors();
      this.calculateAverageErrorsPerHour();
    } catch (err) {
      console.error('Failed to update error metrics:', err);
    }
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
