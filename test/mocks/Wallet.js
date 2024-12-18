class Wallet {
  constructor() {
    this.address = 'mock-wallet-address';
    this.balance = 1000;
  }

  async getBalance() {
    return this.balance;
  }
}

module.exports = Wallet;
