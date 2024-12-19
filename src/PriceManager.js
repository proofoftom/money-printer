const axios = require('axios');
const config = require('./config');

class PriceManager {
  constructor() {
    this.solPriceUSD = config.SOL_USD_PRICE; // Use fallback price from config
  }

  async initialize() {
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      this.solPriceUSD = response.data.solana.usd;
      console.info(`Initialized SOL price: $${this.solPriceUSD}`);
      return this.solPriceUSD;
    } catch (error) {
      console.error('Failed to fetch SOL price:', error.message);
      throw error;
    }
  }

  solToUSD(solAmount) {
    return solAmount * this.solPriceUSD;
  }

  usdToSOL(usdAmount) {
    return usdAmount / this.solPriceUSD;
  }

  // For simulation purposes
  updateSolPrice(newPrice) {
    this.solPriceUSD = newPrice;
  }
}

module.exports = PriceManager;
