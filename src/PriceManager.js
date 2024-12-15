const axios = require('axios');
const EventEmitter = require('events');

class PriceManager extends EventEmitter {
  constructor() {
    super();
    this.solPrice = null;
    this.initialized = false;
    this.initializationPromise = null;
    this.lastUpdateTime = null;
    this.updateInterval = null;
  }

  async initialize() {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = new Promise(async (resolve, reject) => {
      try {
        await this.updateSolPrice();
        this.initialized = true;
        
        // Set up regular price updates
        this.updateInterval = setInterval(async () => {
          try {
            await this.updateSolPrice();
          } catch (error) {
            console.error("Error updating SOL price:", error.message);
            this.emit("error", {
              source: "PriceManager.updateInterval",
              message: error.message,
              stack: error.stack,
              type: error.constructor.name
            });
          }
        }, 60000); // default to 1 minute update interval

        resolve();
      } catch (error) {
        console.error("Error initializing PriceManager:", error.message);
        this.emit("error", {
          source: "PriceManager.initialize",
          message: error.message,
          stack: error.stack,
          type: error.constructor.name
        });
        reject(error);
      }
    });

    return this.initializationPromise;
  }

  async updateSolPrice() {
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      this.solPrice = response.data.solana.usd;
      this.lastUpdateTime = new Date();
      console.log(`Updated SOL price: $${this.solPrice}`);
    } catch (error) {
      console.error('Failed to fetch SOL price:', error.message);
      throw error;
    }
  }

  isInitialized() {
    return this.initialized;
  }

  solToUSD(solAmount) {
    if (!this.initialized || !this.solPrice) {
      throw new Error("PriceManager not initialized");
    }
    return solAmount * this.solPrice;
  }

  usdToSol(usdAmount) {
    if (!this.initialized || !this.solPrice) {
      throw new Error("PriceManager not initialized");
    }
    return usdAmount / this.solPrice;
  }
}

module.exports = PriceManager;
