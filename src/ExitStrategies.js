class ExitStrategies {
  constructor(position) {
    this.entryPrice = position.entryPrice;
    this.entryTime = position.timestamp;
    this.remainingPosition = 1.0; // 100% of position initially
    
    // Tiered Take Profit Configuration
    this.tiers = [
      { profitTarget: 60, portion: 0.2 },  // Final tier: 60% profit -> Take remaining 20%
      { profitTarget: 40, portion: 0.4 },  // Second tier: 40% profit -> Take 40%
      { profitTarget: 20, portion: 0.4 }   // First tier: 20% profit -> Take 40%
    ];
    
    // Track which tiers have been triggered
    this.triggeredTiers = new Set();
  }

  calculateProfitPercentage(currentPrice) {
    return ((currentPrice - this.entryPrice) / this.entryPrice) * 100;
  }

  shouldExit({ currentPrice }) {
    const profitPercentage = this.calculateProfitPercentage(currentPrice);
    
    // Check each tier from highest to lowest profit target
    for (const tier of this.tiers) {
      if (profitPercentage >= tier.profitTarget && !this.triggeredTiers.has(tier.profitTarget)) {
        this.triggeredTiers.add(tier.profitTarget);
        this.remainingPosition = Number((this.remainingPosition - tier.portion).toFixed(2));
        return {
          exit: true,
          portion: tier.portion
        };
      }
    }

    return {
      exit: false,
      portion: 0
    };
  }
}

module.exports = ExitStrategies;
