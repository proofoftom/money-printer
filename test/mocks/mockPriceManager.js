const EventEmitter = require('events');

class MockPriceManager extends EventEmitter {
  constructor(solPrice = 100) {
    super();
    this.solPrice = solPrice;
    this.initialized = true;
    this.lastUpdateTime = new Date();
  }

  async initialize() {
    return Promise.resolve();
  }

  isInitialized() {
    return this.initialized;
  }

  async updateSolPrice() {
    this.lastUpdateTime = new Date();
    return this.solPrice;
  }

  solToUSD(solAmount) {
    return solAmount * this.solPrice;
  }

  usdToSol(usdAmount) {
    return usdAmount / this.solPrice;
  }
}

module.exports = MockPriceManager;
