class ExitStrategies {
  constructor(config, logger) {
    this.logger = logger;
    this.config = config;
  }

  checkExitSignals(position) {
    if (position.state !== "OPEN") {
      return { shouldExit: false };
    }

    const currentPrice = position.currentPrice;
    const entryPrice = position.entryPrice;
    const priceChangePercent = ((currentPrice - entryPrice) / entryPrice) * 100;

    // Use the same config values as Position
    if (priceChangePercent <= -this.config.STOP_LOSS_PERCENT) {
      this.logger.info(
        `Stop loss triggered for ${
          position.mint
        } at ${currentPrice} (${priceChangePercent.toFixed(2)}%)`
      );
      return { shouldExit: true, reason: "STOP_LOSS" };
    }

    if (priceChangePercent >= this.config.TAKE_PROFIT_PERCENT) {
      this.logger.info(
        `Take profit triggered for ${
          position.mint
        } at ${currentPrice} (${priceChangePercent.toFixed(2)}%)`
      );
      return { shouldExit: true, reason: "TAKE_PROFIT" };
    }

    // Check trailing stop if enabled
    if (this.config.TRAILING_STOP_PERCENT) {
      const dropFromHigh =
        ((position.highestPrice - currentPrice) / position.highestPrice) * 100;
      if (dropFromHigh >= this.config.TRAILING_STOP_PERCENT) {
        this.logger.info(
          `Trailing stop triggered for ${
            position.mint
          } at ${currentPrice} (${dropFromHigh.toFixed(2)}% drop from high of ${
            position.highestPrice
          })`
        );
        return { shouldExit: true, reason: "TRAILING_STOP" };
      }
    }

    return { shouldExit: false };
  }
}

module.exports = ExitStrategies;
