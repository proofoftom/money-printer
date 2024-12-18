const ErrorLogger = require('./errorLogger');

// Create a singleton instance
const errorLogger = new ErrorLogger();

// Export the singleton instance
module.exports = errorLogger;
