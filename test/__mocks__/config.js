const mockConfig = {
  SIMULATION_MODE: true,
  TRANSACTION: {
    SIMULATION_MODE: {
      ENABLED: true,
      AVG_BLOCK_TIME: 0.4,
      PRICE_IMPACT: {
        ENABLED: true,
        SLIPPAGE_BASE: 1,
        VOLUME_MULTIPLIER: 0.5
      }
    }
  },
  POSITION_MANAGER: {
    CLEAR_ON_STARTUP: false,
    BASE_POSITION_SIZE: 1.0,
    MIN_ENTRY_CONFIDENCE: 40,
    CONFIDENCE_MULTIPLIERS: {
      HIGH: 1.5,
      MEDIUM_HIGH: 1.25,
      MEDIUM: 1.0,
      MEDIUM_LOW: 0.75,
      LOW: 0.5
    },
    STATE_MULTIPLIERS: {
      ACCUMULATION: 1.0,
      LAUNCHING: 1.25,
      PUMPING: 1.5
    },
    PARTIAL_EXIT: {
      CREATOR_SELL: 0.25,
      SUSPICIOUS_TRADING: 0.5,
      BUY_PRESSURE_DROP: 0.25
    },
    STOP_LOSS: {
      PRICE_DROP: 0.3,
      TIME_WINDOW: 300
    }
  },
  SAFETY: {
    MIN_UNIQUE_BUYERS: 5,
    MIN_BUY_SELL_RATIO: 1.5,
    MIN_VOLUME_ACCELERATION: 2.0,
    MIN_BUY_PRESSURE: 0.6,
    PUMP_DETECTION: {
      MIN_GAIN_RATE: 2.0,
      MIN_PRICE_GAIN: 20,
      MIN_VOLUME_SPIKE: 3.0
    }
  }
};

module.exports = mockConfig;
