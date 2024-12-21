const axios = require('axios');
const EventEmitter = require('events');

class PriceManager extends EventEmitter {
  constructor(config, logger) {
    super();
    this.config = config;
    this.logger = logger;
    this.solPriceUSD = config.SOL_USD_PRICE; // Use fallback price from config
    this.priceHistory = new Map(); // mint -> array of prices
    this.updateInterval = null;
  }

  async initialize() {
    try {
      // Get initial SOL price
      await this.fetchSolPrice();
      
      // Update SOL price every minute
      this.updateInterval = setInterval(async () => {
        await this.fetchSolPrice();
      }, 60000); // 60 seconds

      return this.solPriceUSD;
    } catch (error) {
      this.logger.error('Failed to initialize price manager:', error.message);
      // Use fallback price from config
      this.logger.info(`Using fallback SOL price: $${this.solPriceUSD}`);
      return this.solPriceUSD;
    }
  }

  async fetchSolPrice() {
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      const newPrice = response.data.solana.usd;
      
      // Only log if price has changed
      if (newPrice !== this.solPriceUSD) {
        this.solPriceUSD = newPrice;
        this.logger.info(`Updated SOL price: $${this.solPriceUSD}`);
        this.emit('solPriceUpdate', this.solPriceUSD);
      }
      
      return this.solPriceUSD;
    } catch (error) {
      this.logger.error('Failed to fetch SOL price:', error.message);
      return this.solPriceUSD; // Keep using current price
    }
  }

  updatePrice(mint, price, volume) {
    if (!this.priceHistory.has(mint)) {
      this.priceHistory.set(mint, []);
    }

    const history = this.priceHistory.get(mint);
    const timestamp = Date.now();

    history.push({ price, volume, timestamp });

    // Keep only the last MAX_CANDLES prices
    if (history.length > this.config.DASHBOARD.CHART.MAX_CANDLES) {
      history.shift();
    }

    this.emit('priceUpdate', {
      mint,
      price,
      volume,
      priceHistory: history
    });
  }

  getLatestPrice(mint) {
    const history = this.priceHistory.get(mint);
    if (!history || history.length === 0) return null;
    return history[history.length - 1].price;
  }

  getPriceHistory(mint) {
    return this.priceHistory.get(mint) || [];
  }

  solToUSD(solAmount) {
    return solAmount * this.solPriceUSD;
  }

  usdToSol(usdAmount) {
    return usdAmount / this.solPriceUSD;
  }

  // For simulation purposes
  updateSolPrice(newPrice) {
    this.solPriceUSD = newPrice;
  }

  stop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
}

module.exports = PriceManager;
