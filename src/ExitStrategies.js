class ExitStrategies {
  constructor() {
    this.trailingStopPrice = null;
  }

  checkExitSignals(position) {
    const token = position.token;
    const currentPrice = token.getCurrentPrice();
    const entryPrice = position.entryPrice;

    // Calculate price change percentage
    const priceChangePercent = ((currentPrice - entryPrice) / entryPrice) * 100;

    // 1. Stop Loss: Exit if price drops 10% below entry
    if (priceChangePercent <= -10) {
      return {
        reason: 'STOP_LOSS',
        portion: 1.0
      };
    }

    // 2. Take Profit: Exit if price rises 50% above entry
    if (priceChangePercent >= 50) {
      return {
        reason: 'TAKE_PROFIT',
        portion: 1.0
      };
    }

    // 3. Trailing Stop: Update and check trailing stop
    // Update trailing stop if we have a new high price
    if (currentPrice > (this.trailingStopPrice || 0)) {
      this.trailingStopPrice = currentPrice;
    }

    // Exit if price drops 20% from the highest point
    if (this.trailingStopPrice && currentPrice <= this.trailingStopPrice * 0.8) {
      return {
        reason: 'TRAILING_STOP',
        portion: 1.0
      };
    }

    // No exit signal
    return null;
  }
}

module.exports = ExitStrategies;
