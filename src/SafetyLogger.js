const fs = require('fs');
const path = require('path');

class SafetyLogger {
  constructor(options = {}) {
    this.maxFileSize = options.maxFileSize || 500 * 1024 * 1024; // 500 MB default
    this.logDir = options.logDir || 'logs/safety';
    this.currentLogFile = null;
    this.summaryMetrics = {
      totalChecks: 0,
      approvedChecks: 0,
      rejectedChecks: 0,
      rejectionsByCategory: {},
      avgCheckDuration: 0,
      totalCheckDuration: 0
    };

    // Ensure log directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    this.rotateLogFileIfNeeded();
  }

  logSafetyCheck(checkData) {
    this.rotateLogFileIfNeeded();
    
    // Update summary metrics
    this.summaryMetrics.totalChecks++;
    if (checkData.approved) {
      this.summaryMetrics.approvedChecks++;
    } else {
      this.summaryMetrics.rejectedChecks++;
      if (checkData.rejectionCategory) {
        this.summaryMetrics.rejectionsByCategory[checkData.rejectionCategory] = 
          (this.summaryMetrics.rejectionsByCategory[checkData.rejectionCategory] || 0) + 1;
      }
    }

    // Update duration metrics
    this.summaryMetrics.totalCheckDuration += checkData.duration;
    this.summaryMetrics.avgCheckDuration = 
      this.summaryMetrics.totalCheckDuration / this.summaryMetrics.totalChecks;

    // Add timestamp to log entry
    const logEntry = {
      timestamp: new Date().toISOString(),
      ...checkData
    };

    // Write to log file
    fs.appendFileSync(
      this.currentLogFile,
      JSON.stringify(logEntry) + '\n',
      'utf8'
    );
  }

  rotateLogFileIfNeeded() {
    const date = new Date().toISOString().split('T')[0];
    const newLogFile = path.join(this.logDir, `safety_checks_${date}.json`);

    // Create initial empty file if it doesn't exist
    if (!fs.existsSync(newLogFile)) {
      fs.mkdirSync(path.dirname(newLogFile), { recursive: true });
      fs.writeFileSync(newLogFile, '[]', 'utf8');
    }

    // Check if we need to rotate due to size
    if (this.currentLogFile === newLogFile) {
      const stats = fs.statSync(newLogFile);
      if (stats.size >= this.maxFileSize) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const archiveFile = path.join(this.logDir, `safety_checks_${date}_${timestamp}.json`);
        fs.renameSync(newLogFile, archiveFile);
        fs.writeFileSync(newLogFile, '[]', 'utf8');
      }
    }

    // Clean up old log files if total size exceeds limit
    this.cleanupOldLogs();
    this.currentLogFile = newLogFile;
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
      if (totalSize > this.maxFileSize) {
        fs.unlinkSync(file.path);
      }
    }
  }

  getSummaryMetrics() {
    return {
      ...this.summaryMetrics,
      avgCheckDuration: Math.round(this.summaryMetrics.avgCheckDuration)
    };
  }
}

module.exports = SafetyLogger;
