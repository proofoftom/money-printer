const EventEmitter = require('events');
const Trader = require('./Trader');

class Token extends EventEmitter {
  constructor({ mint, symbol, config, priceManager, statsLogger }) {
    super();
    this.mint = mint;
    this.symbol = symbol;
    this.config = config;
    this.priceManager = priceManager;
    this.statsLogger = statsLogger;

    this.currentPrice = null;
    this.priceHistory = [];
    this.volumeHistory = [];
    this.volume = 0;
    this.volume1m = 0;
    this.volume5m = 0;
    this.volume30m = 0;
    this.marketCapSol = null;
    this.supply = null;
    this.bondingCurveTokens = null;
    this.solInBondingCurve = null;
    
    // Track traders
    this.traders = new Map(); // publicKey -> Trader
    this.recentTrades = [];
    this.maxRecentTrades = 1000; // Keep last 1000 trades
  }

  getOrCreateTrader(publicKey) {
    if (!this.traders.has(publicKey)) {
      this.traders.set(publicKey, new Trader(publicKey));
    }
    return this.traders.get(publicKey);
  }

  calculateHolderSupply() {
    return Array.from(this.traders.values())
      .reduce((total, trader) => total + trader.getTokenBalance(this.mint), 0);
  }

  updatePrice(price) {
    if (!price || price <= 0) {
      throw new Error('Invalid price update');
    }

    this.currentPrice = price;
    this.priceHistory.push(price);

    // Maintain price history window
    if (this.priceHistory.length > this.config.TOKENS.VOLATILITY_WINDOW) {
      this.priceHistory.shift();
    }

    this.emit('priceUpdate', { price });
  }

  updateSupply(tradeData) {
    if (!tradeData) return;

    // Update trader's balance
    if (tradeData.traderPublicKey) {
      const trader = this.getOrCreateTrader(tradeData.traderPublicKey);
      trader.addTrade(tradeData);
    }

    // Update bonding curve tokens and SOL
    if (tradeData.vTokensInBondingCurve !== undefined) {
      this.bondingCurveTokens = tradeData.vTokensInBondingCurve;
    }
    if (tradeData.vSolInBondingCurve !== undefined) {
      this.solInBondingCurve = tradeData.vSolInBondingCurve;
    }

    // Calculate total supply from all holders plus bonding curve
    const holderSupply = this.calculateHolderSupply();
    if (holderSupply !== null && this.bondingCurveTokens !== null) {
      this.supply = holderSupply + this.bondingCurveTokens;
    }
  }

  update(tradeData) {
    try {
      if (!tradeData) {
        throw new Error('Invalid trade data received');
      }

      // Update price if available
      if (tradeData.price) {
        this.updatePrice(tradeData.price);
      }

      // Update volume if this is a trade
      if (tradeData.txType === 'buy' || tradeData.txType === 'sell') {
        this.updateVolume({ volume: tradeData.tokenAmount });
      }

      // Update market cap if available
      if (tradeData.marketCapSol) {
        this.marketCapSol = tradeData.marketCapSol;
      }

      // Update supply components
      this.updateSupply(tradeData);

      this.updateTraderData(tradeData);
      this.addToRecentTrades(tradeData);
      this.emit('tokenUpdated', this);
    } catch (error) {
      this.emit('error', {
        component: 'Token',
        method: 'update',
        error: error.message,
        mint: this.mint
      });
    }
  }

  updateVolume(volumeData) {
    if (!volumeData || volumeData.volume === undefined || volumeData.volume === null || volumeData.volume < 0) {
      throw new Error('Invalid volume update');
    }

    this.volume = volumeData.volume;
    if (volumeData.volume1m) this.volume1m = volumeData.volume1m;
    if (volumeData.volume5m) this.volume5m = volumeData.volume5m;
    if (volumeData.volume30m) this.volume30m = volumeData.volume30m;

    this.volumeHistory.push({
      ...volumeData,
      timestamp: Date.now()
    });

    // Maintain volume history window
    if (this.volumeHistory.length > this.config.TOKENS.VOLUME_WINDOW) {
      this.volumeHistory.shift();
    }

    this.emit('volumeUpdate', {
      volume: volumeData.volume,
      timestamp: Date.now()
    });
  }

  updateTraderData(tradeData) {
    try {
      const { traderPublicKey, tokenAmount, price, timestamp, type } = tradeData;
      
      if (!this.traders.has(traderPublicKey)) {
        this.traders.set(traderPublicKey, {
          trades: [],
          balance: 0,
          firstTrade: timestamp,
          lastTrade: timestamp,
          totalVolume: 0
        });
      }

      const trader = this.traders.get(traderPublicKey);
      trader.lastTrade = timestamp;
      trader.totalVolume += tokenAmount * price;
      
      if (type === 'buy') {
        trader.balance += tokenAmount;
      } else if (type === 'sell') {
        trader.balance -= tokenAmount;
      }

      trader.trades.push({
        type,
        amount: tokenAmount,
        price,
        timestamp,
        priceImpact: this.calculatePriceImpact(tradeData)
      });
    } catch (error) {
      this.emit('error', {
        component: 'Token',
        method: 'updateTraderData',
        error: error.message,
        mint: this.mint
      });
    }
  }

  addToRecentTrades(tradeData) {
    try {
      this.recentTrades.unshift({
        ...tradeData,
        priceImpact: this.calculatePriceImpact(tradeData)
      });

      if (this.recentTrades.length > this.maxRecentTrades) {
        this.recentTrades.pop();
      }
    } catch (error) {
      this.emit('error', {
        component: 'Token',
        method: 'addToRecentTrades',
        error: error.message,
        mint: this.mint
      });
    }
  }

