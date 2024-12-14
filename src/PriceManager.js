const axios = require('axios');

class PriceManager {
  constructor() {
    this.solPriceUSD = null;
  }

  async initialize() {
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      this.solPriceUSD = response.data.solana.usd;
      console.log(`Initialized SOL price: $${this.solPriceUSD}`);
      return this.solPriceUSD;
    } catch (error) {
      console.error('Failed to fetch SOL price:', error.message);
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
}

module.exports = PriceManager;
