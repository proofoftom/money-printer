// Token state management
const STATES = {
  NEW: 'new',
  PUMPING: 'pumping',
  PUMPED: 'pumped',
  DRAWDOWN: 'drawdown',
  OPEN: 'open',
  CLOSED: 'closed',
  DEAD: 'dead',
  RECOVERY: 'recovery'
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

const config = require('./config');

class TokenStateManager {
  constructor() {
    this.state = STATES.NEW;
    this.unsafeReasons = new Set();
    this.priceHistory = {
      initialPumpPrice: null,  // Price when first entering pump
      peak: null,             // Highest price during pump/pumped
      bottom: null,           // Lowest price during drawdown
      lastPrice: null,
      pumpStartPrice: null,   // Price at start of current pump
      pumpStartTime: null,    // Time when current pump started
      lastPumpPeak: null      // Preserve the peak from the previous pump
    };
    this.metrics = {
      initialVolume5m: 0,     // 5-minute volume when pump started
      failedAttempts: 0,      // Number of failed safety checks
      isFirstPumpEntry: false // Whether position was entered on first pump
    };
    this.unsafe = false;
  }

  updatePriceHistory(currentPrice, volume5m) {
    // Set initial price if not set
    if (!this.priceHistory.lastPrice) {
      this.priceHistory.lastPrice = currentPrice;
      this.priceHistory.initialPumpPrice = currentPrice;
      return;
    }

    // Track peak price in pumping/pumped states
    if ((this.state === STATES.PUMPING || this.state === STATES.PUMPED) && 
        (!this.priceHistory.peak || currentPrice.bodyPrice > this.priceHistory.peak.bodyPrice)) {
      this.priceHistory.peak = currentPrice;
    }

    // Track bottom price in drawdown
    if (this.state === STATES.DRAWDOWN && 
        (!this.priceHistory.bottom || currentPrice.bodyPrice < this.priceHistory.bottom.bodyPrice)) {
      this.priceHistory.bottom = currentPrice;
    }

    // Check for pumped state transition
    if (this.state === STATES.PUMPING) {
      const gainFromInitial = this.getGainFromInitial(currentPrice);
      if (gainFromInitial >= config.THRESHOLDS.PUMPED) {
        return this.setState(STATES.PUMPED);
      }
    }

    this.priceHistory.lastPrice = currentPrice;
  }

  isPumpDetected(metrics, fromDrawdown = false) {
    // Store pump start data if this is a new pump
    if (!this.priceHistory.pumpStartPrice) {
      this.priceHistory.pumpStartPrice = this.priceHistory.lastPrice;
      this.priceHistory.pumpStartTime = Date.now();
    }

    // Calculate gain from reference point
    const referencePrice = fromDrawdown ? 
      (this.priceHistory.bottom || this.priceHistory.initialPumpPrice).bodyPrice : 
      this.priceHistory.initialPumpPrice.bodyPrice;
    
    const currentPrice = this.priceHistory.lastPrice.bodyPrice;
    const priceGain = ((currentPrice - referencePrice) / referencePrice) * 100;

    return priceGain >= config.THRESHOLDS.PUMP;
  }

  isDrawdownTriggered(currentPrice) {
    // Only allow drawdown if token has reached pumped state and we have valid price data
    if (this.state !== STATES.PUMPED || !this.priceHistory.peak || !currentPrice) {
      return false;
    }

    const peakPrice = this.priceHistory.peak.bodyPrice;
    const drawdown = ((peakPrice - currentPrice.bodyPrice) / peakPrice) * 100;
    return drawdown >= config.THRESHOLDS.DRAWDOWN;
  }

  checkPumpSafety(volume5m) {
    // Check volume hasn't dropped significantly
    const volumeDrop = ((this.metrics.initialVolume5m - volume5m) / this.metrics.initialVolume5m) * 100;
    if (volumeDrop > config.THRESHOLDS.MAX_VOLUME_DROP) {
      return false;
    }
    return true;
  }

  canEnterPosition(isFirstPump = false) {
    if (!this.priceHistory.pumpStartTime || !this.priceHistory.pumpStartPrice) return false;
    
    const currentPrice = this.priceHistory.lastPrice.bodyPrice;
    const pumpStartPrice = this.priceHistory.pumpStartPrice.bodyPrice;
    const pumpGain = ((currentPrice - pumpStartPrice) / pumpStartPrice) * 100;
    
    // Check if within entry window
    if (pumpGain > config.THRESHOLDS.POSITION_ENTRY_WINDOW) return false;

    // For first pump entries, require minimum gain
    if (isFirstPump && pumpGain < config.THRESHOLDS.MIN_FIRST_PUMP_GAIN) return false;

    return true;
  }

  markPositionEntered(isFirstPump = false) {
    this.metrics.isFirstPumpEntry = isFirstPump;
  }

  getPositionSizeRatio() {
    return this.metrics.isFirstPumpEntry ? 
      config.POSITION_SIZING.FIRST_PUMP_SIZE_RATIO : 1;
  }

  getGainFromInitial(currentPrice) {
    if (!this.priceHistory.initialPumpPrice || !currentPrice) return 0;
    return ((currentPrice.bodyPrice - this.priceHistory.initialPumpPrice.bodyPrice) / 
            this.priceHistory.initialPumpPrice.bodyPrice) * 100;
  }

  getDrawdownFromPeak() {
    if (!this.priceHistory.lastPrice) return 0;
    
    // Use the last pump's peak if in drawdown, otherwise use current peak
    const peakPrice = this.state === STATES.DRAWDOWN && this.priceHistory.lastPumpPeak ? 
      this.priceHistory.lastPumpPeak.bodyPrice : 
      (this.priceHistory.peak ? this.priceHistory.peak.bodyPrice : this.priceHistory.lastPrice.bodyPrice);

    return ((peakPrice - this.priceHistory.lastPrice.bodyPrice) / peakPrice) * 100;
  }

  setState(newState) {
    const oldState = this.state;
    this.state = newState;

    // Reset pump data on new pump
    if (newState === STATES.PUMPING) {
      this.priceHistory.pumpStartPrice = null;
      this.priceHistory.pumpStartTime = null;
    }

    // When transitioning to drawdown, preserve the peak
    if (newState === STATES.DRAWDOWN && this.priceHistory.peak) {
      this.priceHistory.lastPumpPeak = this.priceHistory.peak;
    }

    return {
      from: oldState,
      to: newState
    };
  }

  markUnsafe(reason) {
    this.unsafe = true;
    this.metrics.failedAttempts++;
    this.unsafeReasons.add(reason);
  }

  resetUnsafe() {
    this.unsafe = false;
    this.unsafeReasons.clear();
  }
}

module.exports = {
  STATES,
  UNSAFE_REASONS,
  PricePoint,
  TokenStateManager
};
