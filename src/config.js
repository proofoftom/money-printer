module.exports = {
  // Wallet configuration
  WALLET: {
    INITIAL_BALANCE: 3.0, // Initial wallet balance in SOL
  },

  // Market thresholds
  THRESHOLDS: {
    // Market Cap Thresholds (in USD)
    MAX_ENTRY_CAP_USD: 50000,    // Maximum market cap for entering positions ($50k)
    DEAD_USD: 7000,              // Market cap threshold for considering token dead ($7k)
    SPREAD: 20,                  // Spread % to emit wick event

    // Volume Pattern Thresholds
    VOLUME_SPIKE: 2.5,           // Minimum ratio for volume spike detection
    MIN_VOLUME_PRICE_CORRELATION: 0.4
  },

  // Safety checks for new tokens (< 5 minutes old)
  SAFETY: {
    // Basic requirements
    MIN_TOKEN_AGE_SECONDS: 30,   // Minimum age before considering entry
    MIN_HOLDERS: 15,             // Minimum number of holders
    MAX_TOP_HOLDER_CONCENTRATION: 40, // Maximum % held by top holders

    // Early trading patterns
    MIN_BUY_SELL_RATIO: 2.0,    // Minimum ratio of buy volume to sell volume
    MAX_RAPID_TRADERS: 3,        // Maximum number of wallets with rapid trading
    MAX_CREATOR_SELLS_EARLY: 1,  // Maximum number of creator sells in first 5 minutes
    MIN_UNIQUE_BUYERS: 5,        // Minimum number of unique buying wallets
    MAX_CREATOR_SELL_PERCENTAGE_EARLY: 10, // Maximum % of creator's tokens sold
    MAX_ALTERNATING_PATTERNS: 2, // Maximum number of wallets with alternating patterns
    
    // Volume metrics
    MIN_VOLUME_ACCELERATION: 0.5, // Minimum rate of volume growth
    MAX_SINGLE_WALLET_VOLUME: 25, // Maximum % of volume from single wallet
    MIN_VOLUME_USD: 1000,        // Minimum USD volume in first 5 minutes

    // Pump detection
    PUMP_DETECTION: {
      MIN_GAIN_RATE: 3.0,       // Minimum %/minute for pump detection
      MIN_VOLUME_SPIKE: 2.5,    // Minimum volume increase for pump
      MIN_BUY_PRESSURE: 1.5     // Minimum buy/sell pressure ratio
    }
  },

  // Exit strategies for new tokens
  EXIT: {
    NEW_TOKEN: {
      MAX_CREATOR_SELLS: 1,      // Exit after this many creator sells
      MIN_BUY_SELL_RATIO: 1.5,   // Exit if buy/sell ratio drops below this
      MAX_SUSPICIOUS_PATTERNS: 2, // Exit after this many suspicious patterns
      MIN_VOLUME_ACCELERATION: 0.3, // Exit if volume growth drops below this

      // Tiered take-profit strategy
      TAKE_PROFIT_TIERS: [
        { threshold: 300, portion: 0.5 },  // 50% at 300% profit
        { threshold: 500, portion: 0.3 },  // 30% at 500% profit
        { threshold: 1000, portion: 0.2 }  // 20% at 1000% profit
      ],

      // Stop loss settings
      STOP_LOSS: {
        THRESHOLD: -15,          // Faster stop loss for new tokens
        TRAILING: true,
        ACTIVATION_THRESHOLD: 50, // Start trailing after 50% gain
        TRAILING_DISTANCE: 15    // 15% trailing distance
      }
    },

    // Standard exit strategies
    STOP_LOSS: {
      ENABLED: true,
      THRESHOLD: -7.5,
      TRAILING: true,
      ACTIVATION_THRESHOLD: 25,
      TRAILING_DISTANCE: 10
    },

    TAKE_PROFIT: {
      ENABLED: true,
      TIERS: [
        { threshold: 100, portion: 0.3 },
        { threshold: 200, portion: 0.4 },
        { threshold: 300, portion: 0.3 }
      ]
    },

    TIME_BASED: {
      ENABLED: true,
      MAX_HOLD_TIME: 1800,      // 30 minutes
      EXTENSION_THRESHOLD: 50,   // Extend time if up 50%
      EXTENDED_HOLD_TIME: 3600   // 1 hour if extended
    }
  },

  PRICE_CALC: {
    WINDOW: 30000,              // 30 second window for price calculations
    RECENT_WEIGHT: 2,           // Weight multiplier for trades in last 5 seconds
    RECENT_WINDOW: 5000         // 5 second window for recent trade weighting
  }
};
