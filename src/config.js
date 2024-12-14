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
    HEATING_UP: 12000, // Market cap in SOL to consider token heating up
    FIRST_PUMP: 16000, // Market cap in SOL to consider first pump
    DEAD: 7000, // Market cap in SOL to consider token dead
    PUMP_DRAWDOWN: 30, // Percentage drawdown to enter drawdown phase
    RECOVERY: 10, // Percentage recovery from drawdown low to consider recovery
  },

  // Exit Strategies Configuration
  EXIT_STRATEGIES: {
    trailingStopLoss: {
      enabled: true,
      percentage: 15, // Tighter stop loss due to rapid price movements
      dynamicAdjustment: {
        enabled: true,
        volatilityMultiplier: 2.0, // More aggressive volatility adjustment
        minPercentage: 10, // Tighter minimum
        maxPercentage: 30, // Still protect against major drops
      },
    },
    trailingTakeProfit: {
      enabled: true,
      initialTrigger: 10, // Lower initial trigger for quicker profits
      trailPercentage: 5, // Tighter trailing to lock in profits
      dynamicAdjustment: {
        enabled: true,
        volatilityMultiplier: 1.5, // More responsive to volatility
        minPercentage: 3, // Very tight in low volatility
        maxPercentage: 10, // Wider in high volatility
      },
    },
    tieredTakeProfit: {
      enabled: true,
      tiers: [
        { percentage: 15, portion: 0.5 }, // Take half position earlier
        { percentage: 30, portion: 0.3 }, // Another 30% at higher profit
        { percentage: 50, portion: 0.2 }, // Let the rest run for bigger moves
      ],
    },
    timeBasedExit: {
      enabled: true,
      maxDuration: 900000, // 15 minutes max hold time
      profitBasedExtension: {
        enabled: true,
        threshold: 30, // Extend time if profit > 30%
        extensionMultiplier: 2, // Double the max duration
      },
      timedTakeProfit: {
        enabled: true,
        intervals: [
          { time: 300000, percentage: 10 }, // 5 min: exit if profit > 10%
          { time: 600000, percentage: 7 }, // 10 min: exit if profit > 7%
          { time: 900000, percentage: 5 }, // 15 min: exit if profit > 5%
        ],
      },
    },
    volumeBasedExit: {
      enabled: true,
      volumeDrop: {
        enabled: true,
        window: 5 * 60 * 1000, // 5 minutes in milliseconds
        threshold: 50, // Exit if volume drops 50% from peak
      },
      volumeSpike: {
        enabled: true,
        profitThreshold: 0.5, // Only check volume spike if in 0.5% profit
        lookbackPeriods: 12,
        threshold: 200, // Exit if volume spikes 200% above average
        consecutiveDecline: {
          enabled: true,
          periods: 3,
          minDeclinePercent: 15,
        },
      },
      lowVolumeExit: {
        enabled: true,
        duration: 15 * 60 * 1000, // 15 minutes in milliseconds
        threshold: 30, // Exit if volume is 30% or less of peak volume
      },
    },
    priceAction: {
      enabled: true,
      wickRejection: {
        enabled: true,
        minCandleSize: 0.1, // Minimum candle size of 0.1%
        threshold: 60, // Exit if wick is 60% or more of total range
      },
      momentumLoss: {
        enabled: true,
        consecutiveSmaller: 3, // Exit after 3 consecutive smaller candles
        minSize: 0.05, // Only consider candles larger than 0.05%
      },
    },
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
