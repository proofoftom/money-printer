// Token state management
const STATES = {
  NEW: "new",               // Just created
  ACCUMULATION: "accumulation", // Early buying phase
  LAUNCHING: "launching",   // Initial pump starting
  PUMPING: "pumping",      // Active pump
  PUMPED: "pumped",        // Reached target
  DRAWDOWN: "drawdown",    // Price declining
  DEAD: "dead",            // Token inactive
};

// Safety check reasons
const UNSAFE_REASONS = {
  LIQUIDITY: "insufficient_liquidity",
  HOLDER_CONCENTRATION: "high_holder_concentration",
  TRADING_PATTERN: "suspicious_trading_pattern",
  VOLUME: "low_volume",
  AGE: "insufficient_age",
  CREATOR_SELLING: "creator_selling",
  WASH_TRADING: "wash_trading",
  RAPID_TRADING: "rapid_trading"
};

// Price tracking structure
class PricePoint {
  constructor(bodyPrice, wickPrice, timestamp) {
    this.bodyPrice = bodyPrice;
    this.wickPrice = wickPrice;
    this.timestamp = timestamp;
  }
}

const config = require("./config");

class TokenStateManager {
  constructor() {
    this.state = STATES.NEW;
    this.unsafeReasons = new Set();
    this.priceHistory = {
      initialPrice: null,     // First recorded price
      accumulationPrice: null, // Price at start of accumulation
      launchPrice: null,      // Price when launching detected
      peak: null,             // Highest price during pump/pumped
      bottom: null,           // Lowest price during drawdown
      lastPrice: null
    };
    this.metrics = {
      volumeProfile: {
        accumulation: 0,      // Volume during accumulation
        launch: 0,            // Volume during launch
        peak: 0              // Peak volume
      },
      buyPressure: {
        accumulation: 0,      // Buy pressure during accumulation
        launch: 0,           // Buy pressure during launch
        current: 0           // Current buy pressure
      },
      creatorActivity: {
        lastSell: null,      // Timestamp of last creator sell
        sellCount: 0,        // Number of creator sells
        sellVolume: 0        // Volume of creator sells
      },
      tradingPatterns: {
        rapidTraders: new Set(),    // Wallets with rapid trading
        alternatingTraders: new Set() // Wallets with suspicious patterns
      }
    };
    this.entryPoints = {
      accumulation: null,    // Best entry during accumulation
      launch: null,         // Best entry during launch
      pump: null           // Best entry during pump
    };
    this.unsafe = false;
  }

  updateState(token) {
    const now = Date.now();
    const tokenAge = now - token.minted;
    const earlyTrading = token.metrics.earlyTrading;
    
    // Early lifecycle management (first 5 minutes)
    if (tokenAge < 5 * 60 * 1000) {
      switch(this.state) {
        case STATES.NEW:
          if (this.detectAccumulation(token)) {
            this.setState(STATES.ACCUMULATION);
            this.priceHistory.accumulationPrice = token.currentPrice;
            this.findAccumulationEntry(token);
          }
          break;

        case STATES.ACCUMULATION:
          if (this.detectLaunch(token)) {
            this.setState(STATES.LAUNCHING);
            this.priceHistory.launchPrice = token.currentPrice;
            this.findLaunchEntry(token);
          }
          break;

        case STATES.LAUNCHING:
          if (this.detectPump(token)) {
            this.setState(STATES.PUMPING);
            this.findPumpEntry(token);
          } else if (this.detectFailedLaunch(token)) {
            this.setState(STATES.DEAD);
          }
          break;
      }
    }

    // Standard lifecycle management
    switch(this.state) {
      case STATES.PUMPING:
        if (this.detectPumped(token)) {
          this.setState(STATES.PUMPED);
        } else if (this.detectPumpFailure(token)) {
          this.setState(STATES.DRAWDOWN);
        }
        break;

      case STATES.PUMPED:
        if (this.detectDrawdown(token)) {
          this.setState(STATES.DRAWDOWN);
        }
        break;

      case STATES.DRAWDOWN:
        if (this.detectDead(token)) {
          this.setState(STATES.DEAD);
        }
        break;
    }
  }

  detectAccumulation(token) {
    const { earlyTrading } = token.metrics;
    if (!earlyTrading) return false;

    return (
      earlyTrading.uniqueBuyers >= config.SAFETY.MIN_UNIQUE_BUYERS &&
      earlyTrading.buyToSellRatio >= config.SAFETY.MIN_BUY_SELL_RATIO &&
      !earlyTrading.suspiciousActivity?.length
    );
  }

  detectLaunch(token) {
    const { earlyTrading } = token.metrics;
    if (!earlyTrading) return false;

    return (
      earlyTrading.volumeAcceleration >= config.SAFETY.MIN_VOLUME_ACCELERATION &&
      earlyTrading.buyToSellRatio >= config.SAFETY.MIN_BUY_SELL_RATIO * 1.5 &&
      !earlyTrading.creatorSells
    );
  }

