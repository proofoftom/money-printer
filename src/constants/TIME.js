const TIME = {
  AGGREGATION_THRESHOLDS: {
    FIVE_MIN: 300000,    // 5 minutes in ms
    THIRTY_MIN: 1800000, // 30 minutes in ms
    ONE_HOUR: 3600000    // 1 hour in ms
  },
  TIMEFRAMES: {
    SECONDLY: 1000,      // 1 second in ms
    FIVE_SECONDS: 5000,  // 5 seconds in ms
    THIRTY_SECONDS: 30000, // 30 seconds in ms
    MINUTE: 60000        // 1 minute in ms
  }
};

module.exports = TIME;
