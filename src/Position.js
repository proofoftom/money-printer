const EventEmitter = require('events');

class Position extends EventEmitter {
  constructor({ mint, symbol, entryPrice, size, token, priceManager, config }) {
    super();
    this.validateConstructorParams({ entryPrice, size, config });

    this.mint = mint;
    this.symbol = symbol;
    this.entryPrice = entryPrice;
    this.size = size;
    this.token = token;
    this.priceManager = priceManager;
    this.config = config;

    this.remainingSize = 1.0;
    this.currentPrice = entryPrice;
    this.entryTime = Date.now();
    this.state = 'active';
    this.highestPrice = entryPrice;
    this.lowestPrice = entryPrice;
    this.maxDrawdown = 0;
    this.maxUpside = 0;
    this.volumeHistory = [];
    this.candleHistory = [];
    this.priceHistory = [entryPrice];
    this.profitHistory = [{ pnl: 0, timestamp: Date.now() }];
    this.partialExits = [];
    this.lastUpdate = Date.now();
    this.updates = [];

    // Track trader activity during position
    this.traderActivity = {
      entryTraders: new Set(), // traders active when we entered
      activeTraders: new Set(), // currently active traders
      exitedTraders: new Set(), // traders who have fully exited
      whales: new Set(), // traders with significant holdings
      tradeVolume: new Map() // trader -> total volume traded
    };

    // Snapshot initial trader state
    this.snapshotTraderState();

    // Listen for trader events
    if (this.token) {
      this.token.on('traderTradeAdded', this.handleTraderTrade.bind(this));
    }
  }

  snapshotTraderState() {
    if (!this.token) return;

    const traders = this.token.getTraders();
    const whaleThreshold = this.token.supply * 0.01; // 1% of supply

    traders.forEach(trader => {
      const balance = trader.getTokenBalance(this.mint);
      if (balance > 0) {
        this.traderActivity.entryTraders.add(trader.publicKey);
        this.traderActivity.activeTraders.add(trader.publicKey);
      }
      if (balance > whaleThreshold) {
        this.traderActivity.whales.add(trader.publicKey);
      }
      this.traderActivity.tradeVolume.set(trader.publicKey, 0);
    });
  }

  handleTraderTrade({ trader, trade }) {
    const { txType, amount, newBalance } = trade;
    
    // Update trade volume
    const currentVolume = this.traderActivity.tradeVolume.get(trader.publicKey) || 0;
    this.traderActivity.tradeVolume.set(trader.publicKey, currentVolume + amount);

    // Track trader status
    if (newBalance > 0) {
      this.traderActivity.activeTraders.add(trader.publicKey);
    } else {
      this.traderActivity.activeTraders.delete(trader.publicKey);
      if (this.traderActivity.entryTraders.has(trader.publicKey)) {
        this.traderActivity.exitedTraders.add(trader.publicKey);
      }
    }

    // Check for whale status
    const whaleThreshold = this.token.supply * 0.01;
    if (newBalance > whaleThreshold) {
      this.traderActivity.whales.add(trader.publicKey);
    } else {
      this.traderActivity.whales.delete(trader.publicKey);
    }

    // Analyze trade impact
    this.analyzeTraderImpact(trader, trade);
  }

  analyzeTraderImpact(trader, trade) {
    const isWhale = this.traderActivity.whales.has(trader.publicKey);
    const wasInitialTrader = this.traderActivity.entryTraders.has(trader.publicKey);
    const { txType, amount } = trade;

    // Emit events for significant trader activity
    if (isWhale) {
      this.emit('whaleActivity', { trader, trade, position: this });
    }

    if (wasInitialTrader && txType === 'sell') {
      const exitRatio = amount / this.token.supply;
      if (exitRatio > 0.01) { // More than 1% of supply
        this.emit('initialTraderExit', { trader, trade, exitRatio, position: this });
      }
    }
  }

