const EventEmitter = require('events');

class Token extends EventEmitter {
  constructor(tokenData) {
    super();
    this.mint = tokenData.mint;
    this.name = tokenData.name;
    this.symbol = tokenData.symbol;
    this.uri = tokenData.uri;
    this.traderPublicKey = tokenData.traderPublicKey;
    this.initialBuy = tokenData.initialBuy;
    this.vTokensInBondingCurve = tokenData.vTokensInBondingCurve;
    this.vSolInBondingCurve = tokenData.vSolInBondingCurve;
    this.marketCapSol = tokenData.marketCapSol;
    this.signature = tokenData.signature;
    this.bondingCurveKey = tokenData.bondingCurveKey;
    
    this.state = 'new';
    this.highestMarketCap = this.marketCapSol;
    this.drawdownLow = null;
    this.holders = new Map();
    this.creatorInitialHoldings = 0;
    
    // Volume and trade tracking
    this.volumeData = {
      trades: [],
      lastCleanup: Date.now(),
      cleanupInterval: 5 * 60 * 1000 // Cleanup every 5 minutes
    };

    // Initialize creator as holder if initial balance provided
    if (tokenData.newTokenBalance) {
      this.holders.set(tokenData.traderPublicKey, tokenData.newTokenBalance);
      this.creatorInitialHoldings = tokenData.newTokenBalance;
    } else if (tokenData.initialBuy) {
      this.holders.set(tokenData.traderPublicKey, tokenData.initialBuy);
      this.creatorInitialHoldings = tokenData.initialBuy;
    }
  }

  setState(newState) {
    const oldState = this.state;
    this.state = newState;
    if (newState === 'drawdown') {
      this.drawdownLow = this.marketCapSol;
    }
    this.emit('stateChanged', { token: this, from: oldState, to: newState });
  }

  update(data) {
    if (data.marketCapSol) {
      if (data.marketCapSol > this.highestMarketCap) {
        this.highestMarketCap = data.marketCapSol;
      }
      if (this.state === 'drawdown' && data.marketCapSol < this.drawdownLow) {
        this.drawdownLow = data.marketCapSol;
      }
      this.marketCapSol = data.marketCapSol;
    }
    
    if (data.vTokensInBondingCurve) {
      this.vTokensInBondingCurve = data.vTokensInBondingCurve;
    }
    
    if (data.vSolInBondingCurve) {
      this.vSolInBondingCurve = data.vSolInBondingCurve;
    }

    // Update volume if trade data is provided
    if (data.tradeAmount) {
      this.updateVolume(data.tradeAmount);
    }

    if (data.traderPublicKey && typeof data.newTokenBalance !== 'undefined') {
      if (data.newTokenBalance > 0) {
        this.holders.set(data.traderPublicKey, data.newTokenBalance);
      } else {
        this.holders.delete(data.traderPublicKey);
      }
    }
  }

  updateVolume(tradeAmount) {
    const now = Date.now();
    
    // Add new trade
    this.volumeData.trades.push({
      amount: tradeAmount,
      timestamp: now
    });

    // Cleanup old trades periodically
    if (now - this.volumeData.lastCleanup > this.volumeData.cleanupInterval) {
      const thirtyMinutesAgo = now - 30 * 60 * 1000;
      this.volumeData.trades = this.volumeData.trades.filter(trade => 
        trade.timestamp > thirtyMinutesAgo
      );
      this.volumeData.lastCleanup = now;
    }
  }

  getVolume(interval = '1m') {
    const now = Date.now();
    let cutoffTime;

    switch(interval) {
      case '1m':
        cutoffTime = now - 60 * 1000;
        break;
      case '5m':
        cutoffTime = now - 5 * 60 * 1000;
        break;
      case '30m':
        cutoffTime = now - 30 * 60 * 1000;
        break;
      default:
        throw new Error('Invalid volume interval. Use "1m", "5m", or "30m"');
    }

    return this.volumeData.trades
      .filter(trade => trade.timestamp > cutoffTime)
      .reduce((sum, trade) => sum + trade.amount, 0);
  }

  getTradeStats(interval = '5m') {
    const now = Date.now();
    const cutoffTime = now - (parseInt(interval) * 60 * 1000);
    const periodTrades = this.volumeData.trades.filter(trade => trade.timestamp > cutoffTime);
    
    if (periodTrades.length === 0) {
      return {
        count: 0,
        volume: 0,
        averageSize: 0,
        largestTrade: 0,
        smallestTrade: 0
      };
    }

    const volume = periodTrades.reduce((sum, trade) => sum + trade.amount, 0);
    const largestTrade = Math.max(...periodTrades.map(trade => trade.amount));
    const smallestTrade = Math.min(...periodTrades.map(trade => trade.amount));

    return {
      count: periodTrades.length,
      volume,
      averageSize: volume / periodTrades.length,
      largestTrade,
      smallestTrade
    };
  }

  getDrawdownPercentage() {
    if (!this.highestMarketCap || !this.marketCapSol) return 0;
    return ((this.highestMarketCap - this.marketCapSol) / this.highestMarketCap) * 100;
  }

  getRecoveryPercentage() {
    if (this.state !== 'drawdown' || !this.drawdownLow || !this.marketCapSol) return 0;
    return ((this.marketCapSol - this.drawdownLow) / this.drawdownLow) * 100;
  }

  getHolderCount() {
    return this.holders.size;
  }

  getTotalTokensHeld() {
    const holdersTotal = Array.from(this.holders.values()).reduce((sum, balance) => sum + balance, 0);
    return holdersTotal + this.vTokensInBondingCurve;
  }

  getCreatorHoldings() {
    return this.holders.get(this.traderPublicKey) || 0;
  }

  hasCreatorSoldAll() {
    return this.getCreatorHoldings() === 0;
  }

  getCreatorSellPercentage() {
    if (!this.creatorInitialHoldings) return 0;
    const currentCreatorHoldings = this.getCreatorHoldings();
    return ((this.creatorInitialHoldings - currentCreatorHoldings) / this.creatorInitialHoldings) * 100;
  }

  getTopHolders(count = 5) {
    return Array.from(this.holders.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, count)
      .map(([address, balance]) => ({ address, balance }));
  }

  getTopHolderConcentration(topN = 10) {
    const totalSupply = this.getTotalTokensHeld();
    if (totalSupply === 0) return 0;

    const topHolders = this.getTopHolders(topN);
    const topHoldersBalance = topHolders.reduce((sum, { balance }) => sum + balance, 0);
    
    // Include bonding curve in concentration if it would be among top holders
    const bondingCurveBalance = this.vTokensInBondingCurve;
    let adjustedTopBalance = topHoldersBalance;
    
    // Check if bonding curve balance would be among top holders
    const smallestTopHolder = topHolders.length > 0 ? topHolders[topHolders.length - 1].balance : 0;
    if (bondingCurveBalance > smallestTopHolder) {
      // Add bonding curve balance and remove the smallest top holder if we've hit our limit
      adjustedTopBalance = topHoldersBalance;
      if (topHolders.length >= topN) {
        adjustedTopBalance -= smallestTopHolder;
      }
      adjustedTopBalance += bondingCurveBalance;
    }

    return (adjustedTopBalance / totalSupply) * 100;
  }

  isHeatingUp(threshold) {
    return this.marketCapSol > threshold;
  }

  isFirstPump(threshold) {
    return this.marketCapSol > threshold;
  }

  isDead(threshold) {
    return this.marketCapSol < threshold;
  }
}

module.exports = Token;
