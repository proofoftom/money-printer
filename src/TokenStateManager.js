// Token state management
const STATES = {
  NEW: 'new',
  PUMPING: 'pumping',
  DRAWDOWN: 'drawdown',
  OPEN: 'open',
  CLOSED: 'closed',
  DEAD: 'dead'
};

// Safety check reasons
const UNSAFE_REASONS = {
  LIQUIDITY: 'insufficient_liquidity',
  HOLDER_CONCENTRATION: 'high_holder_concentration',
  TRADING_PATTERN: 'suspicious_trading_pattern',
  VOLUME: 'low_volume',
  AGE: 'insufficient_age'
};

// Price tracking structure
class PricePoint {
  constructor(bodyPrice, wickPrice, timestamp) {
    this.bodyPrice = bodyPrice;
    this.wickPrice = wickPrice;
    this.timestamp = timestamp;
  }
}

class TokenStateManager {
  constructor(config) {
    this.state = STATES.NEW;
    this.unsafeReasons = new Set();
    this.priceHistory = {
      peak: null,      // Highest price during pump
      bottom: null,    // Lowest price during drawdown
    };
    this.config = config;
  }

  // Pump Detection (all conditions must be met)
  isPumpDetected(metrics) {
    const {
      priceIncrease,
      volumeSpike,
      buyPressure,
      isFirstPump,
      isHeatingUp
    } = metrics;

    console.log(`Pump check - Price Increase: ${priceIncrease.toFixed(2)}%, Volume Spike: ${volumeSpike}, Buy Pressure: ${buyPressure}, First Pump: ${isFirstPump}, Heating Up: ${isHeatingUp}`);

    return priceIncrease >= this.config.THRESHOLDS.PUMP &&
           volumeSpike &&
           buyPressure &&
           (isFirstPump || isHeatingUp);
  }

  // State Transition Checks
  isDrawdownTriggered(currentPrice, peak) {
    const drawdown = (peak.bodyPrice - currentPrice.bodyPrice) / peak.bodyPrice * 100;
    return drawdown >= this.config.THRESHOLDS.DRAWDOWN;
  }

  // State Transitions
  transitionToPumping(pricePoint) {
    console.log(`Transitioning to pumping - Price: ${pricePoint.bodyPrice}`);
    this.state = STATES.PUMPING;
    this.priceHistory.peak = pricePoint;
    this.priceHistory.bottom = null;
  }

  transitionToDrawdown(pricePoint) {
    console.log(`Transitioning to drawdown - Price: ${pricePoint.bodyPrice}`);
    this.state = STATES.DRAWDOWN;
    this.priceHistory.bottom = pricePoint;
  }

  updatePriceHistory(pricePoint) {
    if (this.state === STATES.PUMPING) {
      // Update peak if we have a new high
      if (!this.priceHistory.peak || pricePoint.bodyPrice > this.priceHistory.peak.bodyPrice) {
        this.priceHistory.peak = pricePoint;
      }
    } else if (this.state === STATES.DRAWDOWN) {
      // Update bottom if we have a new low
      if (!this.priceHistory.bottom || pricePoint.bodyPrice < this.priceHistory.bottom.bodyPrice) {
        this.priceHistory.bottom = pricePoint;
      }
    }
  }

  // Safety Management
  addUnsafeReason(reason, value) {
    if (UNSAFE_REASONS[reason]) {
      this.unsafeReasons.add({ reason, value });
    }
  }

  removeUnsafeReason(reason) {
    for (const item of this.unsafeReasons) {
      if (item.reason === reason) {
        this.unsafeReasons.delete(item);
        break;
      }
    }
  }

  resetUnsafeReasons() {
    this.unsafeReasons.clear();
  }

  isUnsafe() {
    return this.unsafeReasons.size > 0;
  }

  getUnsafeReasons() {
    return Array.from(this.unsafeReasons);
  }

  // State Management
  setState(newState) {
    const oldState = this.state;
    console.log(`State transition - From: ${oldState} to ${newState}`);
    this.state = newState;

    if (newState === STATES.DRAWDOWN) {
      this.priceHistory.bottom = null; // Reset bottom until confirmed
    }

    return {
      from: oldState,
      to: newState
    };
  }
}

module.exports = {
  STATES,
  UNSAFE_REASONS,
  PricePoint,
  TokenStateManager
};
