const EventEmitter = require("events");

const STATES = {
  PENDING: "PENDING",
  OPEN: "OPEN",
  CLOSED: "CLOSED",
};

class Position extends EventEmitter {
  constructor(token, priceManager) {
    super();
    this.token = token;
    this.priceManager = priceManager;

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
    this.currentPrice = token.getCurrentPrice?.() ?? token.currentPrice;
    this.highestPrice = this.currentPrice;
    this.lowestPrice = this.currentPrice;

    // P&L tracking
    this.unrealizedPnLSol = 0;
    this.unrealizedPnLUsd = 0;
    this.realizedPnLSol = 0;
    this.realizedPnLUsd = 0;
    this.highestUnrealizedPnLSol = 0;
    this.roiPercentage = 0;
  }

  open(price, size) {
    if (this.state !== STATES.PENDING) {
      throw new Error(`Cannot open position in state: ${this.state}`);
    }

    this.state = STATES.OPEN;
    this.entryPrice = price;
    this.size = size;
    this.openedAt = Date.now();

    this.trades.push({
      type: "ENTRY",
      price,
      size,
      timestamp: this.openedAt,
    });

    this.updatePriceMetrics(price);
    this.emit("opened", this.getState());
    return true;
  }

  close(price, reason = "manual") {
    if (this.state !== STATES.OPEN) {
      throw new Error(`Cannot close position in state: ${this.state}`);
    }

    this.state = STATES.CLOSED;
    this.closedAt = Date.now();
    this.closeReason = reason;

    this.trades.push({
      type: "EXIT",
      price,
      size: this.size,
      timestamp: this.closedAt,
      reason,
    });

    // Calculate final P&L
    this.realizedPnLSol = (price - this.entryPrice) * this.size;
    this.realizedPnLUsd =
      this.priceManager?.solToUSD?.(this.realizedPnLSol) ??
      this.realizedPnLSol * 100;
    this.unrealizedPnLSol = 0;
    this.unrealizedPnLUsd = 0;

    this.emit("closed", this.getState());
    return true;
  }

  updatePrice(price) {
    if (this.state !== STATES.OPEN) return;

    this.currentPrice = price;
    this.updatePriceMetrics(price);

    // Update P&L
    this.unrealizedPnLSol = (price - this.entryPrice) * this.size;
    this.unrealizedPnLUsd =
      this.priceManager?.solToUSD?.(this.unrealizedPnLSol) ??
      this.unrealizedPnLSol * 100;
    this.highestUnrealizedPnLSol = Math.max(
      this.highestUnrealizedPnLSol,
      this.unrealizedPnLSol
    );

    // Calculate ROI percentage
    this.roiPercentage = ((price - this.entryPrice) / this.entryPrice) * 100;

    this.emit("updated", this.getState());
  }

  updatePriceMetrics(price) {
    this.highestPrice = Math.max(this.highestPrice ?? price, price);
    this.lowestPrice = Math.min(this.lowestPrice ?? price, price);
  }

  getTimeInPosition() {
    if (!this.openedAt) return 0;
    return (this.closedAt || Date.now()) - this.openedAt;
  }

  getAverageEntryPrice() {
    const entryTrades = this.trades.filter((trade) => trade.type === "ENTRY");
    if (entryTrades.length === 0) return 0;

    const totalValue = entryTrades.reduce(
      (sum, trade) => sum + trade.price * trade.size,
      0
    );
    const totalSize = entryTrades.reduce((sum, trade) => sum + trade.size, 0);
    return totalValue / totalSize;
  }

  toJSON() {
    return {
      ...this.getState(),
    };
  }

  getState() {
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
      trades: this.trades,
      timeInPosition: this.getTimeInPosition(),
    };
  }
}

Position.STATES = STATES;
module.exports = Position;
