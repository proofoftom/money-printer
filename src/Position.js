const EventEmitter = require('events');
const config = require('./config');

class Position extends EventEmitter {
  constructor({
    mint,
    entryPrice,
    size,
    entryTime = Date.now(),
    symbol = null
  }) {
    super();
    this.mint = mint;
    this.entryPrice = entryPrice;
    this.size = size;
    this.highestPrice = entryPrice;
    this.lowestPrice = entryPrice;
    this.remainingSize = 1.0;
    this.currentPrice = entryPrice;
    this.entryTime = entryTime;
    this.maxDrawdown = 0;
    this.maxUpside = 0;
    this.volumeHistory = [];
    this.candleHistory = [];
    this.priceHistory = [entryPrice];
    this.profitHistory = [0];
    this.volume = 0;
    this.volume1m = 0;
    this.volume5m = 0;
    this.volume30m = 0;
    this.highPrice = entryPrice;
    this.symbol = symbol || mint.slice(0, 8);
    this.partialExits = [];
  }

  calculateVolatility() {
    if (!this.candleHistory || this.candleHistory.length < 2) return 0;
    
    const returns = [];
    for (let i = 1; i < this.candleHistory.length; i++) {
      const returnVal = (this.candleHistory[i].close - this.candleHistory[i-1].close) / this.candleHistory[i-1].close;
      returns.push(returnVal);
    }
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }

  analyzeVolumeProfile() {
    if (!this.volumeHistory || this.volumeHistory.length === 0) return null;
    
    const volumeData = this.volumeHistory.map(v => v.volume);
    const maxVolume = Math.max(...volumeData);
    const minVolume = Math.min(...volumeData);
    const avgVolume = volumeData.reduce((a, b) => a + b, 0) / volumeData.length;
    
    return {
      maxVolume,
      minVolume,
      avgVolume,
      volumeStability: (maxVolume - minVolume) / avgVolume
    };
  }

  calculateTimeToMaxPrice() {
    if (!this.candleHistory || this.candleHistory.length === 0) return null;
    
    const maxPriceCandle = this.candleHistory.find(c => c.high === this.highestPrice);
    if (!maxPriceCandle) return null;
    
    return Math.round((maxPriceCandle.timestamp - this.entryTime) / 1000); // in seconds
  }

  calculateAverageVolume() {
    if (!this.volumeHistory || this.volumeHistory.length === 0) return 0;
    return this.volumeHistory.reduce((sum, v) => sum + v.volume, 0) / this.volumeHistory.length;
  }

  calculateTrendDirection() {
    if (!this.candleHistory || this.candleHistory.length < 2) return 'neutral';
    
    const prices = this.candleHistory.map(c => c.close);
    const firstHalf = prices.slice(0, Math.floor(prices.length / 2));
    const secondHalf = prices.slice(Math.floor(prices.length / 2));
    
    const firstHalfAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    
    if (secondHalfAvg > firstHalfAvg * 1.05) return 'uptrend';
    if (secondHalfAvg < firstHalfAvg * 0.95) return 'downtrend';
    return 'neutral';
  }

  calculateVolumeStrength() {
    if (!this.volumeHistory || this.volumeHistory.length < 2) return 'neutral';
    
    const volumes = this.volumeHistory.map(v => v.volume);
    const firstHalf = volumes.slice(0, Math.floor(volumes.length / 2));
    const secondHalf = volumes.slice(Math.floor(volumes.length / 2));
    
    const firstHalfAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    
    if (secondHalfAvg > firstHalfAvg * 1.2) return 'increasing';
    if (secondHalfAvg < firstHalfAvg * 0.8) return 'decreasing';
    return 'stable';
  }

