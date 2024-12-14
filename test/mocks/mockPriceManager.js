class MockPriceManager {
  constructor(solPrice = 100) {
    this.solPriceUSD = solPrice;
  }

  async initialize() {
    return this.solPriceUSD;
  }

  solToUSD(solAmount) {
    return solAmount * this.solPriceUSD;
  }

  usdToSOL(usdAmount) {
    return usdAmount / this.solPriceUSD;
  }
}

module.exports = MockPriceManager;
