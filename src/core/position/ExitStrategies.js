const config = require('../../utils/config');

class ExitStrategies {
  constructor(config) {
    this.config = config;
    this.trailingStopPrice = null;
    this.volumeHistory = [];
    this.peakVolume = 0;
    this.lastVolumeCheck = Date.now() / 1000;
    this.entryTime = Date.now() / 1000;
    this.timeExtended = false;
    this.remainingPosition = 1.0;
    this.triggeredTiers = new Set();
  }

  roundToDecimals(value, decimals = 8) {
    const multiplier = Math.pow(10, decimals);
    return Math.round(value * multiplier) / multiplier;
  }

  shouldExit(position, currentPrice, currentVolume, token) {
    if (this.remainingPosition === 0) {
      return { shouldExit: false };
    }

    // Check recovery strength and market structure first
    const recoveryCheck = this.checkRecoveryWeakening(token);
    if (recoveryCheck.shouldExit) {
      return { ...recoveryCheck, reason: 'RECOVERY_WEAKENING' };
    }

    // Check take profit using dynamic targets based on recovery strength
    const takeProfitResult = this.checkDynamicTakeProfit(position, currentPrice, token);
    if (takeProfitResult.shouldExit) {
      return { ...takeProfitResult, reason: `takeProfit_tier${this.getTakeProfitTier(position, currentPrice)}` };
    }

    // Check for rapid reversal after recovery
    if (this.checkRapidReversal(position, currentPrice, token)) {
      const portion = this.remainingPosition;
      this.remainingPosition = 0;
      return { shouldExit: true, reason: 'RAPID_REVERSAL', portion };
    }

    // Enhanced trailing stop based on recovery momentum
    if (this.checkEnhancedTrailingStop(position, currentPrice, token)) {
      const portion = this.remainingPosition;
      this.remainingPosition = 0;
      return { shouldExit: true, reason: 'TRAILING_STOP', portion };
    }

    // Volume-based exit with recovery context
    if (this.checkRecoveryVolumeExit(currentVolume, token)) {
      const portion = this.remainingPosition;
      this.remainingPosition = 0;
      return { shouldExit: true, reason: 'VOLUME_DROP', portion };
    }

    return { shouldExit: false };
  }

  checkRecoveryWeakening(token) {
    if (!token.recoveryMetrics) {
      return { shouldExit: false };
    }

    const {
      recoveryStrength,
      buyPressure,
      marketStructure,
      recoveryPhase
    } = token.recoveryMetrics;

    // Exit if recovery strength drops significantly
    if (recoveryStrength < this.config.RECOVERY.MIN_STRENGTH) {
      return {
        shouldExit: true,
        portion: this.remainingPosition,
        reason: 'RECOVERY_STRENGTH_LOW'
      };
    }

    // Exit if buy pressure weakens
    if (buyPressure < this.config.RECOVERY.MIN_BUY_PRESSURE) {
      return {
        shouldExit: true,
        portion: this.remainingPosition,
        reason: 'BUY_PRESSURE_LOW'
      };
    }

    // Exit if market structure turns bearish
    if (marketStructure === 'bearish') {
      return {
        shouldExit: true,
        portion: this.remainingPosition,
        reason: 'BEARISH_STRUCTURE'
      };
    }

    // Exit if recovery phase changes to distribution
    if (recoveryPhase === 'distribution') {
      return {
        shouldExit: true,
        portion: this.remainingPosition,
        reason: 'DISTRIBUTION_PHASE'
      };
    }

    return { shouldExit: false };
  }

  checkDynamicTakeProfit(position, currentPrice, token) {
    const takeProfitConfig = this.config.EXIT_STRATEGIES.TAKE_PROFIT;
    if (!takeProfitConfig.ENABLED || this.remainingPosition === 0) {
      return { shouldExit: false, portion: 0 };
    }

    const strength = token.getRecoveryStrength();
    const percentageGain = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    
    // Adjust take profit tiers based on recovery strength
    const adjustedTiers = takeProfitConfig.TIERS.map(tier => ({
      ...tier,
      THRESHOLD: tier.THRESHOLD * (1 + (strength.total - 50) / 100)
    }));

    // Check adjusted tiers in descending order
    const sortedTiers = [...adjustedTiers].sort((a, b) => b.THRESHOLD - a.THRESHOLD);

    for (const tier of sortedTiers) {
      if (percentageGain >= tier.THRESHOLD && !this.triggeredTiers.has(tier.THRESHOLD)) {
        this.triggeredTiers.add(tier.THRESHOLD);
        const portion = Math.min(tier.PORTION, this.remainingPosition);
        this.remainingPosition = this.roundToDecimals(this.remainingPosition - portion);
        return { shouldExit: true, portion: this.roundToDecimals(portion) };
      }
    }

    return { shouldExit: false, portion: 0 };
  }

  checkRapidReversal(position, currentPrice, token) {
    if (!token.recoveryMetrics) {
      return false;
    }

    const priceChange = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    const timeInPosition = (Date.now() - position.entryTime) / 1000; // in seconds

    // Check for rapid price decline after entry
    if (timeInPosition < this.config.RAPID_REVERSAL.TIME_WINDOW) {
      if (priceChange < -this.config.RAPID_REVERSAL.MAX_DRAWDOWN) {
        return true;
      }
    }

    // Check for sudden change in market structure
    if (token.recoveryMetrics.marketStructure === 'bearish' &&
        timeInPosition < this.config.RAPID_REVERSAL.STRUCTURE_CHANGE_WINDOW) {
      return true;
    }

    return false;
  }

