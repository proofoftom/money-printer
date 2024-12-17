module.exports = {
  // General Settings
  UPDATE_INTERVAL: 1000,
  CLEANUP_INTERVAL: 300000, // 5 minutes
  MAX_POSITIONS: 3,
  
  // Testing Configuration
  TESTING: {
    CLEAR_DATA_ON_START: process.env.CLEAR_DATA_ON_START === "true" || false,
    DATA_DIR: "data",
    SIMULATION_MODE: {
      ENABLED: true,
      AVG_BLOCK_TIME: 0.4,
      PRICE_IMPACT: {
        ENABLED: true,
        SLIPPAGE_BASE: 1,
        VOLUME_MULTIPLIER: 1.2
      },
      NETWORK_DELAY: {
        MIN_MS: 50,
        MAX_MS: 200,
        CONGESTION_MULTIPLIER: 1.5
      }
    }
  },

  // WebSocket Configuration
  WEBSOCKET: {
    URL: "wss://pumpportal.fun/data-api/real-time",
    RECONNECT_TIMEOUT: 5000,  // 5 seconds
    PING_INTERVAL: 30000,     // 30 seconds
    PONG_TIMEOUT: 10000,      // 10 seconds
    MAX_RETRIES: 5
  },

  // Market Cap Thresholds (in USD)
  MCAP: {
    MIN: 5000,     // Minimum to consider tracking
    PUMP: 12000,   // Required for pump detection
    MAX_ENTRY: 75000, // Maximum for position entry
    DEAD: 5000     // Consider token dead below this
  },

  // Pump Detection
  PUMP: {
    PRICE: {
      CHANGE_1M: 10,  // 10% price increase in 1 minute
      CHANGE_5M: 25,  // 25% price increase in 5 minutes
      MAX_VOLATILITY: 50 // Maximum acceptable price volatility
    },
    VOLUME: {
      SPIKE: 200,     // 200% volume increase
      MIN_SOL: 1,     // Minimum volume in SOL
      MAX_WASH: 20    // Maximum wash trading percentage
    },
    MARKET: {
      MIN_BUYS: 65,   // Minimum buy pressure percentage
      MIN_TRADES: 5,  // Minimum trades in window
      MIN_TRADERS: 3  // Minimum unique traders
    }
  },

  // Recovery Strategy
  RECOVERY: {
    DRAWDOWN: {
      MIN: 25,        // Minimum drawdown to trigger
      MAX: 40,        // Maximum drawdown before considering dead
      WINDOW: 300     // Window to measure drawdown (seconds)
    },
    GAIN: {
      MIN: 10,        // Minimum gain to consider recovery
      MAX_ENTRY: 15,  // Maximum gain for position entry
      STOP_LOSS: -10  // Stop loss percentage
    },
    VOLUME: {
      MIN_RECOVERY: 0.5, // Minimum volume during recovery (SOL)
      MAX_DILUTION: 30  // Maximum supply dilution during recovery
    }
  },

  // Safety Requirements
  SAFETY: {
    TOKEN: {
      MIN_AGE: 300,        // Minimum token age (seconds)
      MIN_HOLDERS: 15,     // Minimum unique holders
      MAX_CREATOR: 40,     // Maximum creator holdings percentage
      MAX_WALLET: 30       // Maximum single wallet concentration
    },
    LIQUIDITY: {
      MIN_SOL: 2,         // Minimum SOL in liquidity
      MAX_IMPACT: 5,      // Maximum price impact percentage
      MIN_DEPTH: 1        // Minimum liquidity depth in SOL
    },
    MARKET: {
      MIN_TRADES: 10,     // Minimum trades before entry
      MIN_TRADERS: 5,     // Minimum unique traders
      MAX_SPREAD: 3,      // Maximum bid-ask spread percentage
      MIN_CORRELATION: 0.6 // Minimum volume-price correlation
    }
  },

  // Position Management
  POSITION: {
    ENTRY: {
      SIZE: 0.5,          // Position size in SOL
      SLIPPAGE: 1,        // Maximum entry slippage percentage
      MAX_RETRIES: 3      // Maximum entry attempts
    },
    EXIT: {
      PROFIT: 25,         // Take profit percentage
      TRAILING_STOP: 15,  // Trailing stop percentage
      MAX_HOLD_TIME: 3600 // Maximum hold time (seconds)
    }
  },

  // Risk Management
  RISK: {
    MAX_DAILY_LOSS: 10,   // Maximum daily loss percentage
    MAX_POSITION_SIZE: 1, // Maximum position size in SOL
    MIN_RISK_REWARD: 2,   // Minimum risk/reward ratio
    MAX_EXPOSURE: 50      // Maximum portfolio exposure percentage
  }
};
