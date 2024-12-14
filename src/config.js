module.exports = {
  // Wallet configuration
  WALLET: {
    INITIAL_BALANCE: 1.0, // Initial wallet balance in SOL
  },

  // Market thresholds
  THRESHOLDS: {
    MAX_ENTRY_CAP: 250, // Maximum market cap in SOL for entry
    DEAD: 5, // Minimum market cap in SOL to consider token dead
    FIRST_PUMP: 14000, // Market cap threshold for first pump in SOL
    PUMP_DRAWDOWN: 20, // Maximum drawdown percentage allowed
    MAX_INITIAL_PRICE_MULT: 3, // Maximum multiplier from initial price for entry
    MIN_TIME_SINCE_CREATION: 30, // Minimum seconds since token creation
    MIN_LIQUIDITY: 2, // Minimum liquidity in SOL
    MIN_LIQUIDITY_RATIO: 0.05, // Minimum liquidity to market cap ratio (5%)
    MAX_LIQUIDITY_RATIO: 0.95, // Maximum liquidity to market cap ratio (95%)
    RECOVERY: 10, // Percentage recovery from drawdown low to consider recovery
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
