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

    // Pump metrics
    this.tokenCreatedAt = token.createdAt;
    this.timeToEntry = null;
    this.initialPumpPeak = null;
    this.timeToPumpPeak = null;
    this.priceVelocity = 0;
    this.volumeSinceCreation = 0;
    this.tradeCountSinceCreation = 0;
    this.lastPriceUpdate = Date.now();
    this.executionSlippage = 0;

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
    this.size = size;
    this.openedAt = Date.now();
    
    // Calculate pump metrics
    this.timeToEntry = this.openedAt - this.tokenCreatedAt;
    this.initialPumpPeak = Math.max(price, this.token.getHighestPrice());
    this.timeToPumpPeak = this.token.getHighestPriceTime() - this.tokenCreatedAt;
    this.volumeSinceCreation = this.token.getVolumeSinceCreation();
    this.tradeCountSinceCreation = this.token.getTradeCount();

    this.updatePriceMetrics(price);
    this.emit('opened', this.getState());
  }

  close(price, reason) {
    if (this.state !== STATES.OPEN) {
      throw new Error(`Cannot close position in state: ${this.state}`);
    }

    this.state = STATES.CLOSED;
    this.closedAt = Date.now();
    
    // Calculate execution slippage
    const expectedPrice = this.currentPrice;
    this.executionSlippage = ((expectedPrice - price) / expectedPrice) * 100;
    
    this.updatePriceMetrics(price);
    this.calculateFinalPnL(price);
    
    this.emit('closed', { ...this.getState(), reason });
  }

  updatePrice(newPrice) {
    if (this.state !== STATES.OPEN) return;

    const now = Date.now();
    const timeDelta = now - this.lastPriceUpdate;
    const priceDelta = newPrice - this.currentPrice;
    
    // Update price velocity (price change per second)
    this.priceVelocity = timeDelta > 0 ? priceDelta / (timeDelta / 1000) : 0;
    
    // Update volume and trade metrics
    this.volumeSinceCreation = this.token.getVolumeSinceCreation();
    this.tradeCountSinceCreation = this.token.getTradeCount();
    
    this.updatePriceMetrics(newPrice);
    this.lastPriceUpdate = now;
    
    this.emit('updated', this.getState());
  }

  updatePriceMetrics(price) {
    if (this.state !== STATES.OPEN) return;

    this.currentPrice = price;
    this.highestPrice = Math.max(this.highestPrice, price);
    this.lowestPrice = Math.min(this.lowestPrice, price);

    // Calculate unrealized P&L
    this.unrealizedPnLSol = (price - this.entryPrice) * this.size;
    this.unrealizedPnLUsd = this.priceManager.solToUSD(this.unrealizedPnLSol);

    // Update highest unrealized P&L
    if (this.unrealizedPnLSol > this.highestUnrealizedPnLSol) {
      this.highestUnrealizedPnLSol = this.unrealizedPnLSol;
    }

    // Calculate ROI percentage
    this.roiPercentage = ((price - this.entryPrice) / this.entryPrice) * 100;
  }

  calculateFinalPnL(price) {
    // Calculate final P&L
    const pnlSol = (price - this.entryPrice) * this.size;
    this.realizedPnLSol += pnlSol;
    this.realizedPnLUsd += this.priceManager.solToUSD(pnlSol);
    this.unrealizedPnLSol = 0;
    this.unrealizedPnLUsd = 0;
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
      timeInPosition: this.getTimeInPosition(),
      trades: this.trades,
      createdAt: this.createdAt,
      openedAt: this.openedAt,
      closedAt: this.closedAt,
      config: this.config,
      tokenCreatedAt: this.tokenCreatedAt,
      timeToEntry: this.timeToEntry,
      initialPumpPeak: this.initialPumpPeak,
      timeToPumpPeak: this.timeToPumpPeak,
      priceVelocity: this.priceVelocity,
      volumeSinceCreation: this.volumeSinceCreation,
      tradeCountSinceCreation: this.tradeCountSinceCreation,
      lastPriceUpdate: this.lastPriceUpdate,
      executionSlippage: this.executionSlippage
    };
  }
}

Position.STATES = STATES;
module.exports = Position;