  calculatePriceImpact(tradeData) {
    try {
      if (!this.recentTrades.length) return 0;
      
      const prevPrice = this.recentTrades[0]?.price || this.currentPrice;
      const currentPrice = tradeData.price;
      
      return ((currentPrice - prevPrice) / prevPrice) * 100;
    } catch (error) {
      this.emit('error', {
        component: 'Token',
        method: 'calculatePriceImpact',
        error: error.message,
        mint: this.mint
      });
      return 0;
    }
  }

  getRecentTrades(hours = 24) {
    try {
      const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);
      return this.recentTrades.filter(trade => 
        new Date(trade.timestamp).getTime() > cutoffTime
      );
    } catch (error) {
      this.emit('error', {
        component: 'Token',
        method: 'getRecentTrades',
        error: error.message,
        mint: this.mint
      });
      return [];
    }
  }

  getTraderMetrics() {
    try {
      const metrics = {
        totalTraders: this.traders.size,
        activeTraders: 0,
        whaleTraders: 0,
        tradingVolume24h: 0,
        averageTradeSize: 0,
        priceImpact: {
          positive: 0,
          negative: 0,
          average: 0
        }
      };

      const recentTrades = this.getRecentTrades(24);
      const totalValue = this.currentPrice * this.supply;
      const whaleThreshold = totalValue * 0.01; // 1% of total value

      this.traders.forEach(trader => {
        if (trader.balance > 0) {
          metrics.activeTraders++;
        }

        const traderValue = trader.balance * this.currentPrice;
        if (traderValue > whaleThreshold) {
          metrics.whaleTraders++;
        }
      });

      if (recentTrades.length > 0) {
        metrics.tradingVolume24h = recentTrades.reduce((sum, trade) => 
          sum + (trade.tokenAmount * trade.price), 0
        );

        metrics.averageTradeSize = metrics.tradingVolume24h / recentTrades.length;

        const impacts = recentTrades.map(trade => trade.priceImpact);
        metrics.priceImpact.positive = impacts.filter(impact => impact > 0).length;
        metrics.priceImpact.negative = impacts.filter(impact => impact < 0).length;
        metrics.priceImpact.average = impacts.reduce((sum, impact) => sum + impact, 0) / impacts.length;
      }

      return metrics;
    } catch (error) {
      this.emit('error', {
        component: 'Token',
        method: 'getTraderMetrics',
        error: error.message,
        mint: this.mint
      });
      return null;
    }
  }

  getTraders() {
    return Array.from(this.traders.values());
  }

  getVolatility() {
    if (this.priceHistory.length < 2) return 0;

    const returns = [];
    for (let i = 1; i < this.priceHistory.length; i++) {
      const returnPct = (this.priceHistory[i] - this.priceHistory[i-1]) / this.priceHistory[i-1];
      returns.push(returnPct);
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }

  getVolumeProfile() {
    if (this.volumeHistory.length < 2) {
      return { trend: 'stable', dropPercentage: 0 };
    }

    const currentVolume = this.volumeHistory[this.volumeHistory.length - 1].volume;
    const previousVolumes = this.volumeHistory.slice(0, -1).map(v => v.volume);
    const avgVolume = previousVolumes.reduce((a, b) => a + b, 0) / previousVolumes.length;

    const dropPercentage = ((avgVolume - currentVolume) / avgVolume) * 100;
    let trend = 'stable';

    if (dropPercentage > 20) trend = 'dropping';
    else if (dropPercentage < -20) trend = 'rising';

    return { trend, dropPercentage };
  }

  getMarketConditions() {
    if (this.priceHistory.length < 2) {
      return { trend: 'neutral', strength: 0.5 };
    }

    const priceChanges = [];
    for (let i = 1; i < this.priceHistory.length; i++) {
      const change = (this.priceHistory[i] - this.priceHistory[i-1]) / this.priceHistory[i-1];
      priceChanges.push(change);
    }

    const avgChange = priceChanges.reduce((a, b) => a + b, 0) / priceChanges.length;
    const strength = Math.min(Math.abs(avgChange), 1);
    let trend = 'neutral';

    if (avgChange > 0.01) trend = 'bullish';
    else if (avgChange < -0.01) trend = 'bearish';

    return { trend, strength };
  }

  getMarketCorrelation() {
    if (!this.priceManager || !this.priceManager.getPriceHistory || this.priceHistory.length < 2) {
      return 0;
    }

    const marketPrices = this.priceManager.getPriceHistory();
    if (!marketPrices || marketPrices.length < 2) return 0;

    // Ensure we have the same number of data points
    const n = Math.min(this.priceHistory.length, marketPrices.length);
    const tokenReturns = [];
    const marketReturns = [];

    for (let i = 1; i < n; i++) {
      tokenReturns.push((this.priceHistory[i] - this.priceHistory[i-1]) / this.priceHistory[i-1]);
      marketReturns.push((marketPrices[i] - marketPrices[i-1]) / marketPrices[i-1]);
    }

    // Calculate correlation coefficient
    const tokenMean = tokenReturns.reduce((a, b) => a + b, 0) / tokenReturns.length;
    const marketMean = marketReturns.reduce((a, b) => a + b, 0) / marketReturns.length;

    let numerator = 0;
    let tokenDenominator = 0;
    let marketDenominator = 0;

    for (let i = 0; i < tokenReturns.length; i++) {
      const tokenDiff = tokenReturns[i] - tokenMean;
      const marketDiff = marketReturns[i] - marketMean;
      numerator += tokenDiff * marketDiff;
      tokenDenominator += tokenDiff * tokenDiff;
      marketDenominator += marketDiff * marketDiff;
    }

    const denominator = Math.sqrt(tokenDenominator * marketDenominator);
    return denominator === 0 ? 0 : numerator / denominator;
  }
}

module.exports = Token;
