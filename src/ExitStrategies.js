const EventEmitter = require('events');

class ExitStrategies extends EventEmitter {
  constructor({ config, position, token, priceManager }) {
    super();
    this.config = config;
    this.position = position;
    this.token = token;
    this.priceManager = priceManager;
    this.trailingStopPrice = null;
    this.volumeHistory = [];
    this.peakVolume = 0;
    this.lastVolumeCheck = Date.now() / 1000;
    this.entryTime = Date.now() / 1000;
    this.timeExtended = false;
    this.remainingPosition = 1.0;
    this.triggeredTiers = new Set();
    this.lastTraderCheck = Date.now();

    // Listen to token events
    this.token.on('volumeUpdate', this.handleVolumeUpdate.bind(this));
    this.token.on('priceUpdate', this.handlePriceUpdate.bind(this));

    // Listen to price manager events
    if (this.priceManager) {
      this.priceManager.on('priceUpdate', this.handleSolPriceUpdate.bind(this));
    }

    // Set up periodic trader analysis
    setInterval(() => this.checkTraderActivity(), 30000); // Every 30 seconds
  }

  checkTraderActivity() {
    const metrics = this.position.getTraderMetrics();
    const now = Date.now();
    this.lastTraderCheck = now;

    // Check for concerning trader activity
    const concerns = [];

    // High initial trader exit rate
    if (metrics.initialTraderExitRate > 0.5) { // More than 50% of initial traders exited
      concerns.push({
        type: 'initial_trader_exodus',
        severity: metrics.initialTraderExitRate,
        description: `${(metrics.initialTraderExitRate * 100).toFixed(1)}% of initial traders exited`
      });
    }

    // Low trader retention
    if (metrics.retentionRate < 0.3) { // Less than 30% retention
      concerns.push({
        type: 'low_retention',
        severity: 1 - metrics.retentionRate,
        description: `Only ${(metrics.retentionRate * 100).toFixed(1)}% trader retention`
      });
    }

    // Whale concentration
    const whaleRatio = metrics.whaleCount / metrics.activeTraderCount;
    if (whaleRatio > 0.1) { // More than 10% of active traders are whales
      concerns.push({
        type: 'high_whale_concentration',
        severity: whaleRatio,
        description: `${(whaleRatio * 100).toFixed(1)}% of active traders are whales`
      });
    }

    // Sort concerns by severity
    concerns.sort((a, b) => b.severity - a.severity);

    // Emit exit signal if there are serious concerns
    if (concerns.length > 0) {
      const mostSevere = concerns[0];
      if (mostSevere.severity > 0.7) { // Very severe concern
        this.emit('exit', {
          reason: mostSevere.type,
          portion: 1.0,
          price: this.position.currentPrice,
          volume: this.token.volume,
          details: mostSevere.description
        });
      }
    }
  }

  handleVolumeUpdate(volumeData) {
    const result = this.shouldExit(this.position.currentPrice, volumeData.volume);
    if (result.shouldExit) {
      this.emit('exit', { 
        reason: result.reason, 
        portion: result.portion,
        price: this.position.currentPrice,
        volume: volumeData.volume
      });
    }
  }

  handlePriceUpdate(priceData) {
    const result = this.shouldExit(priceData.price, this.token.volume);
    if (result.shouldExit) {
      setImmediate(() => {
        this.emit('exit', { 
          reason: result.reason, 
          portion: result.portion,
          price: priceData.price,
          volume: this.token.volume
        });
      });
    }
    return result;
  }

  handleSolPriceUpdate(priceData) {
    // Recalculate USD-based thresholds if needed
    if (this.config.EXIT_STRATEGIES.USD_BASED_THRESHOLDS) {
      this.updateUSDThresholds(priceData.newPrice);
    }
  }

  updateUSDThresholds(solPrice) {
    if (this.config.EXIT_STRATEGIES.TAKE_PROFIT.ENABLED) {
      for (const tier of this.config.EXIT_STRATEGIES.TAKE_PROFIT.TIERS) {
        if (tier.USD_THRESHOLD) {
          tier.THRESHOLD = (tier.USD_THRESHOLD / solPrice) / this.position.entryPrice - 1;
        }
      }
    }

    if (this.config.EXIT_STRATEGIES.STOP_LOSS.ENABLED && this.config.EXIT_STRATEGIES.STOP_LOSS.USD_THRESHOLD) {
      this.config.EXIT_STRATEGIES.STOP_LOSS.THRESHOLD = 
        (this.config.EXIT_STRATEGIES.STOP_LOSS.USD_THRESHOLD / solPrice) / this.position.entryPrice - 1;
    }
  }

  roundToDecimals(value, decimals = 8) {
    const multiplier = Math.pow(10, decimals);
    return Math.round(value * multiplier) / multiplier;
  }