  update(currentPrice, volumeData = null, candleData = null) {
    // Validate price
    if (typeof currentPrice !== 'number' || currentPrice <= 0) {
      throw new Error(`Invalid price: ${currentPrice}. Price must be a positive number.`);
    }

    // Check for unreasonable price changes (e.g., more than 1000% change)
    const priceChange = Math.abs((currentPrice - this.currentPrice) / this.currentPrice * 100);
    if (priceChange > 1000) {
      console.warn(`Warning: Large price change detected (${priceChange.toFixed(2)}%) for ${this.mint}`);
    }

    // Update price history (keep last 10 minutes of data)
    this.priceHistory.push(currentPrice);
    if (this.priceHistory.length > 60) { // 60 data points at ~10s intervals = 10 minutes
      this.priceHistory.shift();
    }

    // Update volume history (keep last 5 minutes of data)
    if (volumeData) {
      // Validate volume data
      const volumes = ['volume', 'volume1m', 'volume5m', 'volume30m'];
      volumes.forEach(key => {
        if (volumeData[key] !== undefined && (typeof volumeData[key] !== 'number' || volumeData[key] < 0)) {
          throw new Error(`Invalid ${key}: ${volumeData[key]}. Volume must be a non-negative number.`);
        }
      });

      this.volumeHistory.push({
        timestamp: Date.now(),
        volume: volumeData.volume || 0,
        volume1m: volumeData.volume1m || 0,
        volume5m: volumeData.volume5m || 0,
        volume30m: volumeData.volume30m || 0
      });
      if (this.volumeHistory.length > 30) { // 30 data points = 5 minutes
        this.volumeHistory.shift();
      }
    }

    // Update profit history
    const currentProfit = ((currentPrice - this.entryPrice) / this.entryPrice) * 100;
    this.profitHistory.push(currentProfit);
    if (this.profitHistory.length > 30) {
      this.profitHistory.shift();
    }

    // Update high price if needed
    this.highPrice = Math.max(this.highPrice, currentPrice);
    
    // Update current state
    this.currentPrice = currentPrice;
    if (volumeData) {
      this.volume = volumeData.volume || this.volume;
      this.volume1m = volumeData.volume1m || this.volume1m;
      this.volume5m = volumeData.volume5m || this.volume5m;
      this.volume30m = volumeData.volume30m || this.volume30m;
    }
    if (candleData) {
      // Validate candle data
      if (!candleData.high || !candleData.low || !candleData.open || !candleData.close) {
        throw new Error('Invalid candle data: Missing required OHLC values');
      }
      this.candleHistory.push(candleData);
    }

    // Emit update event
    this.emit('updated', this);
  }

  recordPartialExit(portion, exitPrice) {
    // Validate portion
    if (typeof portion !== 'number' || portion <= 0 || portion > 1) {
      throw new Error(`Invalid portion: ${portion}. Portion must be a number between 0 and 1.`);
    }

    // Validate exit price
    if (typeof exitPrice !== 'number' || exitPrice <= 0) {
      throw new Error(`Invalid exit price: ${exitPrice}. Exit price must be a positive number.`);
    }

    const remainingSize = this.remainingSize - portion;
    if (remainingSize < 0) {
      throw new Error(`Cannot exit ${portion} of position. Only ${this.remainingSize} remaining.`);
    }

    const profitLoss = ((exitPrice - this.entryPrice) / this.entryPrice) * 100;
    
    const partialExit = {
      portion,
      exitPrice,
      profitLoss,
      timestamp: Date.now()
    };

    this.partialExits.push(partialExit);
    this.remainingSize = remainingSize;

    // Emit partial exit event
    this.emit('partialExit', this);

    return this;
  }

  close(exitPrice) {
    // Validate exit price
    if (typeof exitPrice !== 'number' || exitPrice <= 0) {
      throw new Error(`Invalid exit price: ${exitPrice}. Exit price must be a positive number.`);
    }

    // Ensure position isn't already closed
    if (this.closedAt) {
      throw new Error('Position is already closed');
    }

    this.closedAt = Date.now();
    this.exitPrice = exitPrice;
    this.finalProfitLoss = ((exitPrice - this.entryPrice) / this.entryPrice) * 100;

    // Emit close event
    this.emit('closed', this);

    return this;
  }

  getProfitLoss() {
    return ((this.currentPrice - this.entryPrice) / this.entryPrice) * 100;
  }

  getHoldTime() {
    return Math.round((Date.now() - this.entryTime) / 1000); // in seconds
  }
}

module.exports = Position;
