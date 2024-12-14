module.exports = {
  // Wallet configuration
  WALLET: {
    INITIAL_BALANCE: 1.0, // Initial wallet balance in SOL
  },

  // Market thresholds
  THRESHOLDS: {
    // Market Cap Thresholds (in USD)
    MAX_ENTRY_CAP_USD: 50000, // Maximum market cap in USD for entry ($50k)
    DEAD_USD: 6500, // Consider token dead if it drops below $6.5k after pumping
    HEATING_UP_USD: 15000, // Market cap threshold to consider token heating up ($15k)
    FIRST_PUMP_USD: 25000, // Market cap threshold for first pump ($25k)
    PUMP_DRAWDOWN: 20, // Percentage drawdown to enter recovery mode
    RECOVERY: 10, // Percentage recovery needed to enter position

    // Time and Age Thresholds
    MIN_TIME_SINCE_CREATION: 30, // Minimum seconds since token creation
    MIN_HOLDER_WALLET_AGE: 7, // Minimum age of holder wallets in days

    // Holder Distribution Thresholds
    MIN_HOLDERS: 25, // Minimum number of unique holders
    MAX_TOP_HOLDER_CONCENTRATION: 30, // Maximum percentage of supply held by top holders
    
    // Price Action Thresholds
    MAX_INITIAL_PRICE_MULT: 3, // Maximum multiplier from initial price
    MAX_PRICE_VOLATILITY: 50, // Maximum price volatility percentage

    // Trading Pattern Thresholds
    MIN_UNIQUE_BUYERS: 15, // Minimum number of unique buyers
    MAX_AVG_TRADE_SIZE_USD: 500, // Maximum average trade size in USD
    MIN_BUY_SELL_RATIO: 0.6, // Minimum ratio of buys to total trades
    MAX_SINGLE_WALLET_VOLUME: 25, // Maximum percentage of volume from a single wallet

    // Volume Pattern Thresholds
    MIN_VOLUME_PRICE_CORRELATION: 0.5, // Minimum correlation between volume and price
    MAX_WASH_TRADE_PERCENTAGE: 20, // Maximum percentage of suspected wash trades
  },

  // Position sizing
  POSITION: {
    SIZE: 0.2, // Position size in SOL
    MIN_SIZE_SOL: 0.05, // Minimum position size
    MAX_SIZE_SOL: 1.0, // Maximum position size
  },

  // Exit strategies configuration
  EXIT_STRATEGIES: {
    TIER_1: {
      THRESHOLD: 15,
      PORTION: 0.5
    },
    TIER_2: {
      THRESHOLD: 25,
      PORTION: 0.5
    },
    TIER_3: {
      THRESHOLD: 40,
      PORTION: 1.0
    }
  },
};
