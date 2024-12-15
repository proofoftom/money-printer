class ExitStrategies {
  constructor(config) {
    this.config = config;
    this.trailingStopPrice = null;
    this.volumeHistory = [];
    this.peakVolume = 0;
    this.lastVolumeCheck = Date.now() / 1000;
    this.entryTime = Date.now() / 1000;
    this.timeExtended = false;
  }

  shouldExit(position, currentPrice, currentVolume) {
    if (this.checkStopLoss(position, currentPrice)) {
      return { shouldExit: true, reason: 'STOP_LOSS' };
    }

    if (this.checkTrailingStop(position, currentPrice)) {
      return { shouldExit: true, reason: 'TRAILING_STOP' };
    }

    if (this.checkVolumeBasedExit(currentVolume)) {
      return { shouldExit: true, reason: 'VOLUME_DROP' };
    }

    if (this.checkTimeBasedExit(position, currentPrice)) {
      return { shouldExit: true, reason: 'TIME_LIMIT' };
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
      this.trailingStopPrice = currentPrice * (1 - (trailPercentage / 100));
    }

    // Update trailing stop on new highs
    if (this.trailingStopPrice) {
      const currentTrailPercentage = ((currentPrice - this.trailingStopPrice) / currentPrice) * 100;
      if (currentTrailPercentage > trailingConfig.BASE_PERCENTAGE) {
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
        
        this.trailingStopPrice = currentPrice * (1 - (trailPercentage / 100));
      }
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
      return false;
    }

    // Calculate max hold time based on whether we've extended it
    const maxHoldTime = this.timeExtended 
      ? timeConfig.MAX_HOLD_TIME + timeConfig.EXTENSION_TIME 
      : timeConfig.MAX_HOLD_TIME;

    // Exit if we've exceeded the max hold time
    return elapsedSeconds >= maxHoldTime;
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
  }
}

module.exports = ExitStrategies;
