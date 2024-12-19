class TransactionSimulator {
  constructor() {
    this.slippageBase = 0.005; // 0.5% base slippage
    this.volumeMultiplier = 2; // Impact multiplier for volume ratio
  }

  /**
   * Calculates the expected execution price including slippage
   * @param {number} size - Trade size in SOL
   * @param {number} currentPrice - Current token price
   * @param {number} poolSize - Current pool size in SOL
   * @param {boolean} isBuy - True for buy, false for sell
   * @returns {number} Expected execution price after slippage
   */
  calculateExecutionPrice(size, currentPrice, poolSize, isBuy) {
    // Base slippage is fixed
    const baseImpact = this.slippageBase;
    
    // Volume impact is proportional to trade size vs pool size
    const volumeRatio = size / poolSize;
    const volumeImpact = volumeRatio * this.volumeMultiplier;
    
    // Total price impact
    const totalImpact = baseImpact + volumeImpact;
    
    // For buys, price increases; for sells, price decreases
    const direction = isBuy ? 1 : -1;
    const impactMultiplier = 1 + (direction * totalImpact);
    
    return currentPrice * impactMultiplier;
  }

  /**
   * Simulates a trade execution
   * @param {Object} params Trade parameters
   * @returns {Object} Simulated trade result
   */
  simulateTrade(params) {
    const {
      size,
      currentPrice,
      poolSize,
      isBuy
    } = params;

    const executionPrice = this.calculateExecutionPrice(
      size,
      currentPrice,
      poolSize,
      isBuy
    );

    const slippagePercent = ((executionPrice - currentPrice) / currentPrice) * 100;

    return {
      executionPrice,
      slippagePercent,
      expectedCost: size * executionPrice,
      priceImpact: Math.abs(slippagePercent)
    };
  }
}

module.exports = TransactionSimulator;
