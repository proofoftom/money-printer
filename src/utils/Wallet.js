// Wallet class to track balance and trading statistics
const EventEmitter = require('events');

class Wallet extends EventEmitter {
  constructor(initialBalance = 1) {
    super();
    this.balance = initialBalance;
    this.totalPnL = 0;
    console.log(`Wallet initialized with balance: ${this.balance.toFixed(4)} SOL`);
  }

  updateBalance(amount) {
    const oldBalance = this.balance;
    this.balance += amount;
    console.log(
      `Balance updated by ${amount.toFixed(4)} SOL, new balance: ${this.balance.toFixed(4)} SOL`
    );
    this.emit('balanceUpdate', {
      oldBalance,
      newBalance: this.balance,
      change: amount
    });
  }

  getBalance() {
    return this.balance;
  }

  recordTrade(profitLoss) {
    this.totalPnL += profitLoss;
    console.log(`Trade recorded with PnL: ${profitLoss.toFixed(4)}`);
    this.emit('trade', {
      profitLoss,
      totalPnL: this.totalPnL,
      balance: this.balance
    });
  }

  getStatistics() {
    return {
      balance: this.balance,
      totalPnL: this.totalPnL,
    };
  }
}

module.exports = Wallet;
