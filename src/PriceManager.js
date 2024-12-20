const axios = require('axios');
const EventEmitter = require('events');

class PriceManager extends EventEmitter {
  constructor(config, logger) {
    super();
    this.config = config;
    this.logger = logger;
    this.solPriceUSD = config.SOL_USD_PRICE; // Use fallback price from config
    this.priceHistory = new Map(); // mint -> array of prices
  }

  async initialize() {
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      this.solPriceUSD = response.data.solana.usd;
      this.logger.info(`Initialized SOL price: $${this.solPriceUSD}`);
      return this.solPriceUSD;
    } catch (error) {
      this.logger.error('Failed to fetch SOL price:', error.message);
      // Use fallback price from config
      this.logger.info(`Using fallback SOL price: $${this.solPriceUSD}`);
      return this.solPriceUSD;
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
}

module.exports = PriceManager;
