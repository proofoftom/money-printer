// Wallet class to track balance and trading statistics

class Wallet {
  constructor(initialBalance = 1) {
    this.balance = initialBalance;
    this.wins = 0;
    this.losses = 0;
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
    if (profitLoss > 0) {
      this.wins += 1;
    } else {
      this.losses += 1;
    }
    this.totalPnL += profitLoss;
    console.log(`Trade recorded with PnL: ${profitLoss}`);
  }

  getStatistics() {
    return {
      balance: this.balance,
      wins: this.wins,
      losses: this.losses,
      totalPnL: this.totalPnL,
    };
  }
}

module.exports = Wallet;
