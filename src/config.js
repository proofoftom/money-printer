module.exports = {
  // Wallet configuration
  WALLET: {
    INITIAL_BALANCE: 3.0, // Initial wallet balance in SOL
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

  // Safety configuration
  SAFETY: {
    // Market cap thresholds in USD
    MIN_MARKET_CAP_USD: 5000, // Lowered from 10000 to catch smaller opportunities
    MAX_MARKET_CAP_USD: 5000000, // Increased from 1M to allow more opportunities
    SOL_PRICE_USD: 100, // Reference price for calculations

    // Time-based parameters
    MIN_TOKEN_AGE_SECONDS: 1800, // Reduced from 3600 to enter earlier
    MAX_HOLD_TIME_SECONDS: 7200, // Reduced from 14400 for faster turnover

    // Price action thresholds
    MAX_PUMP_MULTIPLE: 5, // Reduced from 10 to take profits earlier
    MAX_PRICE_VOLATILITY: 40, // Increased from 30 to allow more volatile tokens
    MAX_DRAWDOWN_PERCENTAGE: 25, // Kept the same for risk management

    // Trading pattern requirements
    MIN_UNIQUE_BUYERS: 40, // Reduced from 50 to enter earlier
    MAX_AVG_TRADE_SIZE_USD: 2000, // Reduced from 5000 to allow smaller trades
    MIN_BUY_SELL_RATIO: 0.35, // Reduced from 0.4 to be less strict
    MAX_SINGLE_WALLET_VOLUME: 20, // Increased from 15 to allow more concentrated trading

    // Holder distribution requirements
    MIN_HOLDERS: 100, // Reduced from 150 for earlier entry
    MAX_TOP_HOLDER_CONCENTRATION: 30, // Increased from 25 to allow more concentration
    MIN_HOLDER_WALLET_AGE: 7, // Reduced from 10 days for earlier entry

    // Volume pattern requirements
    MIN_VOLUME_PRICE_CORRELATION: 0.6, // Reduced from 0.7 to be less strict
    MAX_WASH_TRADE_PERCENTAGE: 15, // Increased from 10 to allow more wash trading
  },

  // Position sizing
  POSITION: {
    // Entry parameters
    MAX_POSITION_SIZE_SOL: 2.0, // Increased to allow larger positions
    MIN_POSITION_SIZE_SOL: 0.1, // Kept the same
    POSITION_SIZE_MARKET_CAP_RATIO: 0.01, // Increased to get meaningful position sizes
    MAX_PRICE_IMPACT_BPS: 100, // Increased from 50 to allow larger trades

    // Dynamic position sizing
    USE_DYNAMIC_SIZING: true,
    VOLATILITY_SCALING_FACTOR: 0.01, // Reduced to make volatility have less impact
    LIQUIDITY_SCALING_FACTOR: 0.7, // Scales position size based on liquidity

    // Exit parameters
    STOP_LOSS_PERCENTAGE: 7.5, // Tightened from 10 for faster exits
    TRAILING_STOP_ACTIVATION: 5, // Reduced from 10 to lock in profits earlier
    TRAILING_STOP_DISTANCE: 3, // Reduced from 5 to lock in more profits

    // Take profit tiers
    TAKE_PROFIT_TIERS: [
      { percentage: 10, size: 0.3 }, // First tier earlier
      { percentage: 20, size: 0.3 }, // Second tier earlier
      { percentage: 30, size: 0.4 }, // Final tier earlier
    ],

    // Volume-based exit
    VOLUME_DROP_EXIT_THRESHOLD: 0.6, // Increased from 0.5 to be less sensitive
    PEAK_VOLUME_WINDOW: 300, // Reduced from 600 for faster reaction
  },

  // Exit strategies configuration
  EXIT_STRATEGIES: {
    STOP_LOSS: {
      ENABLED: true,
      THRESHOLD: -7.5, // Exit when loss exceeds 7.5%
      TRAILING: false,
    },
    TRAILING_STOP: {
      ENABLED: true,
      ACTIVATION_THRESHOLD: 5, // Start trailing after 5% profit
      BASE_PERCENTAGE: 3, // Base trailing distance is 3%
      DYNAMIC_ADJUSTMENT: {
        ENABLED: true,
        VOLATILITY_MULTIPLIER: 0.5, // Increase trail by 0.5x volatility
        MIN_PERCENTAGE: 2, // Minimum trail percentage
        MAX_PERCENTAGE: 10, // Maximum trail percentage
      },
    },
    VOLUME_BASED: {
      ENABLED: true,
      VOLUME_DROP_THRESHOLD: 60, // Exit if volume drops below 60% of peak
      MEASUREMENT_PERIOD: 300, // Look at volume over 5 minutes (300 seconds)
      MIN_PEAK_VOLUME: 1000, // Minimum peak volume in SOL to consider
    },
    TIME_BASED: {
      ENABLED: true,
      MAX_HOLD_TIME: 7200, // 2 hours in seconds
      EXTENSION_THRESHOLD: 40, // Extend time if profit > 40%
      EXTENSION_TIME: 900, // Add 15 minutes if above threshold
    },
    TAKE_PROFIT: {
      ENABLED: true,
      TIERS: [
        { THRESHOLD: 10, PORTION: 0.3 }, // At 10% profit, take 30%
        { THRESHOLD: 20, PORTION: 0.3 }, // At 20% profit, take another 30%
        { THRESHOLD: 30, PORTION: 0.4 }, // At 30% profit, take final 40%
      ],
    },
  },

  // WebSocket configuration
  WEBSOCKET: {
    URL: "wss://pumpportal.fun/data-api/real-time",
    RECONNECT_TIMEOUT: 5000, // 5 seconds
    PING_INTERVAL: 30000, // 30 seconds
    PONG_TIMEOUT: 10000, // 10 seconds
    MAX_RETRIES: 5,
  },

  // Transaction simulation settings
  TRANSACTION: {
    SIMULATION_MODE: {
      ENABLED: true, // Toggle between simulation and real transactions
      AVG_BLOCK_TIME: 0.4, // Average Solana block time in seconds
      PRICE_IMPACT: {
        ENABLED: true,
        SLIPPAGE_BASE: 1, // Base slippage percentage
        VOLUME_MULTIPLIER: 1.2, // Additional slippage per 1000 SOL volume
      },
      NETWORK_DELAY: {
        MIN_MS: 50, // Minimum network delay in milliseconds
        MAX_MS: 200, // Maximum network delay in milliseconds
        CONGESTION_MULTIPLIER: 1.5, // Delay multiplier during high congestion
      },
    },
  },
};
