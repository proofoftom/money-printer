module.exports = {
  // Wallet configuration
  WALLET: {
    INITIAL_BALANCE: 3.0, // Initial wallet balance in SOL
  },

  // Trader configuration
  TRADER: {
    SAVE_INTERVAL: 60000, // Save trader data every minute
    ANALYSIS_INTERVAL: 300000, // Analyze patterns every 5 minutes
    MAX_TRADES_AGE: 1800000, // Keep trades for 30 minutes
    RELATIONSHIP_THRESHOLD: 3, // Minimum number of common trades to establish relationship
    WASH_TRADE_THRESHOLD: 0.9, // Ratio of buy/sell volume to consider wash trading
  },

  // Market thresholds
  THRESHOLDS: {
    // Market Cap Thresholds (in USD)
    MAX_ENTRY_CAP_USD: 75000, // Increased to catch larger pump.fun tokens
    DEAD_USD: 5000, // Lower threshold for considering token dead
    HEATING_UP_USD: 8000, // Threshold for heating up
    FIRST_PUMP_USD: 12000, // Threshold for first pump
    PUMP_DRAWDOWN: 25, // Increased for significant drawdown detection
    RECOVERY: 15, // Recovery threshold after drawdown
    SAFE_RECOVERY_GAIN: 18, // Safe recovery confirmation threshold

    // Recovery Pattern Thresholds
    MIN_RECOVERY_STRENGTH: 65, // Minimum recovery strength score
    MIN_BUY_PRESSURE: 70, // Minimum buy pressure during recovery
    MIN_MARKET_STRUCTURE_SCORE: 75, // Minimum market structure health
    MAX_RECOVERY_VOLATILITY: 45, // Maximum volatility during recovery

    // Time and Age Thresholds
    MIN_TIME_SINCE_CREATION: 30, // Increased for more established tokens
    MIN_HOLDER_WALLET_AGE: 10, // More established holder base

    // Holder Distribution Thresholds
    MIN_HOLDERS: 30, // Higher minimum holders for better liquidity
    MAX_TOP_HOLDER_CONCENTRATION: 30, // Stricter concentration limit

    // Price Action Thresholds
    MAX_INITIAL_PRICE_MULT: 3, // Lower multiplier for more stable entries
    MAX_PRICE_VOLATILITY: 60, // Reduced volatility tolerance

    // Volume Pattern Thresholds
    MIN_VOLUME_PRICE_CORRELATION: 0.6, // Higher correlation requirement
    MAX_WASH_TRADE_PERCENTAGE: 20, // Stricter wash trading limit

    // Recovery pattern detection
    RECOVERY_DETECTION: {
      MIN_DRAWDOWN: 25, // Minimum drawdown to consider for recovery
    },

    PUMP: {
      PRICE_CHANGE_1M: 10,    // 10% price increase in 1 minute
      PRICE_CHANGE_5M: 25,    // 25% price increase in 5 minutes
      VOLUME_CHANGE: 200,     // 200% volume increase
      BUY_PRESSURE: 65,       // 65% of volume is buys
    },

    DRAWDOWN: -25,           // 25% drawdown from peak
    RECOVERY: 10,            // 10% recovery from bottom
    SAFE_RECOVERY_GAIN: 15,  // Maximum 15% gain from bottom for position entry
  },

  // Safety configuration
  SAFETY: {
    MIN_TOKEN_AGE_SECONDS: 30,
    MIN_LIQUIDITY_SOL: 0.5, // Increased minimum liquidity
    MAX_PRICE_VOLATILITY: 1.2, // Reduced volatility tolerance
    MAX_TOP_HOLDER_CONCENTRATION: 35,
    MAX_CREATOR_HOLDINGS: 25,
    MIN_HOLDERS: 15,
    MAX_SUPPLY_CONCENTRATION: 40,

    // Recovery pattern detection
    RECOVERY_DETECTION: {
      MIN_DRAWDOWN: 25, // Minimum drawdown to consider for recovery
      MIN_RECOVERY_RATE: 0.4, // Minimum recovery rate per minute
      MIN_BUY_PRESSURE: 70, // Minimum buy pressure during recovery
      MIN_STRENGTH_SCORE: 65, // Minimum recovery strength score
      MAX_VOLATILITY: 45, // Maximum volatility during recovery
      MIN_MARKET_STRUCTURE: 75, // Minimum market structure score
      RECOVERY_WINDOW_MS: 300000, // 5-minute window for recovery analysis
    },
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

  // Position Manager configuration
  POSITION_MANAGER: {
    CLEAR_ON_STARTUP: true, // Set to true to clear positions on startup (for testing)
    SAVE_INTERVAL: 30000, // Save positions every 30 seconds
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
      ACTIVATION_THRESHOLD: 8, // Start trailing after 8% profit
      BASE_PERCENTAGE: 4, // Base trailing distance is 4%
      DYNAMIC_ADJUSTMENT: {
        ENABLED: true,
        VOLATILITY_MULTIPLIER: 0.6,
        MIN_PERCENTAGE: 3,
        MAX_PERCENTAGE: 12,
      },
    },
    VOLUME_BASED: {
      ENABLED: true,
      VOLUME_DROP_THRESHOLD: 50,
      MEASUREMENT_PERIOD: 180, // Reduced to 3 minutes for faster reaction
      MIN_PEAK_VOLUME: 1500,
      MIN_BUY_PRESSURE: 65, // Minimum buy pressure to maintain
    },
    REVERSAL: {
      THRESHOLD: 12, // Exit on 12% reversal from local high
    },
    TAKE_PROFIT: {
      ENABLED: true,
      TIERS: [
        { THRESHOLD: 15, PORTION: 0.2 }, // First take profit at 15%
        { THRESHOLD: 30, PORTION: 0.3 }, // Second at 30%
        { THRESHOLD: 50, PORTION: 0.3 }, // Third at 50%
        { THRESHOLD: 80, PORTION: 0.2 }, // Final at 80%
      ],
    },
    RECOVERY: {
      MIN_STRENGTH: 65, // Minimum recovery strength to maintain
      MIN_STRUCTURE_SCORE: 75, // Minimum market structure score
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

  // Testing and Data Management
  TESTING: {
    CLEAR_DATA_ON_START: process.env.CLEAR_DATA_ON_START === "true" || false,
    DATA_DIR: "data",
  },
};
