module.exports = {
  // Core settings
  MIN_TOKEN_AGE_SECONDS: 5, // 5 minutes minimum age
  MAX_ENTRY_MCAP_USD: 100000, // $100k maximum market cap
  MIN_MCAP_POSITION: 0.001, // 0.1% minimum position size
  MAX_MCAP_POSITION: 0.01, // 1% maximum position size
  RISK_PER_TRADE: 0.1, // 10% of wallet per trade

  // Exit strategy settings
  STOP_LOSS_PERCENT: 10, // 10% stop loss
  TAKE_PROFIT_PERCENT: 50, // 50% take profit
  TRAILING_STOP_PERCENT: 20, // 20% trailing stop

  // WebSocket settings
  WS_URL: "wss://pumpportal.fun/api/data",
  RECONNECT_INTERVAL: 5000, // 5 seconds between reconnect attempts

  // Logging settings
  LOGGING: {
    NEW_TOKENS: false, // Log new token discoveries
    TRADES: true, // Log token trades
    POSITIONS: true, // Log position changes
    SAFETY_CHECKS: false, // Log safety check results
  },

  // Price settings
  SOL_USD_PRICE: 225, // Fallback SOL/USD price if API fails

  // Token filtering configuration
  MAX_TOKEN_AGE: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
  MIN_LIQUIDITY_SOL: 1, // Minimum SOL in liquidity pool
  MIN_TOKEN_AGE: 60 * 1000, // 1 minute in milliseconds
  MIN_HOLDER_COUNT: 10,
  MIN_TRANSACTIONS: 5,

  // Notification settings
  NOTIFICATIONS: {
    POSITIONS: {
      ENTRY: {
        enabled: true,
        sound: true,
        minSize: 0.1, // Only notify for positions larger than 0.1 SOL
      },
      EXIT: {
        enabled: true,
        sound: true,
        minProfitPercent: 10, // Only notify for profits > 10%
        minLossPercent: 5, // Only notify for losses > 5%
      },
    },
    SYSTEM: {
      CONNECTION: {
        enabled: true,
        sound: false,
        retryThreshold: 3, // Notify after 3 failed reconnect attempts
      },
      SAFETY: {
        enabled: true,
        sound: true,
        minSeverity: "medium", // low, medium, high
      },
    },
    PERFORMANCE: {
      MILESTONES: {
        enabled: true,
        sound: true,
        profitThresholds: [1, 5, 10], // Notify at 1, 5, 10 SOL profit
        lossThresholds: [1, 3, 5], // Notify at 1, 3, 5 SOL loss
      },
      DAILY_SUMMARY: {
        enabled: true,
        sound: false,
        minTrades: 5, // Only send if > 5 trades
      },
    },
  },

  // Keyboard shortcuts
  KEYBOARD_SHORTCUTS: {
    TRADING: {
      PAUSE_RESUME: {
        key: "space",
        description: "Pause/Resume trading",
        requiresConfirmation: false,
      },
      EMERGENCY_STOP: {
        key: "escape",
        description: "Emergency stop - close all positions",
        requiresConfirmation: true,
      },
    },
    DISPLAY: {
      CLEAR_SCREEN: {
        key: "l",
        ctrl: true,
        description: "Clear screen",
      },
      TOGGLE_AUTOSCROLL: {
        key: "s",
        ctrl: true,
        description: "Toggle auto-scroll",
      },
      TOGGLE_CHARTS: {
        key: "c",
        ctrl: true,
        description: "Show/hide charts",
      },
    },
    VIEWS: {
      TRADE_HISTORY: {
        key: "1",
        description: "Show trade history",
      },
      ACTIVE_POSITIONS: {
        key: "2",
        description: "Show active positions",
      },
      PERFORMANCE: {
        key: "3",
        description: "Show performance stats",
      },
      TOKEN_LIST: {
        key: "4",
        description: "Show token list",
      },
    },
    QUICK_ACTIONS: {
      INCREASE_RISK: {
        key: "+",
        description: "Increase risk per trade by 1%",
        requiresConfirmation: true,
      },
      DECREASE_RISK: {
        key: "-",
        description: "Decrease risk per trade by 1%",
        requiresConfirmation: true,
      },
    },
  },

  // Logging configuration
  LOGGING_ENABLED: true,
  LOG_LEVEL: "debug", // Set to debug level for more verbose logging
  LOGGING_SETTINGS: {
    DIRECTORY: "./logs",
    MAX_SIZE: "20m",
    MAX_FILES: "14d",
    FORMAT: "json",
  },

  // Data Export settings
  DATA_EXPORT: {
    DIRECTORY: "./exports",
    AUTO_EXPORT: {
      enabled: true,
      interval: 3600000, // Auto export every hour
      types: ["trades", "performance", "tokens"],
    },
    FORMATS: {
      CSV: {
        enabled: true,
        delimiter: ",",
        includeHeaders: true,
      },
      JSON: {
        enabled: true,
        pretty: true,
      },
    },
    TRADES: {
      enabled: true,
      fields: [
        "timestamp",
        "token",
        "type",
        "price",
        "size",
        "value",
        "pnl",
        "pnlPercent",
        "holdTime",
        "exitReason",
      ],
      groupBy: {
        enabled: true,
        intervals: ["hourly", "daily", "weekly"],
      },
    },
    PERFORMANCE: {
      enabled: true,
      fields: [
        "timestamp",
        "totalTrades",
        "winRate",
        "avgPnl",
        "maxDrawdown",
        "sharpeRatio",
        "profitFactor",
        "balance",
      ],
      metrics: {
        basic: true, // Include basic metrics
        advanced: true, // Include advanced metrics
        custom: true, // Include user-defined metrics
      },
    },
    TOKENS: {
      enabled: true,
      fields: [
        "mint",
        "name",
        "symbol",
        "age",
        "marketCap",
        "volume",
        "trades",
        "holders",
      ],
      filters: {
        minAge: 300, // 5 minutes
        minMarketCap: 1000, // 1000 SOL
        minTrades: 5,
      },
    },
    SYSTEM: {
      enabled: true,
      fields: ["timestamp", "event", "level", "message", "details"],
      levels: ["error", "warn", "info"],
      includeMetrics: true,
    },
  },
};
