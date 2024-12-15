module.exports = {
  // Wallet configuration
  WALLET: {
    INITIAL_BALANCE: 1.0, // Initial wallet balance in SOL
  },

  // Market thresholds
  THRESHOLDS: {
    // Market Cap Thresholds (in USD)
    MAX_ENTRY_CAP_USD: 30000, // Maximum market cap in USD for entry ($30k)
    DEAD_USD: 10000, // Consider token dead if it drops below $10k after pumping
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
    STOP_LOSS: {
      ENABLED: true,
      THRESHOLD: -5, // Exit when loss exceeds 5%
    },
    TRAILING_STOP: {
      ENABLED: true,
      ACTIVATION_THRESHOLD: 15, // Start trailing after 15% profit
      BASE_PERCENTAGE: 10, // Base trailing distance is 10%
      DYNAMIC_ADJUSTMENT: {
        ENABLED: true,
        VOLATILITY_MULTIPLIER: 0.5, // Increase trail by 0.5x volatility
        MIN_PERCENTAGE: 5, // Minimum trail percentage
        MAX_PERCENTAGE: 20, // Maximum trail percentage
      },
    },
    VOLUME_BASED: {
      ENABLED: true,
      VOLUME_DROP_THRESHOLD: 50, // Exit if volume drops below 50% of peak
      MEASUREMENT_PERIOD: 300, // Look at volume over 5 minutes (300 seconds)
      MIN_PEAK_VOLUME: 1000, // Minimum peak volume in SOL to consider
    },
    TIME_BASED: {
      ENABLED: true,
      MAX_HOLD_TIME: 1800, // 30 minutes in seconds
      EXTENSION_THRESHOLD: 40, // Extend time if profit > 40%
      EXTENSION_TIME: 900, // Add 15 minutes if above threshold
    },
    TAKE_PROFIT: {
      ENABLED: true,
      TIERS: [
        { THRESHOLD: 20, PORTION: 0.4 }, // At 20% profit, take 40%
        { THRESHOLD: 40, PORTION: 0.4 }, // At 40% profit, take another 40%
        { THRESHOLD: 60, PORTION: 0.2 }, // At 60% profit, take final 20%
      ],
    },
  },
};
