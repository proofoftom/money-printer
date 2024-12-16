module.exports = {
  // Wallet configuration
  WALLET: {
    INITIAL_BALANCE: 3.0, // Initial wallet balance in SOL
  },

  // Market thresholds
  THRESHOLDS: {
    // Market Cap Thresholds (in USD)
    MAX_ENTRY_CAP_USD: 50000, // Increased to catch larger pumps ($50k)
    DEAD_USD: 7000, // Lower threshold for considering token dead ($5k)
    HEATING_UP_USD: 9000, // Lower threshold for heating up ($7k)
    FIRST_PUMP_USD: 10000, // Lower threshold for first pump ($10k)
    PUMP_DRAWDOWN: 15, // Reduced drawdown for quicker recovery entry
    RECOVERY: 8, // Lower recovery threshold for faster reentry
    SAFE_RECOVERY_GAIN: 12, // Lower safe recovery threshold

    // Time and Age Thresholds
    MIN_TIME_SINCE_CREATION: 20, // Reduced minimum time for faster entry
    MIN_HOLDER_WALLET_AGE: 5, // Reduced minimum holder age

    // Holder Distribution Thresholds
    MIN_HOLDERS: 20, // Lower minimum holders requirement
    MAX_TOP_HOLDER_CONCENTRATION: 35, // Allow higher concentration for early entry

    // Price Action Thresholds
    MAX_INITIAL_PRICE_MULT: 4, // Allow higher initial price multiplier
    MAX_PRICE_VOLATILITY: 75, // Increased volatility tolerance

    // Trading Pattern Thresholds
    MAX_AVG_TRADE_SIZE_USD: 750, // Increased maximum trade size
    MIN_BUY_SELL_RATIO: 0.5, // Lower buy/sell ratio requirement
    MAX_SINGLE_WALLET_VOLUME: 30, // Allow higher single wallet volume

    // Volume Pattern Thresholds
    MIN_VOLUME_PRICE_CORRELATION: 0.4, // Lower correlation requirement
    MAX_WASH_TRADE_PERCENTAGE: 25, // Slightly increased wash trade tolerance

    // Pump token specific thresholds
    PUMP: 25, // Lower pump threshold for faster entry
    RECOVERY: 12, // Faster recovery threshold
    SAFE_RECOVERY_GAIN: 20, // Lower safe recovery gain requirement
    DEAD: -20, // Higher dead threshold for faster exit
  },

  // Safety configuration
  SAFETY: {
    MIN_TOKEN_AGE_SECONDS: 60,
    MIN_LIQUIDITY_SOL: 0.1,
    MAX_PRICE_VOLATILITY: 1.5,
    MAX_TOP_HOLDER_CONCENTRATION: 40,
    MAX_CREATOR_HOLDINGS: 30,
    MIN_HOLDERS: 5,
    MAX_SUPPLY_CONCENTRATION: 50,

    // Pump pattern detection thresholds
    PUMP_DETECTION: {
      MIN_PRICE_ACCELERATION: 0.3,    // Minimum price acceleration to consider
      MIN_VOLUME_SPIKE: 150,          // Minimum volume spike percentage
      MIN_PRICE_VOLUME_CORRELATION: 0.2, // Minimum correlation between price and volume
      MIN_GAIN_RATE: 1.0,            // Minimum gain rate per second
      MIN_MC_GAIN_RATE: 0.5,         // Minimum market cap gain rate for large tokens
      LARGE_TOKEN_MC_USD: 20000,     // Threshold for large token market cap
      MIN_PUMP_COUNT: 1,             // Minimum number of pumps
      PUMP_WINDOW_MS: 300000,        // Time window for pump count (5 minutes)
    }
  },

  // Position sizing
  POSITION: {
    MAX_POSITION_SIZE_SOL: 2.5, // Increased maximum position
    MIN_POSITION_SIZE_SOL: 0.1,
    POSITION_SIZE_MARKET_CAP_RATIO: 0.015, // Increased for larger positions
    MAX_PRICE_IMPACT_BPS: 120, // Allow higher price impact

    // Dynamic position sizing
    USE_DYNAMIC_SIZING: true,
    VOLATILITY_SCALING_FACTOR: 0.008, // Reduced impact of volatility
    LIQUIDITY_SCALING_FACTOR: 0.8, // Increased liquidity scaling

    // Exit parameters
    STOP_LOSS_PERCENTAGE: 12, // Tighter stop loss
    TRAILING_STOP_ACTIVATION: 4, // Earlier trailing stop
    TRAILING_STOP_DISTANCE: 2.5, // Tighter trailing stop

    // Take profit tiers
    TAKE_PROFIT_TIERS: [
      { percentage: 15, size: 0.3 }, // Take profits earlier
      { percentage: 40, size: 0.4 }, // Take more at medium gains
      { percentage: 80, size: 0.3 }, // Take final profits sooner
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
