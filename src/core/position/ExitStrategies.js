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
    const strength = token.getRecoveryStrength();
    const marketStructure = token.analyzeMarketStructure();
    
    // Exit if recovery strength drops significantly
    if (strength.total < this.config.EXIT_STRATEGIES.RECOVERY.MIN_STRENGTH) {
      return { shouldExit: true, portion: this.remainingPosition };
    }

    // Check for deteriorating market structure
    if (marketStructure.structureScore.overall < this.config.EXIT_STRATEGIES.RECOVERY.MIN_STRUCTURE_SCORE) {
      return { shouldExit: true, portion: this.remainingPosition };
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
    const marketStructure = token.analyzeMarketStructure();
    const percentageChange = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    
    // Check for sharp price reversal with high volume
    if (percentageChange < 0 && Math.abs(percentageChange) > this.config.EXIT_STRATEGIES.REVERSAL.THRESHOLD) {
      const volumeSpike = token.hasRecentVolumeSurge();
      const patternBreakdown = marketStructure.pattern && marketStructure.pattern.breakdown;
      
      return volumeSpike && patternBreakdown;
    }
    
    return false;
  }

  checkEnhancedTrailingStop(position, currentPrice, token) {
    const trailingConfig = this.config.EXIT_STRATEGIES.TRAILING_STOP;
    if (!trailingConfig.ENABLED) return false;

    const strength = token.getRecoveryStrength();
    const percentageChange = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    
    // Adjust trailing stop based on recovery strength
    if (percentageChange >= trailingConfig.ACTIVATION_THRESHOLD && !this.trailingStopPrice) {
      const basePercentage = trailingConfig.BASE_PERCENTAGE;
      const adjustedPercentage = basePercentage * (1 - (strength.total - 50) / 100);
      this.trailingStopPrice = this.roundToDecimals(currentPrice * (1 - (adjustedPercentage / 100)));
      return false;
    }

    if (this.trailingStopPrice && currentPrice > this.trailingStopPrice) {
      let trailPercentage = trailingConfig.BASE_PERCENTAGE;
      
      // Dynamic adjustment based on recovery metrics
      if (trailingConfig.DYNAMIC_ADJUSTMENT.ENABLED) {
        const marketHealth = token.analyzeMarketStructure().overallHealth / 100;
        trailPercentage = Math.min(
          Math.max(
            trailPercentage * (1 + (1 - marketHealth) * trailingConfig.DYNAMIC_ADJUSTMENT.VOLATILITY_MULTIPLIER),
            trailingConfig.DYNAMIC_ADJUSTMENT.MIN_PERCENTAGE
          ),
          trailingConfig.DYNAMIC_ADJUSTMENT.MAX_PERCENTAGE
        );
      }
      
      this.trailingStopPrice = this.roundToDecimals(currentPrice * (1 - (trailPercentage / 100)));
    }

    return this.trailingStopPrice && currentPrice <= this.trailingStopPrice;
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
