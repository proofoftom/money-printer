// Wallet class to track balance and trading statistics
const { EventEmitter } = require("events");
const config = require("./config");

class Wallet extends EventEmitter {
  constructor(config) {
    super();
    const initialBalance = parseFloat((config.RISK_PER_TRADE * 10).toFixed(4));
    this.balance = initialBalance;
    this.totalPnL = 0;
    this.trades = [];
    this.stats = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      breakEvenTrades: 0,
      biggestWin: 0,
      biggestLoss: 0,
      averagePnL: 0,
      winRate: 0,
    };

    console.log(
      `Wallet initialized with balance: ${this.balance.toFixed(4)} SOL`
    );
    this.emit("balanceUpdate", this.balance);
  }

  updateBalance(amount) {
    const delta = parseFloat(amount.toFixed(4));
    this.balance = parseFloat((this.balance + delta).toFixed(4));
    console.log(
      `Balance updated by ${delta.toFixed(
        4
      )} SOL, new balance: ${this.balance.toFixed(4)} SOL`
    );
    this.emit("balanceUpdate", this.balance);
  }

  recordTrade(trade) {
    const { token, entryPrice, exitPrice, size, profitLoss, reason } = trade;

    // Update balance
    this.updateBalance(profitLoss);

    // Record trade details
    this.trades.push({
      ...trade,
      timestamp: Date.now(),
      balanceAfter: this.balance,
    });

    // Update statistics
    this.totalPnL += profitLoss;
    this.stats.totalTrades++;

    if (profitLoss > 0) {
      this.stats.winningTrades++;
      this.stats.biggestWin = Math.max(this.stats.biggestWin, profitLoss);
    } else if (profitLoss < 0) {
      this.stats.losingTrades++;
      this.stats.biggestLoss = Math.min(this.stats.biggestLoss, profitLoss);
    } else {
      this.stats.breakEvenTrades++;
    }

    this.stats.winRate =
      (this.stats.winningTrades / this.stats.totalTrades) * 100;
    this.stats.averagePnL = this.totalPnL / this.stats.totalTrades;

    // Emit trade event
    this.emit("tradeCompleted", {
      trade,
      stats: this.getStatistics(),
    });

    console.log(`Trade recorded for ${token.symbol}:
      Entry: ${entryPrice.toFixed(6)} SOL
      Exit: ${exitPrice.toFixed(6)} SOL
      Size: ${size.toFixed(4)} SOL
      PnL: ${profitLoss.toFixed(4)} SOL
      Reason: ${reason}
    `);
  }

  getBalance() {
    return this.balance;
  }

  getStatistics() {
    return {
      balance: this.balance,
      totalPnL: this.totalPnL,
      ...this.stats,
      trades: this.trades,
    };
  }
}

module.exports = Wallet;
