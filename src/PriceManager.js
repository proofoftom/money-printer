const axios = require('axios');
const EventEmitter = require('events');

class PriceManager extends EventEmitter {
  constructor() {
    super();
    this.solPriceUSD = null;
    this.lastUpdate = null;
    this.updateInterval = 60000; // 1 minute
  }

  async initialize() {
    try {
      await this.updatePrice();
      this.startPriceUpdates();
      return this.solPriceUSD;
    } catch (error) {
      console.error('Failed to initialize PriceManager:', error.message);
      throw error;
    }
  }

  async updatePrice() {
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      const newPrice = response.data.solana.usd;
      
      if (this.solPriceUSD !== newPrice) {
        const oldPrice = this.solPriceUSD;
        this.solPriceUSD = newPrice;
        this.lastUpdate = Date.now();
        
        this.emit('priceUpdate', {
          oldPrice,
          newPrice: this.solPriceUSD,
          timestamp: this.lastUpdate
        });
      }
      
      return this.solPriceUSD;
    } catch (error) {
      console.error('Failed to fetch SOL price:', error.message);
      throw error;
    }
  }

  startPriceUpdates() {
    setInterval(() => {
      this.updatePrice().catch(error => {
        console.error('Price update failed:', error.message);
      });
    }, this.updateInterval);
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

  getPositionValueUSD(position) {
    return this.solToUSD(position.currentPrice * position.remainingSize);
  }

  getPositionPnLUSD(position) {
    const currentValue = this.getPositionValueUSD(position);
    const entryValue = this.solToUSD(position.entryPrice * position.size);
    return currentValue - entryValue;
  }

  getPositionPnLPercentage(position) {
    const entryValue = this.solToUSD(position.entryPrice * position.size);
    if (entryValue === 0) return 0;
    return (this.getPositionPnLUSD(position) / entryValue) * 100;
  }

  getLastUpdate() {
    return this.lastUpdate;
  }

  getPriceUSD() {
    return this.solPriceUSD;
  }
}

module.exports = PriceManager;
