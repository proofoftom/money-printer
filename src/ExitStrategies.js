class ExitStrategies {
  constructor(config) {
    this.config = config;
  }

  calculateVolatility(priceHistory) {
    if (!priceHistory || priceHistory.length < 2) {
      return 0;
    }

    // Calculate returns
    const returns = [];
    for (let i = 1; i < priceHistory.length; i++) {
      const return_ = (priceHistory[i].price - priceHistory[i - 1].price) / priceHistory[i - 1].price;
      returns.push(return_);
    }

    // Calculate standard deviation of returns
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const squaredDiffs = returns.map(r => Math.pow(r - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length;
    const stdDev = Math.sqrt(variance);

    return stdDev;
  }

  calculateDynamicStopLoss(position) {
    const { trailingStopLoss } = this.config;
    
    if (!trailingStopLoss.dynamicAdjustment?.enabled) {
      return trailingStopLoss.percentage;
    }

    if (!position.priceHistory) {
      return trailingStopLoss.percentage;
    }

    const volatility = this.calculateVolatility(position.priceHistory);
    const adjustment = volatility * trailingStopLoss.dynamicAdjustment.volatilityMultiplier;
    
    // Adjust the base percentage based on volatility
    let dynamicPercentage = trailingStopLoss.percentage + adjustment;

    // Ensure the percentage stays within configured bounds
    dynamicPercentage = Math.max(
      trailingStopLoss.dynamicAdjustment.minPercentage,
      Math.min(trailingStopLoss.dynamicAdjustment.maxPercentage, dynamicPercentage)
    );

    return dynamicPercentage;
  }

  calculateDynamicTakeProfit(position) {
    const { trailingTakeProfit } = this.config;
    
    if (!trailingTakeProfit.dynamicAdjustment?.enabled) {
      return trailingTakeProfit.trailPercentage;
    }

    if (!position.priceHistory) {
      return trailingTakeProfit.trailPercentage;
    }

    const volatility = this.calculateVolatility(position.priceHistory);
    const adjustment = volatility * trailingTakeProfit.dynamicAdjustment.volatilityMultiplier;
    
    // Adjust the base percentage based on volatility
    let dynamicPercentage = trailingTakeProfit.trailPercentage + adjustment;

    // Ensure the percentage stays within configured bounds
    dynamicPercentage = Math.max(
      trailingTakeProfit.dynamicAdjustment.minPercentage,
      Math.min(trailingTakeProfit.dynamicAdjustment.maxPercentage, dynamicPercentage)
    );

    return dynamicPercentage;
  }

  shouldStopLoss(position) {
    const { trailingStopLoss } = this.config;
    if (!trailingStopLoss.enabled) return false;

    const stopLossPercentage = this.calculateDynamicStopLoss(position);
    const dropPercentage = ((position.highestPrice - position.currentPrice) / position.highestPrice) * 100;
    
    return dropPercentage >= stopLossPercentage;
  }

  shouldTakeProfit(position) {
    const { trailingTakeProfit } = this.config;
    if (!trailingTakeProfit.enabled) return false;

    const profitPercentage = ((position.highestPrice - position.entryPrice) / position.entryPrice) * 100;
    if (profitPercentage < trailingTakeProfit.initialTrigger) return false;

    const trailPercentage = this.calculateDynamicTakeProfit(position);
    const dropFromHigh = ((position.highestPrice - position.currentPrice) / position.highestPrice) * 100;
    
    return dropFromHigh >= trailPercentage;
  }

  calculateTierExit(position) {
    const { tieredTakeProfit } = this.config;
    if (!tieredTakeProfit.enabled) return null;

    const currentProfit = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
    
    // Find the highest tier that has been reached
    const reachedTiers = tieredTakeProfit.tiers
      .filter(tier => currentProfit >= tier.percentage)
      .sort((a, b) => b.percentage - a.percentage);

    if (reachedTiers.length === 0) return null;

    const nextTier = reachedTiers[0];
    const remainingSize = position.remainingSize || 1.0;
    
    // If we've already taken profit at this tier, return null
    if (remainingSize < nextTier.portion) return null;
    
    return nextTier.portion;
  }

  shouldTimeBasedExit(position) {
    const { timeBasedExit } = this.config;
    if (!timeBasedExit.enabled) return false;

    const currentTime = Date.now();
    const positionDuration = currentTime - position.entryTime;
    
    // Calculate current profit percentage
    const profitPercentage = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
    
    // Check if we should extend the duration based on profit
    let maxDuration = timeBasedExit.maxDuration;
    if (timeBasedExit.profitBasedExtension?.enabled && 
        profitPercentage >= timeBasedExit.profitBasedExtension.threshold) {
      maxDuration *= timeBasedExit.profitBasedExtension.extensionMultiplier;
    }
    
    return positionDuration >= maxDuration;
  }

  shouldTimedTakeProfit(position) {
    const { timeBasedExit } = this.config;
    if (!timeBasedExit.enabled || !timeBasedExit.timedTakeProfit?.enabled) return false;

    const currentTime = Date.now();
    const positionDuration = currentTime - position.entryTime;
    const profitPercentage = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;

    // Find the appropriate interval based on position duration
    const interval = timeBasedExit.timedTakeProfit.intervals
      .filter(i => positionDuration >= i.time)
      .sort((a, b) => b.time - a.time)[0];

    if (!interval) return false;

    return profitPercentage >= interval.percentage;
  }

  shouldVolumeBasedExit(position) {
    const { volumeBasedExit } = this.config;
    if (!volumeBasedExit.enabled || !position.volumeHistory) return false;

    // Check volume drop
    if (volumeBasedExit.volumeDrop) {
      const recentVolumes = position.volumeHistory
        .filter(v => Date.now() - v.timestamp <= volumeBasedExit.volumeDrop.window)
        .map(v => v.volume);

      if (recentVolumes.length >= 2) {
        const peakVolume = Math.max(...recentVolumes);
        const currentVolume = recentVolumes[recentVolumes.length - 1];
        const volumeDropPercentage = ((peakVolume - currentVolume) / peakVolume) * 100;

        if (volumeDropPercentage >= volumeBasedExit.volumeDrop.threshold) {
          return true;
        }
      }
    }

    // Check volume spike
    if (volumeBasedExit.volumeSpike) {
      const profitPercentage = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
      
      // Only check volume spike if we're in sufficient profit
      if (profitPercentage >= volumeBasedExit.volumeSpike.profitThreshold) {
        const volumes = position.volumeHistory.map(v => v.volume);
        // Calculate average excluding the current volume
        const historicalVolumes = volumes.slice(0, -1);
        const averageVolume = historicalVolumes.reduce((a, b) => a + b, 0) / historicalVolumes.length;
        const currentVolume = volumes[volumes.length - 1];
        const volumeIncreasePercentage = ((currentVolume - averageVolume) / averageVolume) * 100;

        if (volumeIncreasePercentage >= volumeBasedExit.volumeSpike.threshold) {
          return true;
        }
      }
    }

    return false;
  }

  shouldExit(position) {
    return (
      this.shouldStopLoss(position) ||
      this.shouldTakeProfit(position) ||
      this.shouldTimeBasedExit(position) ||
      this.shouldTimedTakeProfit(position) ||
      this.shouldVolumeBasedExit(position)
    );
  }
}

module.exports = ExitStrategies;