  detectPump(token) {
    return (
      token.metrics.earlyTrading?.volumeAcceleration >= config.SAFETY.PUMP_DETECTION.MIN_GAIN_RATE &&
      this.getPriceGain(token) >= config.SAFETY.PUMP_DETECTION.MIN_PRICE_GAIN &&
      token.getVolumeSpike() >= config.SAFETY.PUMP_DETECTION.MIN_VOLUME_SPIKE
    );
  }

  findAccumulationEntry(token) {
    if (
      token.metrics.earlyTrading?.buyToSellRatio >= config.SAFETY.MIN_BUY_SELL_RATIO * 1.2 &&
      token.metrics.earlyTrading?.uniqueBuyers >= config.SAFETY.MIN_UNIQUE_BUYERS * 1.5
    ) {
      this.entryPoints.accumulation = {
        price: token.currentPrice,
        confidence: this.calculateEntryConfidence(token)
      };
    }
  }

  findLaunchEntry(token) {
    if (
      token.metrics.earlyTrading?.volumeAcceleration >= config.SAFETY.MIN_VOLUME_ACCELERATION * 1.3 &&
      !token.metrics.earlyTrading?.creatorSells
    ) {
      this.entryPoints.launch = {
        price: token.currentPrice,
        confidence: this.calculateEntryConfidence(token)
      };
    }
  }

  calculateEntryConfidence(token) {
    const { earlyTrading } = token.metrics;
    if (!earlyTrading) return 0;

    let confidence = 0;
    
    // Buy pressure (0-30 points)
    confidence += (earlyTrading.buyToSellRatio / config.SAFETY.MIN_BUY_SELL_RATIO) * 30;
    
    // Unique buyers (0-20 points)
    confidence += (earlyTrading.uniqueBuyers / config.SAFETY.MIN_UNIQUE_BUYERS) * 20;
    
    // Volume acceleration (0-20 points)
    confidence += (earlyTrading.volumeAcceleration / config.SAFETY.MIN_VOLUME_ACCELERATION) * 20;
    
    // Creator behavior (0-30 points)
    confidence += earlyTrading.creatorSells ? 0 : 30;
    
    // Deductions for suspicious activity
    if (earlyTrading.suspiciousActivity?.length) {
      confidence -= earlyTrading.suspiciousActivity.length * 15;
    }

    return Math.max(0, Math.min(100, confidence));
  }

  getBestEntry() {
    // Return the entry point with the highest confidence
    return [this.entryPoints.accumulation, this.entryPoints.launch, this.entryPoints.pump]
      .filter(Boolean)
      .sort((a, b) => b.confidence - a.confidence)[0];
  }

  getPriceGain(token) {
    if (!this.priceHistory.initialPrice || !token.currentPrice) return 0;
    return (
      ((token.currentPrice.bodyPrice - this.priceHistory.initialPrice.bodyPrice) /
        this.priceHistory.initialPrice.bodyPrice) *
      100
    );
  }

  detectPumped(token) {
    if (!this.priceHistory.peak || !token.currentPrice) return false;
    return (
      ((token.currentPrice.bodyPrice - this.priceHistory.peak.bodyPrice) /
        this.priceHistory.peak.bodyPrice) *
      100 >= config.THRESHOLDS.PUMPED
    );
  }

  detectPumpFailure(token) {
    if (!this.priceHistory.peak || !token.currentPrice) return false;
    return (
      ((this.priceHistory.peak.bodyPrice - token.currentPrice.bodyPrice) /
        this.priceHistory.peak.bodyPrice) *
      100 >= config.THRESHOLDS.PUMP_FAILURE
    );
  }

  detectDrawdown(token) {
    if (!this.priceHistory.peak || !token.currentPrice) return false;
    return (
      ((this.priceHistory.peak.bodyPrice - token.currentPrice.bodyPrice) /
        this.priceHistory.peak.bodyPrice) *
      100 >= config.THRESHOLDS.DRAWDOWN
    );
  }

  detectDead(token) {
    if (!this.priceHistory.bottom || !token.currentPrice) return false;
    return (
      ((this.priceHistory.bottom.bodyPrice - token.currentPrice.bodyPrice) /
        this.priceHistory.bottom.bodyPrice) *
      100 >= config.THRESHOLDS.DEAD
    );
  }

  detectFailedLaunch(token) {
    if (!this.priceHistory.launchPrice || !token.currentPrice) return false;
    return (
      ((this.priceHistory.launchPrice.bodyPrice - token.currentPrice.bodyPrice) /
        this.priceHistory.launchPrice.bodyPrice) *
      100 >= config.THRESHOLDS.FAILED_LAUNCH
    );
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
      to: newState,
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
  TokenStateManager,
};
