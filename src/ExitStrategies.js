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

    // Listen to token events
    this.token.on('volumeUpdate', this.handleVolumeUpdate.bind(this));
    this.token.on('priceUpdate', this.handlePriceUpdate.bind(this));

    // Listen to price manager events
    if (this.priceManager) {
      this.priceManager.on('priceUpdate', this.handleSolPriceUpdate.bind(this));
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
      this.emit('exit', { 
        reason: result.reason, 
        portion: result.portion,
        price: priceData.price,
        volume: this.token.volume
      });
    }
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
    
    if (this.config.EXIT_STRATEGIES.USD_BASED_THRESHOLDS) {
      const currentValueUSD = this.position.getCurrentValueUSD();
      const entryValueUSD = this.position.getEntryValueUSD();
      const usdLoss = currentValueUSD - entryValueUSD;
      return usdLoss <= this.config.EXIT_STRATEGIES.STOP_LOSS.USD_THRESHOLD;
    }
    
    const percentageChange = this.position.calculatePnLPercent(currentPrice);
    return percentageChange <= this.config.EXIT_STRATEGIES.STOP_LOSS.THRESHOLD;
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
    
    // Use token's market conditions to adjust time limit
    const marketConditions = this.token.getMarketConditions();
    let maxHoldTime = timeConfig.MAX_HOLD_TIME;

    if (marketConditions.trend === 'bullish' && this.position.getPnLPercentage() > 0) {
      maxHoldTime *= timeConfig.BULL_MARKET_MULTIPLIER || 1.5;
    } else if (marketConditions.trend === 'bearish') {
      maxHoldTime *= timeConfig.BEAR_MARKET_MULTIPLIER || 0.7;
    }

    // Check if we should extend the time limit
    if (!this.timeExtended && this.position.getPnLPercentage() >= timeConfig.EXTENSION_THRESHOLD) {
      this.timeExtended = true;
      maxHoldTime += timeConfig.EXTENSION_TIME;
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
    
    // Adjust take profit thresholds based on market conditions
    const sortedTiers = [...takeProfitConfig.TIERS]
      .map(tier => ({
        ...tier,
        THRESHOLD: this.adjustTakeProfitThreshold(tier.THRESHOLD, marketConditions)
      }))
      .sort((a, b) => b.THRESHOLD - a.THRESHOLD);

    for (const tier of sortedTiers) {
      if (pnlPercentage >= tier.THRESHOLD && !this.triggeredTiers.has(tier.THRESHOLD)) {
        this.triggeredTiers.add(tier.THRESHOLD);
        const portion = Math.min(tier.PORTION, this.remainingPosition);
        this.remainingPosition = this.roundToDecimals(this.remainingPosition - portion);
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
