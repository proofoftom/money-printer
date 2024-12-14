class ExitStrategies {
  constructor(config) {
    this.config = config;
    this.validateConfig();
  }

  validateConfig() {
    const { trailingStopLoss, trailingTakeProfit, tieredTakeProfit } = this.config;
    
    if (!trailingStopLoss || !trailingTakeProfit || !tieredTakeProfit) {
      throw new Error('Invalid configuration: Missing required strategy settings');
    }
  }

  shouldStopLoss(position) {
    if (!this.config.trailingStopLoss.enabled) return false;
    
    const { highestPrice, currentPrice } = position;
    const drawdown = ((highestPrice - currentPrice) / highestPrice) * 100;
    
    return drawdown >= this.config.trailingStopLoss.percentage;
  }

  shouldTakeProfit(position) {
    if (!this.config.trailingTakeProfit.enabled) return false;
    
    const { entryPrice, highestPrice, currentPrice } = position;
    const currentProfit = ((currentPrice - entryPrice) / entryPrice) * 100;
    
    // Only start trailing after initial trigger is hit
    if (currentProfit < this.config.trailingTakeProfit.initialTrigger) {
      return false;
    }
    
    // Check if price has fallen below trailing threshold
    const trailDistance = ((highestPrice - currentPrice) / highestPrice) * 100;
    return trailDistance >= this.config.trailingTakeProfit.trailPercentage;
  }

  calculateTierExit(position) {
    if (!this.config.tieredTakeProfit.enabled) return null;
    
    const { entryPrice, currentPrice, remainingSize } = position;
    const currentProfit = ((currentPrice - entryPrice) / entryPrice) * 100;
    
    // Find the highest triggered tier that hasn't been executed
    const triggeredTier = this.config.tieredTakeProfit.tiers
      .filter(tier => currentProfit >= tier.percentage)
      .reverse()
      .find(tier => {
        const expectedRemainingSize = this.calculateExpectedRemainingSize(tier);
        return remainingSize > expectedRemainingSize;
      });
    
    return triggeredTier ? triggeredTier.portion : null;
  }

  calculateExpectedRemainingSize(targetTier) {
    // Calculate how much of the position should be remaining after executing all tiers up to this one
    const executedPortions = this.config.tieredTakeProfit.tiers
      .filter(tier => tier.percentage <= targetTier.percentage)
      .reduce((total, tier) => total + tier.portion, 0);
    
    return 1 - executedPortions;
  }
}

module.exports = ExitStrategies;
