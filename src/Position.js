const EventEmitter = require('events');

class Position extends EventEmitter {
  constructor(data) {
    super();
    this.mint = data.mint;
    this.entryPrice = data.entryPrice;
    this.size = data.size;
    this.remainingSize = 1.0;
    this.currentPrice = data.entryPrice;
    this.entryTime = Date.now();
    this.state = 'active';
    this.highestPrice = data.entryPrice;
    this.lowestPrice = data.entryPrice;
    this.maxDrawdown = 0;
    this.maxUpside = 0;
    this.volumeHistory = [];
    this.candleHistory = [];
    this.priceHistory = [data.entryPrice];
    this.profitHistory = [0];
    this.volume = 0;
    this.volume1m = 0;
    this.volume5m = 0;
    this.volume30m = 0;
    this.partialExits = [];
    this.updates = [];
    this.lastUpdate = Date.now();
    this.symbol = data.symbol;
    this.priceManager = data.priceManager;
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
    this.currentPrice = price;
    this.priceHistory.push(price);
    if (this.priceHistory.length > 60) { // 60 data points at ~10s intervals = 10 minutes
      this.priceHistory.shift();
    }

    if (price > this.highestPrice) {
      this.highestPrice = price;
      this.maxUpside = ((price - this.entryPrice) / this.entryPrice) * 100;
    }

    if (price < this.lowestPrice) {
      this.lowestPrice = price;
      this.maxDrawdown = ((this.entryPrice - price) / this.entryPrice) * 100;
    }

    const currentProfit = ((price - this.entryPrice) / this.entryPrice) * 100;
    this.profitHistory.push(currentProfit);
    if (this.profitHistory.length > 30) {
      this.profitHistory.shift();
    }

    this.updates.push({
      timestamp: Date.now(),
      price,
      type: 'priceUpdate'
    });

    return this;
  }

  updateVolume(volumeData) {
    this.volumeHistory.push({
      timestamp: Date.now(),
      ...volumeData
    });

    if (this.volumeHistory.length > 30) { // 30 data points = 5 minutes
      this.volumeHistory.shift();
    }

    this.volume = volumeData.volume || 0;
    this.volume1m = volumeData.volume1m || 0;
    this.volume5m = volumeData.volume5m || 0;
    this.volume30m = volumeData.volume30m || 0;

    return this;
  }

  updateCandles(candleData) {
    this.candleHistory.push(candleData);
    if (this.candleHistory.length > 30) {
      this.candleHistory.shift();
    }
    return this;
  }

  recordPartialExit(data) {
    this.partialExits.push({
      ...data,
      timestamp: Date.now()
    });
    this.remainingSize = data.remainingSize;
    this.emit('partialExit', this);
    return this;
  }

  close() {
    this.state = 'closed';
    this.closedAt = Date.now();
    this.emit('closed', this);
    return this;
  }

  getProfitLoss() {
    return {
      percentage: ((this.currentPrice - this.entryPrice) / this.entryPrice) * 100,
      amount: ((this.currentPrice - this.entryPrice) / this.entryPrice) * this.size * this.remainingSize
    };
  }

  getHoldTime() {
    return Date.now() - this.entryTime;
  }

  isStale(threshold = 5 * 60 * 1000) { // 5 minutes by default
    return Date.now() - this.lastUpdate > threshold;
  }

  getCurrentValueUSD() {
    if (!this.priceManager) {
      throw new Error('PriceManager not initialized for position');
    }
    return this.priceManager.solToUSD(this.currentPrice * this.remainingSize);
  }

  getEntryValueUSD() {
    if (!this.priceManager) {
      throw new Error('PriceManager not initialized for position');
    }
    return this.priceManager.solToUSD(this.entryPrice * this.size);
  }

  getPnLUSD() {
    return this.getCurrentValueUSD() - this.getEntryValueUSD();
  }

  getPnLPercentage() {
    const entryValue = this.getEntryValueUSD();
    if (entryValue === 0) return 0;
    return (this.getPnLUSD() / entryValue) * 100;
  }

  toJSON() {
    return {
      mint: this.mint,
      symbol: this.symbol,
      entryPrice: this.entryPrice,
      currentPrice: this.currentPrice,
      size: this.size,
      remainingSize: this.remainingSize,
      entryTime: this.entryTime,
      state: this.state,
      profitLoss: this.getProfitLoss(),
      holdTime: this.getHoldTime(),
      volume: this.volume,
      volume5m: this.volume5m,
      highestPrice: this.highestPrice,
      lowestPrice: this.lowestPrice,
      maxDrawdown: this.maxDrawdown,
      maxUpside: this.maxUpside,
      lastUpdate: this.lastUpdate
    };
  }

  static fromJSON(data) {
    return new Position({
      mint: data.mint,
      symbol: data.symbol,
      entryPrice: data.entryPrice,
      size: data.size
    }).update({
      currentPrice: data.currentPrice,
      volumeData: {
        volume: data.volume,
        volume5m: data.volume5m
      }
    });
  }
}

module.exports = Position;
