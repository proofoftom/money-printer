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
    // Skip all checks if no position remaining
    if (this.remainingPosition === 0) {
      return { shouldExit: false };
    }

    const now = Date.now();
    const isNewToken = now - token.minted < 5 * 60 * 1000;

    if (isNewToken) {
      // Check for sudden creator selling
      if (token.metrics.earlyTrading?.creatorSells > this.config.EXIT.NEW_TOKEN.MAX_CREATOR_SELLS) {
        const portion = this.remainingPosition;
        this.remainingPosition = 0;
        return { shouldExit: true, reason: 'CREATOR_SELLING', portion };
      }

      // Check for declining buy pressure
      if (token.metrics.earlyTrading?.buyToSellRatio < this.config.EXIT.NEW_TOKEN.MIN_BUY_SELL_RATIO) {
        const portion = this.remainingPosition;
        this.remainingPosition = 0;
        return { shouldExit: true, reason: 'DECLINING_BUY_PRESSURE', portion };
      }

      // Check for suspicious trading patterns emerging
      if (token.metrics.earlyTrading?.suspiciousActivity?.length > this.config.EXIT.NEW_TOKEN.MAX_SUSPICIOUS_PATTERNS) {
        const portion = this.remainingPosition;
        this.remainingPosition = 0;
        return { shouldExit: true, reason: 'SUSPICIOUS_PATTERNS', portion };
      }

      // Check for volume acceleration decline
      if (token.metrics.earlyTrading?.volumeAcceleration < this.config.EXIT.NEW_TOKEN.MIN_VOLUME_ACCELERATION) {
        const portion = this.remainingPosition;
        this.remainingPosition = 0;
        return { shouldExit: true, reason: 'VOLUME_ACCELERATION_DROP', portion };
      }

      // Modified take profit for new tokens - more aggressive
      const newTokenTakeProfitResult = this.checkNewTokenTakeProfit(position, currentPrice);
      if (newTokenTakeProfitResult.shouldExit) {
        return { ...newTokenTakeProfitResult, reason: 'NEW_TOKEN_TAKE_PROFIT' };
      }
    }

    // Check take profit first to capture gains
    const takeProfitResult = this.checkTakeProfit(position, currentPrice);
    if (takeProfitResult.shouldExit) {
      return { ...takeProfitResult, reason: `takeProfit_tier${this.getTakeProfitTier(position, currentPrice)}` };
    }

    // Other exit conditions exit the entire remaining position
    if (this.checkStopLoss(position, currentPrice)) {
      const portion = this.remainingPosition;
      this.remainingPosition = 0;
      return { shouldExit: true, reason: 'STOP_LOSS', portion };
    }

    if (this.checkTrailingStop(position, currentPrice)) {
      const portion = this.remainingPosition;
      this.remainingPosition = 0;
      return { shouldExit: true, reason: 'TRAILING_STOP', portion };
    }

    if (this.checkVolumeBasedExit(currentVolume)) {
      const portion = this.remainingPosition;
      this.remainingPosition = 0;
      return { shouldExit: true, reason: 'VOLUME_DROP', portion };
    }

    if (this.checkTimeBasedExit(position, currentPrice)) {
      const portion = this.remainingPosition;
      this.remainingPosition = 0;
      return { shouldExit: true, reason: 'TIME_LIMIT', portion };
    }

    return { shouldExit: false };
  }

  checkStopLoss(position, currentPrice) {
    if (!this.config.EXIT_STRATEGIES.STOP_LOSS.ENABLED) return false;
    
    const percentageChange = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    return percentageChange <= this.config.EXIT_STRATEGIES.STOP_LOSS.THRESHOLD;
  }

  checkTrailingStop(position, currentPrice) {
    const trailingConfig = this.config.EXIT_STRATEGIES.TRAILING_STOP;
    if (!trailingConfig.ENABLED) return false;

    const percentageChange = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    
    // Initialize trailing stop when profit threshold is reached
    if (percentageChange >= trailingConfig.ACTIVATION_THRESHOLD && !this.trailingStopPrice) {
      const trailPercentage = trailingConfig.BASE_PERCENTAGE;
      this.trailingStopPrice = this.roundToDecimals(currentPrice * (1 - (trailPercentage / 100)));
      return false;
    }

    // Update trailing stop on new highs
    if (this.trailingStopPrice && currentPrice > this.trailingStopPrice) {
      let trailPercentage = trailingConfig.BASE_PERCENTAGE;
      
      if (trailingConfig.DYNAMIC_ADJUSTMENT.ENABLED) {
        const volatility = this.calculateVolatility();
        trailPercentage = Math.min(
          Math.max(
            trailPercentage * (1 + volatility * trailingConfig.DYNAMIC_ADJUSTMENT.VOLATILITY_MULTIPLIER),
            trailingConfig.DYNAMIC_ADJUSTMENT.MIN_PERCENTAGE
          ),
          trailingConfig.DYNAMIC_ADJUSTMENT.MAX_PERCENTAGE
        );
      }
      
      this.trailingStopPrice = this.roundToDecimals(currentPrice * (1 - (trailPercentage / 100)));
    }

    // Check if price has fallen below trailing stop
    return this.trailingStopPrice && currentPrice <= this.trailingStopPrice;
  }

  checkVolumeBasedExit(currentVolume) {
    const volumeConfig = this.config.EXIT_STRATEGIES.VOLUME_BASED;
    if (!volumeConfig.ENABLED) return false;

    const now = Date.now() / 1000;

    // Clean up old volume history first
    const cutoffTime = now - volumeConfig.MEASUREMENT_PERIOD;
    this.volumeHistory = this.volumeHistory.filter(entry => entry.timestamp >= cutoffTime);

    // Add current volume to history
    const newEntry = { timestamp: now, volume: currentVolume };
    this.volumeHistory.push(newEntry);

    // Update peak volume if current volume meets minimum threshold
    if (currentVolume >= volumeConfig.MIN_PEAK_VOLUME) {
      this.peakVolume = Math.max(this.peakVolume, currentVolume);
    }

    // Only check volume drop if we have enough history and peak volume
    if (this.volumeHistory.length < 2 || this.peakVolume < volumeConfig.MIN_PEAK_VOLUME) {
      return false;
    }

    // Calculate current average volume (including current volume)
    const avgVolume = currentVolume;
    
    // Check if current volume has dropped significantly from peak
    const volumeDropPercentage = ((this.peakVolume - avgVolume) / this.peakVolume) * 100;

    // Return true if volume has dropped below threshold
    return volumeDropPercentage >= volumeConfig.VOLUME_DROP_THRESHOLD;
  }

  checkTimeBasedExit(position, currentPrice) {
    const timeConfig = this.config.EXIT_STRATEGIES.TIME_BASED;
    if (!timeConfig.ENABLED) return false;

    const currentTime = Date.now() / 1000;
    const elapsedSeconds = currentTime - this.entryTime;
    const percentageGain = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

    // Check if we should extend the time limit
    if (!this.timeExtended && percentageGain >= timeConfig.EXTENSION_THRESHOLD) {
      this.timeExtended = true;
    }

    // Calculate max hold time based on whether we've extended it
    const maxHoldTime = this.timeExtended 
      ? timeConfig.MAX_HOLD_TIME + timeConfig.EXTENSION_TIME 
      : timeConfig.MAX_HOLD_TIME;

    // Exit if we've exceeded the max hold time
    return elapsedSeconds >= maxHoldTime;
  }

  checkTakeProfit(position, currentPrice) {
    const takeProfitConfig = this.config.EXIT_STRATEGIES.TAKE_PROFIT;
    if (!takeProfitConfig.ENABLED || this.remainingPosition === 0) {
      return { shouldExit: false, portion: 0 };
    }

    const percentageGain = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    
    // Check tiers in descending order to handle highest profit targets first
    const sortedTiers = [...takeProfitConfig.TIERS].sort((a, b) => b.THRESHOLD - a.THRESHOLD);

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

  checkNewTokenTakeProfit(position, currentPrice) {
    const profitPercentage = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    
    // More aggressive take profit tiers for new tokens
    const tiers = [
      { threshold: 300, portion: 0.5 },  // Take 50% at 300% profit
      { threshold: 500, portion: 0.3 },  // Take 30% at 500% profit
      { threshold: 1000, portion: 0.2 }  // Take remaining 20% at 1000% profit
    ];
    
    for (const tier of tiers) {
      if (profitPercentage >= tier.threshold && !this.triggeredTiers.has(tier.threshold)) {
        this.triggeredTiers.add(tier.threshold);
        const portion = tier.portion * this.remainingPosition;
        this.remainingPosition -= portion;
        return { shouldExit: true, portion };
      }
    }
    
    return { shouldExit: false };
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
}

module.exports = ExitStrategies;
