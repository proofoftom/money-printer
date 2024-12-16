const config = require('./config');

class TransactionSimulator {
  constructor() {
    this.config = config.TRANSACTION.SIMULATION_MODE;
    this.lastTransactionTime = 0;
  }

  /**
   * Simulates transaction execution time including network delay and block confirmation
   * @param {Position} position - Optional position object for transaction context
   * @returns {Promise<number>} Total delay in milliseconds
   */
  async simulateTransactionDelay(position = null) {
    if (!this.config.ENABLED) return 0;

    const networkDelay = this.calculateNetworkDelay();
    const blockConfirmationDelay = this.config.AVG_BLOCK_TIME * 1000; // Convert to ms

    // Add extra delay if transactions are too close together
    const minTimeBetweenTx = this.config.MIN_TIME_BETWEEN_TX || 500; // Default 500ms
    const timeSinceLastTx = Date.now() - this.lastTransactionTime;
    const cooldownDelay = Math.max(0, minTimeBetweenTx - timeSinceLastTx);

    const totalDelay = networkDelay + blockConfirmationDelay + cooldownDelay;
    
    // Emit event if position is provided
    if (position) {
      position.emit('transactionDelay', { 
        networkDelay, 
        blockConfirmationDelay, 
        cooldownDelay,
        totalDelay 
      });
    }

    await new Promise(resolve => setTimeout(resolve, totalDelay));
    this.lastTransactionTime = Date.now();
    
    return totalDelay;
  }

  /**
   * Calculates the expected price impact of a transaction
   * @param {Position} position - Position object for the trade
   * @param {number} tradeSizeSOL - Trade size in SOL
   * @param {number} currentPrice - Current token price
   * @param {number} volumeSOL - Current 24h volume in SOL
   * @returns {Object} Expected execution details including price and impact
   */
  calculatePriceImpact(position, tradeSizeSOL, currentPrice, volumeSOL) {
    if (!this.config.ENABLED || !this.config.PRICE_IMPACT.ENABLED) {
      return { 
        executionPrice: currentPrice,
        priceImpact: 0,
        volumeImpact: 0,
        baseSlippage: 0
      };
    }

    // Base slippage is a fixed percentage
    const baseSlippage = this.config.PRICE_IMPACT.SLIPPAGE_BASE / 100;
    
    // Volume impact is proportional to the trade size relative to volume
    // If no volume data, use trade size as reference
    const volumeRatio = volumeSOL > 0 ? tradeSizeSOL / volumeSOL : 1;
    const volumeImpact = volumeRatio * (this.config.PRICE_IMPACT.VOLUME_MULTIPLIER / 100);
    
    // Consider token volatility if available
    const volatilityMultiplier = position?.token?.getVolatility() || 1;
    const totalSlippage = (baseSlippage + volumeImpact) * volatilityMultiplier;

    // For buys, price increases; for sells, price decreases
    const executionPrice = currentPrice * (1 + totalSlippage);

    // Emit price impact event if position is provided
    if (position) {
      position.emit('priceImpact', {
        tradeSizeSOL,
        currentPrice,
        executionPrice,
        baseSlippage,
        volumeImpact,
        volatilityMultiplier,
        totalSlippage
      });
    }

    return {
      executionPrice,
      priceImpact: totalSlippage,
      volumeImpact,
      baseSlippage,
      volatilityMultiplier
    };
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
    const delay = isCongested ? baseDelay * CONGESTION_MULTIPLIER : baseDelay;

    return Math.floor(delay); // Return whole number of milliseconds
  }
}

module.exports = TransactionSimulator;
