// Wallet class to track balance and trading statistics

class Wallet {
  constructor(initialBalance = 1) {
    this.balance = initialBalance;
    this.totalPnL = 0;
    console.log(`Wallet initialized with balance: ${this.balance} SOL`);
  }

  updateBalance(amount) {
    this.balance += amount;
    console.log(
      `Balance updated by ${amount} SOL, new balance: ${this.balance} SOL`
    );
  }

  recordTrade(profitLoss) {
    this.totalPnL += profitLoss;
    console.log(`Trade recorded with PnL: ${profitLoss}`);
  }

  getStatistics() {
    return {
      balance: this.balance,
      totalPnL: this.totalPnL,
    };
  }
}

module.exports = Wallet;
