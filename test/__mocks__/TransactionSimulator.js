class MockTransactionSimulator {
  constructor() {
    this.config = {
      ENABLED: true,
      AVG_BLOCK_TIME: 0.4,
      PRICE_IMPACT: {
        ENABLED: true,
        SLIPPAGE_BASE: 1,
        VOLUME_MULTIPLIER: 0.5
      }
    };
  }

  async simulateTransactionDelay() {
    return 100; // Fixed delay for testing
  }

  calculatePriceImpact(tradeSizeSOL, currentPrice, volumeSOL) {
    return currentPrice * 1.01; // Fixed 1% slippage for testing
  }
}

module.exports = MockTransactionSimulator;
