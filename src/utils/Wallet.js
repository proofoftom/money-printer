// Wallet class to track balance and trading statistics

class Wallet {
  constructor(initialBalance = 1) {
    this.balance = initialBalance;
    this.totalPnL = 0;
    console.log(`Wallet initialized with balance: ${this.balance.toFixed(4)} SOL`);
  }

  updateBalance(amount) {
    this.balance += amount;
    console.log(
      `Balance updated by ${amount.toFixed(4)} SOL, new balance: ${this.balance.toFixed(4)} SOL`
    );
  }

  getBalance() {
    return this.balance;
  }

  recordTrade(profitLoss) {
    this.totalPnL += profitLoss;
    console.log(`Trade recorded with PnL: ${profitLoss.toFixed(4)}`);
  }

  getStatistics() {
    return {
      balance: this.balance,
      totalPnL: this.totalPnL,
    };
  }
}

module.exports = Wallet;
