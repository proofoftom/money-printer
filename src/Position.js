const EventEmitter = require('events');

const STATES = {
  PENDING: 'PENDING',
  OPEN: 'OPEN',
  CLOSED: 'CLOSED'
};

class Position extends EventEmitter {
  constructor(token, priceManager, config = {}) {
    super();
    this.token = token;
    this.priceManager = priceManager;
    this.config = {
      // Default settings that can be overridden
      takeProfitLevel: 50, // 50%
      stopLossLevel: 10,   // 10%
      ...config
    };

    // Core position data
    this.mint = token.mint;
    this.symbol = token.symbol;
    this.state = STATES.PENDING;
    this.size = 0;
    this.trades = [];
    this.createdAt = Date.now();
    this.openedAt = null;
    this.closedAt = null;

    // Price tracking
    this.entryPrice = null;
    this.currentPrice = token.getCurrentPrice();
    this.highestPrice = null;
    this.lowestPrice = null;

    // P&L tracking
    this.unrealizedPnLSol = 0;
    this.unrealizedPnLUsd = 0;
    this.realizedPnLSol = 0;
    this.realizedPnLUsd = 0;
    this.highestUnrealizedPnLSol = 0;
    this.roiPercentage = 0;
  }

  // State management
  open(price, size) {
    if (this.state !== STATES.PENDING) {
      throw new Error(`Cannot open position in state: ${this.state}`);
    }

    this.state = STATES.OPEN;
    this.entryPrice = price;
    this.currentPrice = price;
    this.highestPrice = price;
    this.lowestPrice = price;
    this.size = size;
    this.openedAt = Date.now();

    this.trades.push({
      type: 'ENTRY',
      price,
      size,
      timestamp: this.openedAt
    });

    this.updateMetrics();
    this.emit('opened', this.toJSON());
  }

  close(price, reason) {
    if (this.state !== STATES.OPEN) {
      throw new Error(`Cannot close position in state: ${this.state}`);
    }

    this.state = STATES.CLOSED;
    this.currentPrice = price;
    this.closedAt = Date.now();

    this.trades.push({
      type: 'EXIT',
      price,
      size: this.size,
      timestamp: this.closedAt,
      reason
    });

    // Calculate final P&L
    const pnlSol = (price - this.entryPrice) * this.size;
    this.realizedPnLSol += pnlSol;
    this.realizedPnLUsd += this.priceManager.solToUSD(pnlSol);
    this.unrealizedPnLSol = 0;
    this.unrealizedPnLUsd = 0;

    this.updateMetrics();
    this.emit('closed', this.toJSON());
  }

  // Price and P&L updates
  updatePrice(newPrice) {
    if (this.state !== STATES.OPEN) {
      throw new Error(`Cannot update price in state: ${this.state}`);
    }

    this.currentPrice = newPrice;
    this.highestPrice = Math.max(this.highestPrice, newPrice);
    this.lowestPrice = Math.min(this.lowestPrice, newPrice);

    this.updateMetrics();
    this.emit('priceUpdated', this.toJSON());
  }

  updateMetrics() {
    if (this.state !== STATES.OPEN) return;

    // Calculate unrealized P&L
    this.unrealizedPnLSol = (this.currentPrice - this.entryPrice) * this.size;
    this.unrealizedPnLUsd = this.priceManager.solToUSD(this.unrealizedPnLSol);
    
    // Update highest unrealized P&L
    this.highestUnrealizedPnLSol = Math.max(
      this.highestUnrealizedPnLSol,
      this.unrealizedPnLSol
    );

    // Calculate ROI
    const invested = this.entryPrice * this.size;
    this.roiPercentage = (this.unrealizedPnLSol / invested) * 100;
  }

  // Position metrics
  getTimeInPosition() {
    if (!this.openedAt) return 0;
    const endTime = this.closedAt || Date.now();
    return endTime - this.openedAt;
  }

  getAverageEntryPrice() {
    const entryTrades = this.trades.filter(trade => trade.type === 'ENTRY');
    if (entryTrades.length === 0) return 0;

    const totalValue = entryTrades.reduce((sum, trade) => sum + (trade.price * trade.size), 0);
    const totalSize = entryTrades.reduce((sum, trade) => sum + trade.size, 0);
    return totalValue / totalSize;
  }

  // Serialization
  toJSON() {
    return {
      mint: this.mint,
      symbol: this.symbol,
      state: this.state,
      size: this.size,
      entryPrice: this.entryPrice,
      currentPrice: this.currentPrice,
      highestPrice: this.highestPrice,
      lowestPrice: this.lowestPrice,
      unrealizedPnLSol: this.unrealizedPnLSol,
      unrealizedPnLUsd: this.unrealizedPnLUsd,
      realizedPnLSol: this.realizedPnLSol,
      realizedPnLUsd: this.realizedPnLUsd,
      highestUnrealizedPnLSol: this.highestUnrealizedPnLSol,
      roiPercentage: this.roiPercentage,
      timeInPosition: this.getTimeInPosition(),
      trades: this.trades,
      createdAt: this.createdAt,
      openedAt: this.openedAt,
      closedAt: this.closedAt,
      config: this.config
    };
  }
}

Position.STATES = STATES;
module.exports = Position;