  getTraderMetrics() {
    return {
      initialTraderCount: this.traderActivity.entryTraders.size,
      activeTraderCount: this.traderActivity.activeTraders.size,
      exitedTraderCount: this.traderActivity.exitedTraders.size,
      whaleCount: this.traderActivity.whales.size,
      retentionRate: this.traderActivity.activeTraders.size / this.traderActivity.entryTraders.size,
      initialTraderExitRate: this.traderActivity.exitedTraders.size / this.traderActivity.entryTraders.size,
      topTraders: Array.from(this.traderActivity.tradeVolume.entries())
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([publicKey, volume]) => ({
          publicKey,
          volume,
          isWhale: this.traderActivity.whales.has(publicKey),
          isInitial: this.traderActivity.entryTraders.has(publicKey)
        }))
    };
  }

  validateConstructorParams({ entryPrice, size, config }) {
    if (!entryPrice || entryPrice <= 0) {
      throw new Error('Invalid entry price');
    }

    if (!size || size <= 0) {
      throw new Error('Invalid position size');
    }

    if (size > config.POSITIONS.MAX_SIZE) {
      throw new Error(`Position size exceeds maximum allowed (${config.POSITIONS.MAX_SIZE})`);
    }

    if (size < config.POSITIONS.MIN_SIZE) {
      throw new Error(`Position size below minimum allowed (${config.POSITIONS.MIN_SIZE})`);
    }
  }

  update(data) {
    this.lastUpdate = Date.now();
    
    if (data.currentPrice) {
      this.updatePrice(data.currentPrice);
    }
    
    if (data.volumeData) {
      this.updateVolume(data.volumeData);
    }
    
    if (data.candleData) {
      this.updateCandles(data.candleData);
    }
    
    this.emit('updated', this);
    return this;
  }

  updatePrice(price) {
    if (!price || price <= 0) {
      throw new Error('Invalid price update');
    }

    this.currentPrice = price;
    this.priceHistory.push(price);

    if (price > this.highestPrice) {
      this.highestPrice = price;
      this.maxUpside = ((price - this.entryPrice) / this.entryPrice) * 100;
    }

    if (price < this.lowestPrice) {
      this.lowestPrice = price;
      this.maxDrawdown = ((this.entryPrice - price) / this.entryPrice) * 100;
    }

    const currentPnL = this.calculatePnLPercent(price);
    this.profitHistory.push({ pnl: currentPnL, timestamp: Date.now() });

    this.updates.push({
      timestamp: Date.now(),
      price,
      type: 'priceUpdate'
    });

    this.emit('updated', this);
    return this;
  }

  calculatePnLPercent(price = this.currentPrice) {
    return ((price - this.entryPrice) / this.entryPrice) * 100;
  }

  getCurrentValueUSD() {
    if (!this.priceManager) {
      throw new Error('PriceManager not initialized for position');
    }
    return this.priceManager.solToUSD(this.currentPrice * this.size * this.remainingSize);
  }

  getEntryValueUSD() {
    if (!this.priceManager) {
      throw new Error('PriceManager not initialized for position');
    }
    return this.priceManager.solToUSD(this.entryPrice * this.size * this.remainingSize);
  }

  getPnLUSD() {
    if (!this.priceManager) {
      throw new Error('PriceManager not initialized for position');
    }
    const currentValue = this.priceManager.solToUSD(this.currentPrice * this.size * this.remainingSize);
    const entryValue = this.priceManager.solToUSD(this.entryPrice * this.size * this.remainingSize);
    const unrealizedPnL = currentValue - entryValue;
    const realizedPnL = this.getRealizedPnL();
    return unrealizedPnL + realizedPnL;
  }

  getPnLPercentage() {
    return this.calculatePnLPercent();
  }

  recordPartialExit(portion, price) {
    if (portion <= 0 || portion > this.remainingSize) {
      throw new Error('Invalid exit portion');
    }

    const exit = {
      portion,
      price,
      timestamp: Date.now(),
      pnl: ((price - this.entryPrice) / this.entryPrice) * 100,
      size: portion * this.size
    };

    this.partialExits.push(exit);
    this.remainingSize = Math.max(0, this.remainingSize - portion);

    this.emit('partialExit', exit);
    return exit;
  }

  getRealizedPnL() {
    return this.partialExits.reduce((total, exit) => {
      const exitValue = exit.price * exit.size;
      const entryValue = this.entryPrice * exit.size;
      return total + (exitValue - entryValue);
    }, 0);
  }

  isStale(threshold) {
    return Date.now() - this.lastUpdate > threshold;
  }

  getUpdateFrequency() {
    if (this.updates.length < 2) {
      return { count: this.updates.length, averageInterval: 0 };
    }

    const intervals = [];
    for (let i = 1; i < this.updates.length; i++) {
      intervals.push(this.updates[i].timestamp - this.updates[i-1].timestamp);
    }

    return {
      count: this.updates.length,
      averageInterval: intervals.reduce((a, b) => a + b, 0) / intervals.length
    };
  }

  toJSON() {
    return {
      mint: this.mint,
      symbol: this.symbol,
      entryPrice: this.entryPrice,
      currentPrice: this.currentPrice,
      size: this.size,
      remainingSize: this.remainingSize,
      pnlPercent: this.getPnLPercentage(),
      pnlUSD: this.getPnLUSD(),
      maxDrawdown: this.maxDrawdown,
      maxUpside: this.maxUpside,
      entryTime: this.entryTime,
      lastUpdate: this.lastUpdate,
      state: this.state,
      partialExits: this.partialExits
    };
  }
}

module.exports = Position;
