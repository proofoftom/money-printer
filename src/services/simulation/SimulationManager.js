const config = require('../../utils/config');
const TransactionSimulator = require('./TransactionSimulator');

class SimulationManager {
  constructor() {
    this.config = config.TESTING.SIMULATION_MODE;
    this.transactionSimulator = new TransactionSimulator();
    this.isEnabled = this.config.ENABLED;
  }

  async simulateMarketBuy(token, size) {
    if (!this.isEnabled) {
      return {
        success: true,
        executionPrice: token.currentPrice,
        priceImpact: 0
      };
    }

    const simulation = await this.transactionSimulator.simulateTransaction({
      size,
      marketCap: token.marketCap,
      currentSlippage: token.currentSlippage
    });

    if (!simulation.success) {
      throw new Error(`Market buy simulation failed: ${simulation.error}`);
    }

    const executionPrice = token.currentPrice * (1 + simulation.priceImpact / 100);
    
    return {
      success: true,
      executionPrice,
      priceImpact: simulation.priceImpact,
      delay: simulation.delay,
      blockTime: simulation.blockTime
    };
  }

  async simulateMarketSell(token, size) {
    if (!this.isEnabled) {
      return {
        success: true,
        executionPrice: token.currentPrice,
        priceImpact: 0
      };
    }

    const simulation = await this.transactionSimulator.simulateTransaction({
      size,
      marketCap: token.marketCap,
      currentSlippage: token.currentSlippage
    });

    if (!simulation.success) {
      throw new Error(`Market sell simulation failed: ${simulation.error}`);
    }

    const executionPrice = token.currentPrice * (1 - simulation.priceImpact / 100);
    
    return {
      success: true,
      executionPrice,
      priceImpact: simulation.priceImpact,
      delay: simulation.delay,
      blockTime: simulation.blockTime
    };
  }

  // Simulate network conditions
  async simulateNetworkConditions() {
    if (!this.isEnabled) return;

    await this.transactionSimulator.simulateTransactionDelay();
  }

  // Simulate market conditions
  simulateMarketConditions(token) {
    if (!this.isEnabled) return token;

    // Add random noise to price
    const noise = (Math.random() - 0.5) * 0.01; // ±0.5% noise
    token.currentPrice *= (1 + noise);

    // Add random noise to volume
    const volumeNoise = (Math.random() - 0.5) * 0.02; // ±1% noise
    token.volumeSOL *= (1 + volumeNoise);

    return token;
  }

  // Get simulation status
  getStatus() {
    return {
      enabled: this.isEnabled,
      config: this.config,
      networkConditions: {
        avgDelay: this.config.NETWORK_DELAY.MIN_MS,
        maxDelay: this.config.NETWORK_DELAY.MAX_MS,
        congestion: this.config.NETWORK_DELAY.CONGESTION_MULTIPLIER
      },
      marketConditions: {
        avgBlockTime: this.config.AVG_BLOCK_TIME,
        priceImpact: this.config.PRICE_IMPACT
      }
    };
  }
}

module.exports = SimulationManager;