  shouldExit(currentPrice, currentVolume) {
    // Add trader activity to exit decision
    const now = Date.now();
    const timeSinceLastCheck = now - this.lastTraderCheck;
    
    // Force a trader check if it's been more than a minute
    if (timeSinceLastCheck > 60000) {
      this.checkTraderActivity();
    }

    // Skip all checks if no position remaining
    if (this.remainingPosition === 0) {
      return { shouldExit: false };
    }

    // Check take profit first to capture gains
    const takeProfitResult = this.checkTakeProfit(currentPrice);
    if (takeProfitResult.shouldExit) {
      this.emit('takeProfitTriggered', {
        tier: this.getTakeProfitTier(currentPrice),
        portion: takeProfitResult.portion
      });
      return { ...takeProfitResult, reason: `takeProfit_tier${this.getTakeProfitTier(currentPrice)}` };
    }

    // Other exit conditions exit the entire remaining position
    if (this.checkStopLoss(currentPrice)) {
      const portion = this.remainingPosition;
      this.remainingPosition = 0;
      this.emit('stopLossTriggered', { portion });
      return { shouldExit: true, reason: 'STOP_LOSS', portion };
    }

    if (this.checkTrailingStop(currentPrice)) {
      const portion = this.remainingPosition;
      this.remainingPosition = 0;
      this.emit('trailingStopTriggered', { portion });
      return { shouldExit: true, reason: 'TRAILING_STOP', portion };
    }

    if (this.checkVolumeBasedExit(currentVolume)) {
      const portion = this.remainingPosition;
      this.remainingPosition = 0;
      this.emit('volumeExitTriggered', { portion });
      return { shouldExit: true, reason: 'VOLUME_DROP', portion };
    }

    if (this.checkTimeBasedExit(currentPrice)) {
      const portion = this.remainingPosition;
      this.remainingPosition = 0;
      this.emit('timeExitTriggered', { portion });
      return { shouldExit: true, reason: 'TIME_LIMIT', portion };
    }

    return { shouldExit: false };
  }

  checkStopLoss(currentPrice) {
    if (!this.config.EXIT_STRATEGIES.STOP_LOSS.ENABLED) return false;
    
    const pnlPercentage = this.position.getPnLPercentage();
    const pnlUSD = this.position.getPnLUSD();
    
    // Check both USD and percentage thresholds
    if (this.config.EXIT_STRATEGIES.USD_BASED_THRESHOLDS && 
        this.config.EXIT_STRATEGIES.STOP_LOSS.USD_THRESHOLD && 
        pnlUSD <= this.config.EXIT_STRATEGIES.STOP_LOSS.USD_THRESHOLD) {
      return true;
    }
    
    return pnlPercentage <= this.config.EXIT_STRATEGIES.STOP_LOSS.THRESHOLD;
  }

  checkTrailingStop(currentPrice) {
    const trailingConfig = this.config.EXIT_STRATEGIES.TRAILING_STOP;
    if (!trailingConfig.ENABLED) return false;

    const percentageChange = this.position.calculatePnLPercent(currentPrice);
    
    // Initialize trailing stop when profit threshold is reached
    if (percentageChange >= trailingConfig.ACTIVATION_THRESHOLD && !this.trailingStopPrice) {
      const trailPercentage = this.getAdjustedTrailPercentage(trailingConfig);
      this.trailingStopPrice = this.roundToDecimals(currentPrice * (1 - (trailPercentage / 100)));
      this.emit('trailingStopInitialized', { price: this.trailingStopPrice });
      return false;
    }

    // Update trailing stop on new highs
    if (this.trailingStopPrice && currentPrice > this.trailingStopPrice) {
      const trailPercentage = this.getAdjustedTrailPercentage(trailingConfig);
      this.trailingStopPrice = this.roundToDecimals(currentPrice * (1 - (trailPercentage / 100)));
      this.emit('trailingStopUpdated', { price: this.trailingStopPrice });
    }

    // Check if price has fallen below trailing stop
    return this.trailingStopPrice && currentPrice <= this.trailingStopPrice;
  }

  getAdjustedTrailPercentage(trailingConfig) {
    let trailPercentage = trailingConfig.BASE_PERCENTAGE;
    
    if (trailingConfig.DYNAMIC_ADJUSTMENT.ENABLED) {
      const volatility = this.token.getVolatility();
      const volume = this.token.getVolumeProfile();
      const correlation = this.token.getMarketCorrelation();
      
      // Adjust based on volatility
      trailPercentage *= (1 + volatility * trailingConfig.DYNAMIC_ADJUSTMENT.VOLATILITY_MULTIPLIER);
      
      // Adjust based on volume
      if (volume.trend === 'decreasing') {
        trailPercentage *= (1 + trailingConfig.DYNAMIC_ADJUSTMENT.VOLUME_MULTIPLIER);
      }
      
      // Adjust based on market correlation
      if (correlation > trailingConfig.DYNAMIC_ADJUSTMENT.CORRELATION_THRESHOLD) {
        trailPercentage *= (1 + trailingConfig.DYNAMIC_ADJUSTMENT.CORRELATION_MULTIPLIER);
      }
      
      // Clamp to min/max
      trailPercentage = Math.min(
        Math.max(
          trailPercentage,
          trailingConfig.DYNAMIC_ADJUSTMENT.MIN_PERCENTAGE
        ),
        trailingConfig.DYNAMIC_ADJUSTMENT.MAX_PERCENTAGE
      );
    }
    
    return trailPercentage;
  }