  checkEnhancedTrailingStop(position, currentPrice, token) {
    if (!this.trailingStopPrice) {
      this.trailingStopPrice = position.entryPrice;
    }

    const currentPnL = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

    // Adjust trailing stop based on recovery metrics
    let stopDistance = this.config.TRAILING_STOP.BASE_DISTANCE;
    
    if (token.recoveryMetrics) {
      // Tighten stop if recovery weakens
      if (token.recoveryMetrics.recoveryStrength < 50) {
        stopDistance *= 0.5;
      }
      
      // Tighten stop in distribution phase
      if (token.recoveryMetrics.recoveryPhase === 'distribution') {
        stopDistance *= 0.3;
      }
    }

    // Update trailing stop if we have a new high
    if (currentPrice > this.trailingStopPrice) {
      this.trailingStopPrice = currentPrice;
    }

    // Check if price has fallen below trailing stop
    const stopPrice = this.trailingStopPrice * (1 - stopDistance / 100);
    return currentPrice < stopPrice;
  }

  checkRecoveryVolumeExit(currentVolume, token) {
    const volumeConfig = this.config.EXIT_STRATEGIES.VOLUME_BASED;
    if (!volumeConfig.ENABLED) return false;

    const now = Date.now() / 1000;
    const marketStructure = token.analyzeMarketStructure();

    // Clean up old volume history
    this.volumeHistory = this.volumeHistory.filter(entry => 
      entry.timestamp >= now - volumeConfig.MEASUREMENT_PERIOD
    );

    // Add current volume
    this.volumeHistory.push({ timestamp: now, volume: currentVolume });
    
    // Update peak volume if significant
    if (currentVolume >= volumeConfig.MIN_PEAK_VOLUME) {
      this.peakVolume = Math.max(this.peakVolume, currentVolume);
    }

    if (this.volumeHistory.length < 2 || this.peakVolume < volumeConfig.MIN_PEAK_VOLUME) {
      return false;
    }

    // Calculate volume trend
    const recentAvgVolume = this.volumeHistory
      .slice(-3)
      .reduce((sum, entry) => sum + entry.volume, 0) / 3;
    
    const volumeDropPercentage = ((this.peakVolume - recentAvgVolume) / this.peakVolume) * 100;

    // Exit if volume drops significantly and market structure weakens
    return volumeDropPercentage >= volumeConfig.VOLUME_DROP_THRESHOLD && 
           marketStructure.buyPressure < volumeConfig.MIN_BUY_PRESSURE;
  }

  getTakeProfitTier(position, currentPrice) {
    const percentageGain = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    const tiers = this.config.EXIT_STRATEGIES.TAKE_PROFIT.TIERS;
    for (let i = tiers.length - 1; i >= 0; i--) {
      if (percentageGain >= tiers[i].THRESHOLD) {
        return i + 1;
      }
    }
    return 0;
  }

  calculateVolatility() {
    // Implement volatility calculation based on your needs
    // This could be based on price history, ATR, or other metrics
    return 0.5; // Placeholder return
  }

  reset() {
    this.trailingStopPrice = null;
    this.volumeHistory = [];
    this.peakVolume = 0;
    this.lastVolumeCheck = Date.now() / 1000;
    this.entryTime = Date.now() / 1000;
    this.timeExtended = false;
    this.remainingPosition = 1.0;
    this.triggeredTiers = new Set();
  }

  checkExitConditions(position) {
    const { POSITION } = this.config;
    
    // Check stop loss
    if (this.checkStopLoss(position)) {
      return {
        shouldExit: true,
        reason: 'Stop loss triggered',
        type: 'stop_loss'
      };
    }

    // Check take profit
    if (this.checkTakeProfit(position)) {
      return {
        shouldExit: true,
        reason: 'Take profit reached',
        type: 'take_profit'
      };
    }

    // Check trailing stop
    if (this.checkTrailingStop(position)) {
      return {
        shouldExit: true,
        reason: 'Trailing stop triggered',
        type: 'trailing_stop'
      };
    }

    // Check max hold time
    if (Date.now() >= position.maxHoldTime) {
      return {
        shouldExit: true,
        reason: 'Maximum hold time reached',
        type: 'time_exit'
      };
    }

    return {
      shouldExit: false,
      reason: null,
      type: null
    };
  }

  checkStopLoss(position) {
    const currentLoss = position.getCurrentDrawdown();
    return currentLoss <= this.config.POSITION.EXIT.STOP_LOSS;
  }

  checkTakeProfit(position) {
    const currentGain = position.getCurrentGain();
    return currentGain >= this.config.POSITION.EXIT.PROFIT;
  }

  checkTrailingStop(position) {
    if (!position.highWaterMark) return false;
    
    const drawdownFromHigh = ((position.token.currentPrice - position.highWaterMark) / position.highWaterMark) * 100;
    return drawdownFromHigh <= -this.config.POSITION.EXIT.TRAILING_STOP;
  }
}

module.exports = ExitStrategies;
