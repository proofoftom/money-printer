const config = require('../../utils/config');

class TransactionSimulator {
  constructor() {
    this.config = config.TESTING.SIMULATION_MODE;
  }

  async simulateTransactionDelay() {
    if (!this.config.ENABLED) return 0;

    const { MIN_MS, MAX_MS, CONGESTION_MULTIPLIER } = this.config.NETWORK_DELAY;
    const baseDelay = Math.random() * (MAX_MS - MIN_MS) + MIN_MS;
    const congestionFactor = Math.random() * CONGESTION_MULTIPLIER;
    
    const totalDelay = baseDelay * congestionFactor;
    await new Promise(resolve => setTimeout(resolve, totalDelay));
    return totalDelay;
  }

  calculatePriceImpact(size, marketCap, currentSlippage = 0) {
    if (!this.config.ENABLED || !this.config.PRICE_IMPACT.ENABLED) {
      return 0;
    }

    const { SLIPPAGE_BASE, VOLUME_MULTIPLIER } = this.config.PRICE_IMPACT;
    const volumeBasedSlippage = (size / marketCap) * VOLUME_MULTIPLIER * 100;
    const totalSlippage = SLIPPAGE_BASE + volumeBasedSlippage + currentSlippage;
    
    return Math.min(totalSlippage, 100); // Cap at 100% slippage
  }

  simulateBlockConfirmation() {
    if (!this.config.ENABLED) return Promise.resolve();

    const confirmationTime = this.config.AVG_BLOCK_TIME * 1000 * (0.8 + Math.random() * 0.4);
    return new Promise(resolve => setTimeout(resolve, confirmationTime));
  }

  async simulateTransaction(options) {
    if (!this.config.ENABLED) {
      return {
        success: true,
        delay: 0,
        priceImpact: 0,
        blockTime: 0
      };
    }

    try {
      // Step 1: Network delay
      const networkDelay = await this.simulateTransactionDelay();

      // Step 2: Price impact
      const priceImpact = this.calculatePriceImpact(
        options.size,
        options.marketCap,
        options.currentSlippage
      );

      // Step 3: Block confirmation
      const startBlock = Date.now();
      await this.simulateBlockConfirmation();
      const blockTime = Date.now() - startBlock;

      return {
        success: true,
        delay: networkDelay,
        priceImpact,
        blockTime
      };
    } catch (error) {
      console.error('Transaction simulation failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = TransactionSimulator;
