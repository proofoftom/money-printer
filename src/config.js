module.exports = {
  // Wallet configuration
  WALLET: {
    INITIAL_BALANCE: 3.0, // Initial wallet balance in SOL
  },

  // Market thresholds
  THRESHOLDS: {
    // Market Cap Thresholds (in USD)
    MAX_ENTRY_CAP_USD: 50000, // Maximum market cap for entering positions ($50k)
    DEAD_USD: 7000, // Market cap threshold for considering token dead ($6k)

    // State Transition Thresholds (in percent)
    DRAWDOWN: 20, // Price drop to enter drawdown state
    PUMP: 15, // Minimum gain % to consider a pump
    PUMPED: 55, // Gain % required to enter pumped state
    POSITION_ENTRY_WINDOW: 25, // Maximum pump percentage to allow position entry
    MAX_VOLUME_DROP: 50, // Maximum allowed volume drop during pump
    MIN_FIRST_PUMP_GAIN: 15, // Minimum gain required for first pump entry
    DEAD: 80, // Drawdown % to consider token dead
    SPREAD: 20, // Spread % to emit wick event

    // Time and Age Thresholds (in seconds)
    MIN_TIME_SINCE_CREATION: 20, // Minimum token age
    MIN_HOLDER_WALLET_AGE: 5, // Minimum holder wallet age

    // Holder Distribution Thresholds
    MIN_HOLDERS: 20, // Minimum number of holders
    MAX_TOP_HOLDER_CONCENTRATION: 35, // Maximum concentration for top holders

    // Price Action Thresholds
    MAX_INITIAL_PRICE_MULT: 4, // Maximum initial price multiplier
    MAX_PRICE_VOLATILITY: 75, // Maximum price volatility

    // Trading Pattern Thresholds
    MAX_AVG_TRADE_SIZE_USD: 750, // Maximum average trade size
    MIN_BUY_SELL_RATIO: 0.5, // Minimum buy/sell ratio
    MAX_SINGLE_WALLET_VOLUME: 30, // Maximum volume from single wallet

    // Volume Pattern Thresholds
    MIN_VOLUME_PRICE_CORRELATION: 0.4, // Minimum volume/price correlation
    MAX_WASH_TRADE_PERCENTAGE: 25, // Maximum wash trading percentage
  },

  PRICE_CALC: {
    WINDOW: 30000,      // 30 second window for price calculations
    RECENT_WEIGHT: 2,   // Weight multiplier for trades in last 5 seconds
    RECENT_WINDOW: 5000 // 5 second window for recent trade weighting
  },

  // Safety configuration
  SAFETY: {
    MIN_TOKEN_AGE_SECONDS: 15,
    MIN_LIQUIDITY_SOL: 0.1,
    MAX_PRICE_VOLATILITY: 1.5,
    MAX_TOP_HOLDER_CONCENTRATION: 40,
    MAX_CREATOR_HOLDINGS: 30,
    MIN_HOLDERS: 5,
    MAX_SUPPLY_CONCENTRATION: 50,

    // Pump pattern detection thresholds
    PUMP_DETECTION: {
      MIN_PRICE_ACCELERATION: 0.25, // Lowered from 0.3 to catch slower pumps
      MIN_VOLUME_SPIKE: 120, // Lowered from 150% to catch more gradual volume increases
      MIN_PRICE_VOLUME_CORRELATION: 0.15, // Lowered from 0.2 to allow for slight market inefficiencies
      MIN_GAIN_RATE: 0.8, // Lowered from 1.0% per second for smoother pumps
      MIN_MC_GAIN_RATE: 0.4, // Lowered from 0.5 for large tokens
      LARGE_TOKEN_MC_USD: 25000, // Increased from 20k to include more mid-sized tokens
      MIN_PUMP_COUNT: 1, // Keep at 1 to catch first pump
      PUMP_WINDOW_MS: 360000, // Increased from 300k (5 min) to 360k (6 min) for better pattern detection
    },
  },

  // Position sizing
  POSITION: {
    MAX_POSITION_SIZE_SOL: 2.5, // Increased maximum position
    MIN_POSITION_SIZE_SOL: 0.1,
    POSITION_SIZE_MARKET_CAP_RATIO: 0.015, // Increased for larger positions
    MAX_PRICE_IMPACT_BPS: 120, // Allow higher price impact
    FIRST_PUMP_SIZE_RATIO: 0.25, // Position size ratio for first pump entries (relative to normal size)

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
