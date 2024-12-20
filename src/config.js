module.exports = {
  // Core settings
  MIN_TOKEN_AGE_SECONDS: 30, // 30 seconds minimum age
  MAX_ENTRY_MCAP_USD: 100000, // $100k maximum market cap
  MIN_MCAP_POSITION: 0.001, // 0.1% minimum position size
  MAX_MCAP_POSITION: 0.01, // 1% maximum position size
  RISK_PER_TRADE: 0.1, // 10% of wallet per trade

  // Exit strategy settings
  STOP_LOSS_PERCENT: 10, // 10% stop loss
  TAKE_PROFIT_PERCENT: 50, // 50% take profit
  TRAILING_STOP_PERCENT: 20, // 20% trailing stop

  // WebSocket settings
  WS_ENDPOINT: "wss://pumpportal.fun/api/data", // Update WebSocket endpoint to match documentation
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

  // Safety check configuration
  SAFETY_CHECK_INTERVAL: 2000, // Check token safety every 2 seconds
  MAX_TIME_WITHOUT_TRADES: 300000, // 5 minutes
  MAX_PRICE_DROP_PERCENT: 0.5, // 50% drop from initial price
  MAX_HOLDER_CONCENTRATION: 30, // Maximum percentage of supply held by top 10 holders

  // Transaction fees in SOL
  TRANSACTION_FEES: {
    BUY: 0.02, // Higher fee for buying due to token account creation
    SELL: 0.01, // Standard transaction fee for selling
  },

  // Dashboard configuration
  DASHBOARD: {
    CHART: {
      CANDLE_INTERVAL: 5000, // 5-second candles
      MAX_CANDLES: 100, // Number of candles to display
      VOLUME_HEIGHT: 0.2, // 20% of chart height for volume
      PRICE_DECIMALS: 9, // Number of decimals for price display
      VOLUME_DECIMALS: 2, // Number of decimals for volume display
    },
    COLORS: {
      PRICE_UP: "#00ff00",
      PRICE_DOWN: "#ff0000",
      WARNING: "#ffff00",
      ALERT: "#ff0000",
      INFO: "#ffffff",
      CHART_BG: "#1a1a1a",
      GRID: "#2a2a2a",
    },
    REFRESH_RATE: 1000, // UI refresh rate in ms
    LOG_BUFFER: 1000, // Number of log lines to keep
    PANELS: {
      CHART_HEIGHT: 0.4, // 40% of screen height
      CHART_WIDTH: 0.5, // 50% of screen width
      RIGHT_PANEL_WIDTH: 0.5, // 50% of screen width
      BOTTOM_HEIGHT: 0.3, // 30% of screen height
    },
  },

  // Keyboard shortcuts
  SHORTCUTS: {
    OPEN_POSITION: "o",
    CLOSE_POSITION: "c",
    TOKEN_DETAILS: "t",
    WALLET_DETAILS: "w",
    HELP: "?",
    QUIT: "q",
    FOCUS_CHART: "1",
    FOCUS_POSITIONS: "2",
    FOCUS_LOGS: "3",
    CLEAR_LOGS: "l",
  },

  // Alert configuration
  ALERTS: {
    PRICE_CHANGE: {
      enabled: true,
      threshold: 5, // 5% change
      interval: 5000, // Check every 5 seconds
      sound: true,
    },
    WALLET_BALANCE: {
      enabled: true,
      threshold: 10, // Alert when balance drops by 10%
      sound: true,
    },
    SAFETY_CONDITIONS: {
      enabled: true,
      sound: true,
      flash: true, // Flash the UI on critical alerts
    },
    SOUNDS: {
      TRADE_ENTRY: true,
      TRADE_EXIT: true,
      WARNING: true,
      ERROR: true,
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
