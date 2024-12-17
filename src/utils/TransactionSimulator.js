const config = require('./config');

class TransactionSimulator {
  constructor() {
    this.config = config.TESTING.SIMULATION_MODE;
  }

  /**
   * Simulates transaction execution time including network delay and block confirmation
   * @returns {Promise<number>} Total delay in milliseconds
   */
  async simulateTransactionDelay() {
    if (!this.config.ENABLED) return 0;

    const networkDelay = this.calculateNetworkDelay();
    const blockConfirmationDelay = this.config.AVG_BLOCK_TIME * 1000; // Convert to ms

    const totalDelay = networkDelay + blockConfirmationDelay;
    await new Promise(resolve => setTimeout(resolve, totalDelay));
    
    return totalDelay;
  }

  /**
   * Calculates the expected price impact of a transaction
   * @param {number} tradeSizeSOL - Trade size in SOL
   * @param {number} currentPrice - Current token price
   * @param {number} volumeSOL - Current 24h volume in SOL
   * @returns {number} Expected execution price after slippage
   */
  calculatePriceImpact(tradeSizeSOL, currentPrice, volumeSOL) {
    if (!this.config.ENABLED || !this.config.PRICE_IMPACT.ENABLED) {
      return currentPrice;
    }

    // Base slippage is a fixed percentage
    const baseSlippage = this.config.PRICE_IMPACT.SLIPPAGE_BASE / 100;
    
    // Volume impact is proportional to the trade size relative to volume
    // If no volume data, use trade size as reference
    const volumeRatio = volumeSOL > 0 ? tradeSizeSOL / volumeSOL : 1;
    const volumeImpact = volumeRatio * (this.config.PRICE_IMPACT.VOLUME_MULTIPLIER / 100);
    
    const totalSlippage = baseSlippage + volumeImpact;

    // For buys, price increases; for sells, price decreases
    return currentPrice * (1 + totalSlippage);
  }

  /**
   * Calculates network delay based on configuration and simulated network conditions
   * @returns {number} Network delay in milliseconds
   * @private
   */
  calculateNetworkDelay() {
    const { MIN_MS, MAX_MS, CONGESTION_MULTIPLIER } = this.config.NETWORK_DELAY;
    const baseDelay = Math.random() * (MAX_MS - MIN_MS) + MIN_MS;
    
    // Simulate network congestion (30% chance of congestion)
    const isCongested = Math.random() < 0.3;
    return isCongested ? baseDelay * CONGESTION_MULTIPLIER : baseDelay;
  }
}

module.exports = TransactionSimulator;
