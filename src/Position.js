const EventEmitter = require('events');
const ExitStrategies = require('./ExitStrategies');
const winston = require('winston');

const STATES = {
  PENDING: 'PENDING',
  OPEN: 'OPEN',
  CLOSED: 'CLOSED'
};

class Position extends EventEmitter {
  constructor(token, priceManager, wallet, config = {}) {
    super();
    this.token = token;
    this.priceManager = priceManager;
    this.wallet = wallet;
    this.config = {
      takeProfitLevel: 50,
      stopLossLevel: 10,
      trailingStopLevel: 20,
      volumeDropEnabled: true,
      volumeDropThreshold: 50,
      priceVelocityEnabled: true,
      priceVelocityThreshold: -0.1,
      scoreBasedEnabled: true,
      minimumScoreThreshold: 30,
      TRANSACTION_FEES: {
        BUY: 0,
        SELL: 0
      },
      ...config
    };

    // Initialize logger
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      defaultMeta: { service: 'position-service' },
      transports: [
        new winston.transports.Console({
          format: winston.format.simple()
        })
      ]
    });

    // Initialize exit strategies
    this.exitStrategies = new ExitStrategies(this.logger);

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
    this.lastPriceUpdate = Date.now();

    // Performance metrics
    this.unrealizedPnLSol = 0;
    this.unrealizedPnLUsd = 0;
    this.realizedPnLSol = 0;
    this.realizedPnLUsd = 0;
    this.realizedPnLWithFeesSol = 0;
    this.realizedPnLWithFeesUsd = 0;
    this.highestUnrealizedPnLSol = 0;
    this.roiPercentage = 0;
    this.roiPercentageWithFees = 0;
    this.priceVelocity = 0;
    this.volumeSinceCreation = 0;
    this.tradeCountSinceCreation = 0;
    this.score = {
      overall: 0,
      priceComponent: 0,
      volumeComponent: 0,
      timeComponent: 0
    };

    // Pump metrics
    this.tokenCreatedAt = token.createdAt;
    this.timeToEntry = null;
    this.initialPumpPeak = null;
    this.timeToPumpPeak = null;
    this.executionSlippage = 0;

    // OHLCV metrics
    this.entryCandle = null;
    this.currentCandle = null;
  }

  async open(price, size) {
    if (this.state !== STATES.PENDING) {
      throw new Error(`Cannot open position in state: ${this.state}`);
    }

    // Check if we can afford the trade
    if (!this.wallet.canAffordTrade(size * price, true)) {
      throw new Error('Insufficient balance to open position');
    }

    const success = await this.wallet.processTrade(size * price, true);
    if (!success) {
      throw new Error('Failed to process trade');
    }

    this.state = STATES.OPEN;
    this.entryPrice = price;
    this.size = size;
    this.openedAt = Date.now();
    
    // Add entry trade
    this.trades.push({
      type: 'ENTRY',
      price,
      size,
      timestamp: this.openedAt
    });
    
    // Store entry candle data
    const currentCandle = this.token.ohlcvData.secondly[this.token.ohlcvData.secondly.length - 1];
    if (currentCandle) {
      this.entryCandle = { ...currentCandle };
      this.currentCandle = { ...currentCandle };
    }
    
    // Calculate pump metrics
    this.timeToEntry = this.openedAt - this.tokenCreatedAt;
    this.initialPumpPeak = Math.max(price, this.token.getHighestPrice());
    this.timeToPumpPeak = this.token.getHighestPriceTime() - this.tokenCreatedAt;
    this.volumeSinceCreation = this.token.getVolumeSinceCreation();
    this.tradeCountSinceCreation = this.token.getTradeCount();
    
    // Copy initial score
    this.score = { ...this.token.score };

    // Initialize price tracking
    this.highestPrice = price;
    this.lowestPrice = price;
    this.currentPrice = price;

    this.updatePriceMetrics(price);
    this.emit('opened', this.getState());
  }

  async close(price, reason) {
    if (this.state !== STATES.OPEN) {
      throw new Error(`Cannot close position in state: ${this.state}`);
    }

    const tradeAmount = price * this.size;
    const success = await this.wallet.processTrade(tradeAmount, false);
    if (!success) {
      throw new Error('Failed to process trade');
    }

    this.state = STATES.CLOSED;
    this.closedAt = Date.now();
    
    // Add exit trade
    this.trades.push({
      type: 'EXIT',
      price,
      size: this.size,
      timestamp: this.closedAt,
      reason
    });
    
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
    
    // Update price velocity (price change percentage per second)
    this.priceVelocity = timeDelta > 0 ? (priceDelta / this.currentPrice) / (timeDelta / 1000) : 0;
    
    // Update price extremes
    if (this.highestPrice === null || newPrice > this.highestPrice) {
      this.highestPrice = newPrice;
    }
    if (this.lowestPrice === null || newPrice < this.lowestPrice) {
      this.lowestPrice = newPrice;
    }
    
    // Update OHLCV data
    const currentCandle = this.token.ohlcvData.secondly[this.token.ohlcvData.secondly.length - 1];
    if (currentCandle) {
      this.currentCandle = { ...currentCandle };
    }
    
    // Update score
    this.score = { ...this.token.score };
    
    // Update volume and trade metrics
    this.volumeSinceCreation = this.token.getVolumeSinceCreation();
    this.tradeCountSinceCreation = this.token.getTradeCount();
    
    this.updatePriceMetrics(newPrice);
    this.lastPriceUpdate = now;
    
    // Emit update event with current state
    this.emit('updated', this.getState());
    
    // Check exit signals
    const exitSignal = this.checkExitSignals();
    if (exitSignal) {
      this.logger.info('Exit signal triggered', {
        symbol: this.symbol,
        reason: exitSignal.reason,
        portion: exitSignal.portion,
        currentPrice: newPrice,
        entryPrice: this.entryPrice,
        pnl: this.unrealizedPnLSol
      });
      
      // Emit exit signal before closing
      this.emit('exitSignal', exitSignal);
      
      // Close the position
      this.close(newPrice, exitSignal.reason);
    }
  }

  updatePriceMetrics(price) {
    this.currentPrice = price;
    
    if (this.state === STATES.OPEN) {
      const priceDiff = price - this.entryPrice;
      const totalValue = price * this.size;
      const entryValue = this.entryPrice * this.size;
      
      this.unrealizedPnLSol = totalValue - entryValue;
      this.unrealizedPnLUsd = this.priceManager.solToUSD(this.unrealizedPnLSol);
      this.roiPercentage = (priceDiff / this.entryPrice) * 100;
      
      if (this.unrealizedPnLSol > this.highestUnrealizedPnLSol) {
        this.highestUnrealizedPnLSol = this.unrealizedPnLSol;
      }
    }
    
    // Emit the update event with current state
    this.emit('updated', this.getState());
  }

  calculateFinalPnL(price) {
    // Calculate P&L without fees
    const pnlSol = (price - this.entryPrice) * this.size;
    this.realizedPnLSol = pnlSol;
    this.realizedPnLUsd = this.priceManager.solToUSD(pnlSol);

    // Calculate P&L with fees
    const totalFees = this.config.TRANSACTION_FEES.BUY + this.config.TRANSACTION_FEES.SELL;
    this.transactionFees = totalFees;
    this.realizedPnLWithFeesSol = pnlSol - totalFees;
    this.realizedPnLWithFeesUsd = this.priceManager.solToUSD(this.realizedPnLWithFeesSol);

    // Update ROI calculations
    const initialInvestment = this.entryPrice * this.size;
    this.roiPercentage = (pnlSol / initialInvestment) * 100;
    this.roiPercentageWithFees = ((pnlSol - totalFees) / initialInvestment) * 100;

    // Reset unrealized values
    this.unrealizedPnLSol = 0;
    this.unrealizedPnLUsd = 0;
  }

  checkExitSignals() {
    if (this.state !== STATES.OPEN) {
      return null;
    }

    try {
      return this.exitStrategies.checkExitSignals(this);
    } catch (error) {
      this.logger.error('Error checking exit signals', {
        error: error.message,
        symbol: this.symbol
      });
      return null;
    }
  }

  // Position metrics
  getTimeInPosition() {
    if (!this.openedAt) return 0;
    const endTime = this.closedAt || Date.now();
    return endTime - this.openedAt;
  }

  getAverageEntryPrice() {
    if (this.state === STATES.OPEN) {
      return this.entryPrice;
    }
    return 0;
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
      realizedPnLWithFeesSol: this.realizedPnLWithFeesSol,
      realizedPnLWithFeesUsd: this.realizedPnLWithFeesUsd,
      transactionFees: this.transactionFees,
      highestUnrealizedPnLSol: this.highestUnrealizedPnLSol,
      roiPercentage: this.roiPercentage,
      roiPercentageWithFees: this.roiPercentageWithFees,
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
      executionSlippage: this.executionSlippage,
      entryCandle: this.entryCandle,
      currentCandle: this.currentCandle,
      score: this.score
    };
  }

  toJSON() {
    return {
      mint: this.mint,
      symbol: this.symbol,
      state: this.state,
      size: this.size,
      trades: this.trades,
      createdAt: this.createdAt,
      openedAt: this.openedAt,
      closedAt: this.closedAt,
      entryPrice: this.entryPrice,
      currentPrice: this.currentPrice,
      highestPrice: this.highestPrice,
      lowestPrice: this.lowestPrice,
      unrealizedPnLSol: this.unrealizedPnLSol,
      unrealizedPnLUsd: this.unrealizedPnLUsd,
      realizedPnLSol: this.realizedPnLSol,
      realizedPnLUsd: this.realizedPnLUsd,
      roiPercentage: this.roiPercentage,
      priceVelocity: this.priceVelocity,
      score: this.score,
      config: this.config
    };
  }
}

Position.STATES = STATES;
module.exports = Position;
