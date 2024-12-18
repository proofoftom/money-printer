// Token state management
const STATES = {
  NEW: 'new',
  PUMPING: 'pumping',
  DRAWDOWN: 'drawdown',
  RECOVERY: 'recovery',
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
  constructor() {
    this.state = STATES.NEW;
    this.unsafeReasons = new Set();
    this.priceHistory = {
      peak: null,      // PricePoint during pumping
      bottom: null,    // PricePoint during drawdown
      recovery: null   // PricePoint during recovery
    };
    this.confirmationCandle = null;
  }

  // Pump Detection (all conditions must be met)
  isPumpDetected(metrics) {
    const {
      priceIncrease1m,
      priceIncrease5m,
      volumeSpike,
      buyPressure
    } = metrics;

    return (
      priceIncrease1m >= 10 &&  // 10% price increase in 1min
      priceIncrease5m >= 25 &&  // 25% price increase in 5min
      volumeSpike >= 200 &&     // 200% volume spike
      buyPressure >= 65         // 65% buy pressure
    );
  }

  // State Transition Checks
  isDrawdownTriggered(currentPrice, peak) {
    // Use body prices for calculations
    return (peak.bodyPrice - currentPrice.bodyPrice) / peak.bodyPrice >= 0.25; // 25% drop
  }

  isRecoveryTriggered(currentPrice, bottom) {
    // Use body prices for calculations
    return (currentPrice.bodyPrice - bottom.bodyPrice) / bottom.bodyPrice >= 0.10; // 10% up
  }

  shouldEnterPosition(currentPrice) {
    if (this.state !== STATES.RECOVERY || this.unsafeReasons.size > 0) {
      return false;
    }

    const gain = (currentPrice.bodyPrice - this.priceHistory.bottom.bodyPrice) / 
                this.priceHistory.bottom.bodyPrice * 100;
    
    return gain <= 15; // Enter if gain <= 15%
  }

  // State Transitions
  transitionToPumping(pricePoint) {
    this.state = STATES.PUMPING;
    this.priceHistory.peak = pricePoint;
  }

  transitionToDrawdown(pricePoint) {
    this.state = STATES.DRAWDOWN;
    this.confirmationCandle = pricePoint;
  }

  confirmDrawdown(pricePoint) {
    if (this.isDrawdownTriggered(pricePoint, this.confirmationCandle)) {
      // Update bottom if it's null or if new price is lower
      if (!this.priceHistory.bottom || pricePoint.bodyPrice < this.priceHistory.bottom.bodyPrice) {
        this.priceHistory.bottom = pricePoint;
      }
      return true;
    }
    return false;
  }

  transitionToRecovery(pricePoint) {
    this.state = STATES.RECOVERY;
    this.priceHistory.recovery = pricePoint;
    // Reset unsafe reasons when entering a new recovery cycle
    this.resetUnsafeReasons();
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
    this.state = newState;

    if (newState === STATES.DRAWDOWN) {
      this.priceHistory.bottom = null; // Reset bottom until confirmed
    } else if (newState === STATES.RECOVERY) {
      this.resetUnsafeReasons(); // Reset unsafe reasons on new recovery cycle
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
