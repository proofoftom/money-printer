module.exports = {
  // WebSocket configuration
  WEBSOCKET: {
    URL: "wss://pumpportal.fun/data-api/real-time",
    RECONNECT_TIMEOUT: 5000, // 5 seconds
  },

  // Position sizing
  POSITION: {
    SIZE_SOL: 0.1, // Default position size in SOL
    MIN_SIZE_SOL: 0.05, // Minimum position size
    MAX_SIZE_SOL: 1.0, // Maximum position size
  },

  // Market thresholds
  THRESHOLDS: {
    HEATING_UP: 9000, // Market cap in SOL to consider token heating up
    FIRST_PUMP: 12000, // Market cap in SOL to consider first pump
    DEAD: 7000, // Market cap in SOL to consider token dead
    PUMP_DRAWDOWN: 30, // Percentage drawdown to enter drawdown phase
    RECOVERY: 10, // Percentage recovery from drawdown low to consider recovery
  },

  // Exit Strategies Configuration
  EXIT_STRATEGIES: {
    trailingStopLoss: {
      enabled: true,
      percentage: 30,
      dynamicAdjustment: {
        enabled: true,
        volatilityMultiplier: 1.5, // Higher volatility = wider stop loss
        minPercentage: 20, // Never tighter than 20%
        maxPercentage: 40  // Never wider than 40%
      }
    },
    trailingTakeProfit: {
      enabled: true,
      initialTrigger: 20,
      trailPercentage: 10,
      dynamicAdjustment: {
        enabled: true,
        volatilityMultiplier: 1.0, // Adjust trail % based on volatility
        minPercentage: 5,  // Minimum trail percentage
        maxPercentage: 15  // Maximum trail percentage
      }
    },
    tieredTakeProfit: {
      enabled: true,
      tiers: [
        { percentage: 30, portion: 0.4 }, // Take 40% profit at 30% gain
        { percentage: 50, portion: 0.4 }, // Take 40% profit at 50% gain
        { percentage: 100, portion: 0.2 }, // Take final 20% at 100% gain
      ],
    },
    timeBasedExit: {
      enabled: true,
      maxDuration: 3600000, // 1 hour in milliseconds
      profitBasedExtension: {
        enabled: true,
        threshold: 50, // Extend time if profit > 50%
        extensionMultiplier: 2 // Double the max duration
      },
      timedTakeProfit: {
        enabled: true,
        intervals: [
          { time: 900000, percentage: 20 },  // 15 min: exit if profit > 20%
          { time: 1800000, percentage: 15 }, // 30 min: exit if profit > 15%
          { time: 3600000, percentage: 10 }  // 60 min: exit if profit > 10%
        ]
      }
    },
    volumeBasedExit: {
      enabled: true,
      volumeDrop: {
        window: 300000, // 5 minutes
        threshold: 50 // Exit if volume drops 50% from peak
      },
      volumeSpike: {
        threshold: 200, // Exit if volume spikes 200% above average
        profitThreshold: 10 // Only if in profit > 10%
      }
    }
  },

  // Safety checks
  SAFETY: {
    MIN_LIQUIDITY_SOL: 5, // Minimum SOL in bonding curve
    MAX_PRICE_IMPACT: 10, // Maximum price impact percentage
    MIN_HOLDERS: 25, // Minimum number of token holders
    MAX_TOP_HOLDER_CONCENTRATION: 30, // Maximum percentage held by top 10 holders
  },

  // Trading hours (UTC)
  TRADING: {
    ENABLED: true,
    START_HOUR: 0, // 24-hour format
    END_HOUR: 24, // 24-hour format
    WEEKEND_TRADING: true,
  },

  // Risk management
  RISK: {
    MAX_CONCURRENT_POSITIONS: 5,
    MAX_DAILY_LOSS_SOL: 1,
    MAX_POSITION_SOL: 0.5,
    DAILY_RESET_HOUR: 0, // UTC hour to reset daily stats
  },
};
