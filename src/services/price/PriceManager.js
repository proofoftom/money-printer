const axios = require('axios');
const EventEmitter = require('events');
const config = require('../../utils/config');

class PriceManager extends EventEmitter {
  constructor() {
    super();
    this.solPriceUSD = null;
    this.lastUpdate = null;
    this.updateInterval = null;
    this.setMaxListeners(20);
  }

  async initialize() {
    try {
      await this.updatePrice();
      
      // Set up periodic price updates
      this.updateInterval = setInterval(
        () => this.updatePrice(),
        config.PRICE.UPDATE_INTERVAL || 60000 // Default 1 minute
      );
      
      return this.solPriceUSD;
    } catch (error) {
      console.error('Failed to initialize price manager:', error.message);
      throw error;
    }
  }

  async updatePrice() {
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      const newPrice = response.data.solana.usd;
      
      // Only emit update if price changed
      if (newPrice !== this.solPriceUSD) {
        const oldPrice = this.solPriceUSD;
        this.solPriceUSD = newPrice;
        this.lastUpdate = Date.now();
        
        this.emit('priceUpdate', {
          oldPrice,
          newPrice,
          timestamp: this.lastUpdate,
          percentChange: oldPrice ? ((newPrice - oldPrice) / oldPrice) * 100 : 0
        });
      }
      
      return this.solPriceUSD;
    } catch (error) {
      console.error('Failed to fetch SOL price:', error.message);
      this.emit('priceError', error);
      throw error;
    }
  }

  solToUSD(solAmount) {
    if (!this.solPriceUSD) {
      throw new Error('PriceManager not initialized');
    }
    return solAmount * this.solPriceUSD;
  }

  usdToSOL(usdAmount) {
    if (!this.solPriceUSD) {
      throw new Error('PriceManager not initialized');
    }
    return usdAmount / this.solPriceUSD;
  }

  cleanup() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    this.removeAllListeners();
  }
}

module.exports = PriceManager;
