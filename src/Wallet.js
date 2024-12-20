// Wallet class to track balance and trading statistics
const { EventEmitter } = require("events");
const config = require("./config");

class Wallet extends EventEmitter {
  constructor(config, logger) {
    super();
    this.config = config;
    this.logger = logger;
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
    this.transactionFees = 0;

    this.logger.info(`Wallet initialized with balance: ${this.balance.toFixed(4)} SOL`);
    this.emit("balanceUpdate", this.balance);
  }

  updateBalance(amount) {
    const delta = parseFloat(amount.toFixed(4));
    this.balance = parseFloat((this.balance + delta).toFixed(4));
    this.logger.info(`Balance updated by ${delta.toFixed(4)} SOL, new balance: ${this.balance.toFixed(4)} SOL`);
    this.emit("balanceUpdate", this.balance);
  }

  getBalance() {
    return this.balance;
  }

  getTotalTransactionFees() {
    return this.transactionFees;
  }

  // Check if we have enough balance for a trade including fees
  canAffordTrade(amount, isBuy = true) {
    const requiredFee = isBuy ? 
      this.config.TRANSACTION_FEES.BUY : 
      this.config.TRANSACTION_FEES.SELL;
    
    const totalRequired = amount + requiredFee;
    return this.balance >= totalRequired;
  }

  // Handle transaction fees
  async deductTransactionFee(isBuy = true) {
    const fee = isBuy ? 
      this.config.TRANSACTION_FEES.BUY : 
      this.config.TRANSACTION_FEES.SELL;

    this.balance -= fee;
    this.transactionFees += fee;

    this.logger.info('Transaction fee deducted', {
      type: isBuy ? 'buy' : 'sell',
      fee,
      newBalance: this.balance,
      totalFees: this.transactionFees
    });

    this.emit('feeDeducted', {
      fee,
      type: isBuy ? 'buy' : 'sell',
      balance: this.balance,
      totalFees: this.transactionFees
    });

    return fee;
  }

  // Process a trade
  async processTrade(amount, isBuy = true) {
    if (!this.canAffordTrade(amount, isBuy)) {
      this.logger.warn('Insufficient balance for trade', {
        required: amount + (isBuy ? this.config.TRANSACTION_FEES.BUY : this.config.TRANSACTION_FEES.SELL),
        available: this.balance,
        type: isBuy ? 'buy' : 'sell'
      });
      return false;
    }

    // Deduct the trade amount
    if (isBuy) {
      this.balance -= amount;
    } else {
      this.balance += amount;
    }

    // Handle the transaction fee
    await this.deductTransactionFee(isBuy);

    this.emit('tradeProcessed', {
      type: isBuy ? 'buy' : 'sell',
      amount,
      balance: this.balance,
      transactionFees: this.transactionFees
    });

    return true;
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

    this.logger.info(`Trade recorded for ${token.symbol}:
      Entry: ${entryPrice.toFixed(6)} SOL
      Exit: ${exitPrice.toFixed(6)} SOL
      Size: ${size.toFixed(4)} SOL
      PnL: ${profitLoss.toFixed(4)} SOL
      Reason: ${reason}
    `);
  }

  getStatistics() {
    return {
      balance: this.balance,
      totalPnL: this.totalPnL,
      ...this.stats,
      trades: this.trades,
      transactionFees: this.transactionFees
    };
  }
}

module.exports = Wallet;
