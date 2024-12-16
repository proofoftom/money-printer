// Wallet class to track balance and trading statistics
const EventEmitter = require('events');

class Wallet extends EventEmitter {
  constructor(initialBalance = 1) {
    super();
    this.balance = initialBalance;
    this.totalPnL = 0;
    this.positionStats = {
      totalPositions: 0,
      openPositions: new Set(),
      totalVolume: 0,
      avgPositionSize: 0,
      maxDrawdown: 0,
      peakBalance: initialBalance,
      lastDrawdownUpdate: Date.now()
    };
    console.log(`Wallet initialized with balance: ${this.balance.toFixed(4)} SOL`);
  }

  /**
   * Updates wallet balance and emits relevant events
   * @param {number} amount - Amount to update balance by
   * @param {Position} position - Optional position object for context
   */
  updateBalance(amount, position = null) {
    const oldBalance = this.balance;
    this.balance += amount;
    
    // Update peak balance and drawdown
    if (this.balance > this.positionStats.peakBalance) {
      this.positionStats.peakBalance = this.balance;
    } else {
      const currentDrawdown = ((this.positionStats.peakBalance - this.balance) / this.positionStats.peakBalance) * 100;
      if (currentDrawdown > this.positionStats.maxDrawdown) {
        this.positionStats.maxDrawdown = currentDrawdown;
        this.positionStats.lastDrawdownUpdate = Date.now();
      }
    }

    // Emit balance update event
    this.emit('balanceUpdate', {
      oldBalance,
      newBalance: this.balance,
      change: amount,
      position: position?.id || null,
      timestamp: Date.now()
    });

    console.log(
      `Balance updated by ${amount.toFixed(4)} SOL, new balance: ${this.balance.toFixed(4)} SOL`
    );
  }

  /**
   * Records a trade and updates position statistics
   * @param {number} profitLoss - PnL from the trade
   * @param {Position} position - Position object for the trade
   */
  recordTrade(profitLoss, position) {
    this.totalPnL += profitLoss;
    
    // Update position stats
    if (position) {
      if (position.isOpen) {
        this.positionStats.openPositions.add(position.id);
      } else {
        this.positionStats.openPositions.delete(position.id);
      }

      this.positionStats.totalPositions++;
      this.positionStats.totalVolume += position.size || 0;
      this.positionStats.avgPositionSize = this.positionStats.totalVolume / this.positionStats.totalPositions;
    }

    // Emit trade event
    this.emit('tradeRecorded', {
      profitLoss,
      position: position?.id || null,
      totalPnL: this.totalPnL,
      timestamp: Date.now()
    });

    console.log(`Trade recorded with PnL: ${profitLoss.toFixed(4)}`);
  }

  /**
   * Gets detailed wallet statistics
   * @returns {Object} Wallet statistics
   */
  getStatistics() {
    return {
      balance: this.balance,
      totalPnL: this.totalPnL,
      positions: {
        total: this.positionStats.totalPositions,
        open: this.positionStats.openPositions.size,
        avgSize: this.positionStats.avgPositionSize,
        totalVolume: this.positionStats.totalVolume
      },
      performance: {
        maxDrawdown: this.positionStats.maxDrawdown,
        peakBalance: this.positionStats.peakBalance,
        currentDrawdown: ((this.positionStats.peakBalance - this.balance) / this.positionStats.peakBalance) * 100,
        lastDrawdownUpdate: this.positionStats.lastDrawdownUpdate
      }
    };
  }

  /**
   * Checks if there's enough balance for a position
   * @param {number} amount - Amount needed
   * @param {Position} position - Position requesting the check
   * @returns {boolean} Whether there's sufficient balance
   */
  hasSufficientBalance(amount, position = null) {
    const hasBalance = this.balance >= amount;
    
    if (!hasBalance && position) {
      this.emit('insufficientBalance', {
        needed: amount,
        available: this.balance,
        position: position.id,
        timestamp: Date.now()
      });
    }

    return hasBalance;
  }
}

module.exports = Wallet;
