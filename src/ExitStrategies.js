class ExitStrategies {
  constructor() {
    // Default values that can be overridden by position config
    this.defaultConfig = {
      stopLossPortion: 1.0,    // Full exit on stop loss by default
      takeProfitPortion: 1.0,  // Full exit on take profit by default
      trailingStopLevel: 20,   // 20% drop from highest price
      trailingStopPortion: 1.0 // Full exit on trailing stop by default
    };
  }

  checkExitSignals(position) {
    if (position.state !== 'OPEN') {
      return null;
    }

    const currentPrice = position.currentPrice;
    const entryPrice = position.entryPrice;
    const priceChangePercent = ((currentPrice - entryPrice) / entryPrice) * 100;
    
    // Get position-specific config or use defaults
    const config = {
      ...this.defaultConfig,
      ...(position.config || {})  // Handle case where position.config might be undefined
    };

    // 1. Stop Loss (e.g., -10%)
    if (priceChangePercent <= -config.stopLossLevel) {
      console.log(`Stop loss triggered for ${position.mint} at ${currentPrice} (${priceChangePercent.toFixed(2)}%)`);
      return { 
        reason: 'STOP_LOSS', 
        portion: config.stopLossPortion 
      };
    }

    // 2. Take Profit (e.g., +50%)
    if (priceChangePercent >= config.takeProfitLevel) {
      console.log(`Take profit triggered for ${position.mint} at ${currentPrice} (${priceChangePercent.toFixed(2)}%)`);
      return { 
        reason: 'TAKE_PROFIT', 
        portion: config.takeProfitPortion 
      };
    }

    // 3. Trailing Stop
    const highestPrice = position.highestPrice;
    const dropFromHighPercent = ((currentPrice - highestPrice) / highestPrice) * 100;
    
    if (dropFromHighPercent <= -config.trailingStopLevel) {
      console.log(`Trailing stop (${config.trailingStopLevel}%) triggered for ${position.mint} at ${currentPrice} (${dropFromHighPercent.toFixed(2)}% from high of ${highestPrice})`);
      return { 
        reason: 'TRAILING_STOP', 
        portion: config.trailingStopPortion 
      };
    }

    return null;
  }
}

module.exports = ExitStrategies;
