const EventEmitter = require('events');
const config = require('../../utils/config');

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
    
    // Recovery metrics
    this.recoveryStrength = 0;
    this.buyPressure = 0;
    this.marketStructure = 'unknown';
    this.recoveryPhase = 'none'; // none, accumulation, expansion, distribution
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
    
    // Use volume1m for more accurate short-term volume analysis
    const volumeData = this.volumeHistory.map(v => v.volume1m);
    const maxVolume = Math.max(...volumeData);
    const minVolume = Math.min(...volumeData);
    const avgVolume = volumeData.reduce((a, b) => a + b, 0) / volumeData.length;
    
    return {
      maxVolume,
      minVolume,
      avgVolume,
      volumeStability: (maxVolume - minVolume) / avgVolume,
      recentTrend: this.calculateVolumeStrength()
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
    
    // Use volume1m for more accurate short-term volume strength
    const volumes = this.volumeHistory.map(v => v.volume1m);
    const firstHalf = volumes.slice(0, Math.floor(volumes.length / 2));
    const secondHalf = volumes.slice(Math.floor(volumes.length / 2));
    
    const firstHalfAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    
    if (secondHalfAvg > firstHalfAvg * 1.2) return 'increasing';
    if (secondHalfAvg < firstHalfAvg * 0.8) return 'decreasing';
    return 'stable';
  }

  calculateRecoveryMetrics() {
    if (!this.candleHistory || this.candleHistory.length < 5) return null;
    
    // Calculate recovery strength based on price action and volume
    const recentCandles = this.candleHistory.slice(-5);
    const priceChange = (this.currentPrice - this.lowestPrice) / this.lowestPrice;
    const volumeStrength = this.calculateVolumeStrength();
    
    this.recoveryStrength = priceChange * (volumeStrength === 'increasing' ? 1.2 : 
                                         volumeStrength === 'stable' ? 1.0 : 0.8);
    
    // Calculate buy pressure
    const buyCandles = recentCandles.filter(c => c.close > c.open).length;
    const totalVolume = recentCandles.reduce((sum, c) => sum + c.volume, 0);
    const buyVolume = recentCandles.filter(c => c.close > c.open)
                                 .reduce((sum, c) => sum + c.volume, 0);
    
    this.buyPressure = (buyCandles / recentCandles.length) * (buyVolume / totalVolume);
    
    // Analyze market structure
    const highs = recentCandles.map(c => c.high);
    const lows = recentCandles.map(c => c.low);
    const higherHighs = highs.slice(1).filter((h, i) => h > highs[i]).length;
    const higherLows = lows.slice(1).filter((l, i) => l > lows[i]).length;
    
    if (higherHighs >= 3 && higherLows >= 2) {
      this.marketStructure = 'bullish';
    } else if (higherHighs <= 1 && higherLows <= 1) {
      this.marketStructure = 'bearish';
    } else {
      this.marketStructure = 'neutral';
    }
    
    // Determine recovery phase
    if (this.recoveryStrength < 0.1) {
      this.recoveryPhase = 'none';
    } else if (this.recoveryStrength < 0.3 && this.buyPressure > 0.6) {
      this.recoveryPhase = 'accumulation';
    } else if (this.recoveryStrength >= 0.3 && this.marketStructure === 'bullish') {
      this.recoveryPhase = 'expansion';
    } else if (this.recoveryStrength >= 0.5 && this.buyPressure < 0.4) {
      this.recoveryPhase = 'distribution';
    }
    
    return {
      recoveryStrength: this.recoveryStrength,
      buyPressure: this.buyPressure,
      marketStructure: this.marketStructure,
      recoveryPhase: this.recoveryPhase
    };
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

      // Store volume data (in SOL)
      this.volume = volumeData.volume || 0;
      this.volume1m = volumeData.volume1m || 0;
      this.volume5m = volumeData.volume5m || 0;
      this.volume30m = volumeData.volume30m || 0;

      this.volumeHistory.push({
        timestamp: Date.now(),
        volume: this.volume,
        volume1m: this.volume1m,
        volume5m: this.volume5m,
        volume30m: this.volume30m
      });

      // Keep last 5 minutes of volume history
      const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
      this.volumeHistory = this.volumeHistory.filter(v => v.timestamp > fiveMinutesAgo);
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

    if (candleData) {
      // Validate candle data
      if (!candleData.high || !candleData.low || !candleData.open || !candleData.close) {
        throw new Error('Invalid candle data: Missing required OHLC values');
      }
      this.candleHistory.push(candleData);
    }

    // Update recovery metrics
    if (candleData) {
      this.calculateRecoveryMetrics();
    }

    // Emit update event with current state
    this.emit('updated', {
      position: this,
      price: currentPrice,
      volumes: {
        volume: this.volume,
        volume1m: this.volume1m,
        volume5m: this.volume5m,
        volume30m: this.volume30m
      }
    });
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
    if (!this.currentPrice || !this.entryPrice) return 0;
    return ((this.currentPrice - this.entryPrice) / this.entryPrice) * 100;
  }

  getHoldTime() {
    return Math.round((Date.now() - this.entryTime) / 1000); // in seconds
  }
}

module.exports = Position;