  checkVolumeBasedExit(currentVolume) {
    const volumeConfig = this.config.EXIT_STRATEGIES.VOLUME_BASED;
    if (!volumeConfig.ENABLED) return false;

    const volumeProfile = this.token.getVolumeProfile();
    
    if (volumeProfile.trend === 'decreasing' && 
        volumeProfile.dropPercentage >= volumeConfig.VOLUME_DROP_THRESHOLD) {
      return true;
    }

    return false;
  }

  checkTimeBasedExit(currentPrice) {
    const timeConfig = this.config.EXIT_STRATEGIES.TIME_BASED;
    if (!timeConfig.ENABLED) return false;

    const currentTime = Date.now() / 1000;
    const elapsedSeconds = currentTime - this.entryTime;
    let maxHoldTime = timeConfig.MAX_HOLD_TIME;

    // Check if we should extend the time limit
    if (!this.timeExtended && this.position.getPnLPercentage() >= timeConfig.EXTENSION_THRESHOLD) {
      this.timeExtended = true;
      maxHoldTime += timeConfig.EXTENSION_TIME;
    }

    // Only apply market condition adjustments if not in extension
    if (!this.timeExtended) {
      const marketConditions = this.token.getMarketConditions();
      if (marketConditions.trend === 'bullish' && this.position.getPnLPercentage() > 0) {
        maxHoldTime *= timeConfig.BULL_MARKET_MULTIPLIER;
      } else if (marketConditions.trend === 'bearish') {
        maxHoldTime *= timeConfig.BEAR_MARKET_MULTIPLIER;
      }
    }

    return elapsedSeconds >= maxHoldTime;
  }

  checkTakeProfit(currentPrice) {
    const takeProfitConfig = this.config.EXIT_STRATEGIES.TAKE_PROFIT;
    if (!takeProfitConfig.ENABLED || this.remainingPosition === 0) {
      return { shouldExit: false, portion: 0 };
    }

    const pnlPercentage = this.position.getPnLPercentage();
    const marketConditions = this.token.getMarketConditions();
    
    // Sort tiers by threshold in ascending order to trigger lower thresholds first
    const sortedTiers = [...takeProfitConfig.TIERS]
      .sort((a, b) => a.THRESHOLD - b.THRESHOLD);

    for (const tier of sortedTiers) {
      const adjustedThreshold = this.adjustTakeProfitThreshold(tier.THRESHOLD, marketConditions);
      if (pnlPercentage >= adjustedThreshold && !this.triggeredTiers.has(adjustedThreshold)) {
        this.triggeredTiers.add(adjustedThreshold);
        const portion = Math.min(tier.PORTION, this.remainingPosition);
        this.remainingPosition = Math.max(0, this.roundToDecimals(this.remainingPosition - portion));
        return { shouldExit: true, portion: this.roundToDecimals(portion) };
      }
    }

    return { shouldExit: false, portion: 0 };
  }

  adjustTakeProfitThreshold(threshold, marketConditions) {
    const config = this.config.EXIT_STRATEGIES.TAKE_PROFIT;
    
    if (!config.DYNAMIC_ADJUSTMENT) {
      return threshold;
    }

    let adjustedThreshold = threshold;

    // Adjust based on market trend
    if (marketConditions.trend === 'bullish') {
      adjustedThreshold *= (1 + config.DYNAMIC_ADJUSTMENT.BULL_MARKET_MULTIPLIER);
    } else if (marketConditions.trend === 'bearish') {
      adjustedThreshold *= (1 - config.DYNAMIC_ADJUSTMENT.BEAR_MARKET_MULTIPLIER);
    }

    // Adjust based on volatility
    const volatility = this.token.getVolatility();
    if (volatility > config.DYNAMIC_ADJUSTMENT.VOLATILITY_THRESHOLD) {
      adjustedThreshold *= (1 + config.DYNAMIC_ADJUSTMENT.VOLATILITY_MULTIPLIER);
    }

    return adjustedThreshold;
  }

  getTakeProfitTier(currentPrice) {
    const percentageGain = this.position.calculatePnLPercent(currentPrice);
    const tiers = this.config.EXIT_STRATEGIES.TAKE_PROFIT.TIERS;
    for (let i = tiers.length - 1; i >= 0; i--) {
      if (percentageGain >= tiers[i].THRESHOLD) {
        return i + 1;
      }
    }
    return 0;
  }

  calculateVolatility() {
    return this.position?.token?.getVolatility() || 0.5;
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
    this.position?.emit('exitStrategiesReset');
  }
}

module.exports = ExitStrategies;
