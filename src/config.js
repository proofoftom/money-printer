module.exports = {
  // Wallet configuration
  WALLET: {
    INITIAL_BALANCE: 3.0, // Initial wallet balance in SOL
  },

  // Market thresholds
  THRESHOLDS: {
    // Market Cap Thresholds (in USD)
    MAX_ENTRY_CAP_USD: 30000, // Maximum market cap in USD for entry ($30k)
    DEAD_USD: 7000, // Consider token dead if it drops below $10k after pumping
    HEATING_UP_USD: 9000, // Market cap threshold to consider token heating up ($15k)
    FIRST_PUMP_USD: 12000, // Market cap threshold for first pump ($25k)
    PUMP_DRAWDOWN: 20, // Percentage drawdown to enter recovery mode
    RECOVERY: 10, // Percentage recovery needed to enter position
    SAFE_RECOVERY_GAIN: 15, // Maximum gain % from drawdown low to enter position after becoming safe

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
    MAX_AVG_TRADE_SIZE_USD: 500, // Maximum average trade size in USD
    MIN_BUY_SELL_RATIO: 0.6, // Minimum ratio of buys to total trades
    MAX_SINGLE_WALLET_VOLUME: 25, // Maximum percentage of volume from a single wallet

    // Volume Pattern Thresholds
    MIN_VOLUME_PRICE_CORRELATION: 0.5, // Minimum correlation between volume and price
    MAX_WASH_TRADE_PERCENTAGE: 20, // Maximum percentage of suspected wash trades

    // Pump token sniper thresholds
    PUMP: 30, // Consider it a pump at 30% gain
    RECOVERY: 15, // Lower recovery threshold for quick reentry
    SAFE_RECOVERY_GAIN: 25, // Maximum gain to consider a recovery safe
    DEAD: -25, // Consider it dead at 25% loss
  },

  // Safety configuration
  SAFETY: {
    // Volume and liquidity thresholds - More lenient for quick entry
    MIN_LIQUIDITY_SOL: 2, // Reduced minimum liquidity requirement
    MIN_VOLUME_SOL: 0.5, // Lower volume requirement for early entry
    MAX_WALLET_VOLUME_PERCENTAGE: 35, // Allow higher concentration initially
    MIN_VOLUME_PRICE_CORRELATION: 0.3, // Lower correlation requirement for early-stage tokens
    MAX_WASH_TRADE_PERCENTAGE: 40, // More tolerant of wash trading in pump tokens

    // Price reference
    SOL_PRICE_USD: 100, // Reference price for calculations

    // Time-based parameters - Extremely short for quick entry
    MIN_TOKEN_AGE_SECONDS: 30, // Just enough to verify it's not an instant rug
    MAX_HOLD_TIME_SECONDS: 300, // 5 minutes max hold for pump tokens

    // Price action thresholds - Adjusted for pump dynamics
    MAX_PRICE_CHANGE_PERCENT: 200, // Allow for bigger pumps
    MIN_PRICE_CHANGE_PERCENT: -40, // Catch dips but avoid rugs
    MAX_PRICE_VOLATILITY: 150, // High volatility is expected in pumps

    // Holder distribution thresholds - More lenient
    MIN_HOLDERS: 50, // Lower holder requirement for early entry
    MAX_TOP_HOLDER_CONCENTRATION: 40, // Allow higher concentration in early stages

    // Creator thresholds
    MAX_CREATOR_HOLDINGS_PERCENT: 15, // Allow higher creator holdings initially

    // Recovery thresholds
    RECOVERY_THRESHOLD_PERCENT: 10, // Lower recovery threshold for quick entries
    MAX_DRAWDOWN_PERCENT: 30, // Maximum drawdown before considering it a failed pump
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
    STOP_LOSS_PERCENTAGE: 15, // Tight stop loss for pump tokens
    TRAILING_STOP_ACTIVATION: 5, // Reduced from 10 to lock in profits earlier
    TRAILING_STOP_DISTANCE: 3, // Reduced from 5 to lock in more profits

    // Take profit tiers
    TAKE_PROFIT_TIERS: [
      { percentage: 20, size: 0.3 }, // Take 30% profit at 20% gain
      { percentage: 50, size: 0.4 }, // Take 40% profit at 50% gain
      { percentage: 100, size: 0.3 }, // Take remaining at 100% gain
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
