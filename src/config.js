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
      MIN_PRICE_ACCELERATION: 0.25,
      MIN_VOLUME_SPIKE: 120,
      MIN_PRICE_VOLUME_CORRELATION: 0.15,
      MIN_GAIN_RATE: 0.8,
      MIN_MC_GAIN_RATE: 0.4,
      LARGE_TOKEN_MC_USD: 25000,
      MIN_PUMP_COUNT: 1,
      PUMP_WINDOW_MS: 360000,
    },
  },

  // Token state management configuration
  TOKEN_MANAGER: {
    CLEAR_ON_STARTUP: false,
    SAVE_INTERVAL: 60000, // Save state every minute
    HEATING_PERIOD: 300000, // 5 minutes in heating up state
    VOLUME_THRESHOLD: 1, // Minimum volume in SOL to transition to active
    PRICE_HISTORY_LENGTH: 1000, // Maximum number of price points to keep
    VOLUME_HISTORY_LENGTH: 1000, // Maximum number of volume points to keep
    
    // State transition thresholds
    DRAWDOWN_THRESHOLD: 0.7, // Market strength threshold for entering drawdown
    RECOVERY_THRESHOLD: 0.5, // Market strength threshold for recovery
  },

  // Position manager configuration
  POSITION_MANAGER: {
    CLEAR_ON_STARTUP: false,
    SAVE_INTERVAL: 60000, // Save state every minute
    MAX_HISTORY_ITEMS: 1000,
  },

  // Position configuration
  POSITION: {
    MAX_POSITION_SIZE_SOL: 2.5,
    MIN_POSITION_SIZE_SOL: 0.1,
    POSITION_SIZE_MARKET_CAP_RATIO: 0.015,
    MAX_PRICE_IMPACT_BPS: 120,
    USE_DYNAMIC_SIZING: true,
    VOLATILITY_SCALING_FACTOR: 0.008,
    LIQUIDITY_SCALING_FACTOR: 0.8,
    STOP_LOSS_PERCENTAGE: 12,
    TRAILING_STOP_ACTIVATION: 4,
    TRAILING_STOP_DISTANCE: 2.5,
    TAKE_PROFIT_TIERS: [
      { percentage: 15, size: 0.3 },
      { percentage: 40, size: 0.4 },
      { percentage: 100, size: 0.3 }
    ]
  },

  // Storage configuration
  STORAGE: {
    CLEAR_ON_STARTUP: false, // Whether to clear stored data on startup
    PERSIST_INTERVAL: 300000, // How often to save state to disk (5 minutes)
    MAX_HISTORY_ITEMS: 1000, // Maximum number of historical items to keep
    BACKUP_ENABLED: true, // Whether to create backups
    BACKUP_INTERVAL: 3600000, // Backup interval (1 hour)
    MAX_BACKUPS: 24, // Maximum number of backup files to keep
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

  // Exit strategies configuration
  EXIT_STRATEGIES: {
    STOP_LOSS: {
      ENABLED: true,
      THRESHOLD: -7.5,
      TRAILING: false
    },
    TAKE_PROFIT: {
      ENABLED: true,
      TIERS: [
        { threshold: 15, percentage: 30 },
        { threshold: 40, percentage: 40 },
        { threshold: 100, percentage: 30 }
      ]
    },
    VOLUME_BASED: {
      ENABLED: true,
      VOLUME_DROP_THRESHOLD: 50,
      TIME_WINDOW: 300000
    },
    TIME_BASED: {
      ENABLED: true,
      MAX_HOLD_TIME: 3600000,
      PROFIT_EXTENSION_THRESHOLD: 20,
      EXTENSION_TIME: 1800000
    }
  }
};
