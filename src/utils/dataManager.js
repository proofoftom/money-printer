const fs = require('fs');
const path = require('path');
const config = require('./config');
const errorLogger = require('../monitoring/errorLoggerInstance');

class DataManager {
  static getDataDir() {
    return path.join(process.cwd(), config.TESTING.DATA_DIR);
  }

  static clearAllData() {
    const dataDir = this.getDataDir();
    
    try {
      // Check if data directory exists
      if (!fs.existsSync(dataDir)) {
        return;
      }

      // Read all files in the data directory
      const files = fs.readdirSync(dataDir);
      
      for (const file of files) {
        const filePath = path.join(dataDir, file);
        
        // Skip if it's not a JSON file
        if (!file.endsWith('.json')) continue;
        
        try {
          // Remove the file
          fs.unlinkSync(filePath);
          console.log(`Cleared data file: ${file}`);
        } catch (error) {
          errorLogger.logError(error, 'DataManager.clearAllData', { file });
        }
      }
      
      console.log('All data files cleared successfully');
    } catch (error) {
      errorLogger.logError(error, 'DataManager.clearAllData');
      throw error;
    }
  }

  static ensureDataDirectory() {
    const dataDir = this.getDataDir();
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    return dataDir;
  }
}

module.exports = DataManager;
