const EventEmitter = require('events');
const Trader = require('./Trader');

class Token extends EventEmitter {
  constructor({ mint, symbol, config, priceManager, statsLogger, stateManager }) {
    super();
    this.mint = mint;
    this.symbol = symbol;
    this.config = config;
    this.priceManager = priceManager;
    this.statsLogger = statsLogger;
    this.stateManager = stateManager;

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

    // Initialize token state
    if (this.stateManager) {
      this.stateManager.addToken(this);
    }
  }

  getOrCreateTrader(publicKey) {
    if (!this.traders.has(publicKey)) {
      this.traders.set(publicKey, new Trader(publicKey));
    }
    return this.traders.get(publicKey);
  }

  update(data) {
    try {
      if (!data || !data.mint || !data.txType) {
        throw new Error('Invalid token data received');
      }

      // Handle token creation
      if (data.txType === 'create') {
        this.symbol = data.symbol;
        this.name = data.name;
        this.uri = data.uri;
        
        const creator = this.getOrCreateTrader(data.traderPublicKey);
        creator.addTrade({
          mint: this.mint,
          txType: 'create',
          tokenAmount: data.initialBuy,
          newTokenBalance: data.initialBuy,
          signature: data.signature
        });

        // Token state is already initialized in constructor
      }
      
      // Handle buys and sells
      if (data.txType === 'buy' || data.txType === 'sell') {
        const trader = this.getOrCreateTrader(data.traderPublicKey);
        trader.addTrade({
          mint: this.mint,
          txType: data.txType,
          tokenAmount: data.tokenAmount,
          newTokenBalance: data.newTokenBalance,
          signature: data.signature
        });

        // Update token state based on market conditions
        if (this.stateManager) {
          const currentState = this.stateManager.getTokenState(this.mint);
          if (currentState) {
            const marketConditions = this.getMarketConditions();
            const volumeProfile = this.getVolumeProfile();
            
            // Update metrics
            const metrics = {
              marketConditions,
              volumeProfile,
              currentPrice: this.currentPrice,
              marketCapSol: this.marketCapSol
            };

            // State transition logic
            if (currentState.state === 'heatingUp') {
              const timeInState = Date.now() - currentState.stateEnteredAt;
              const volumeThreshold = this.config.TOKEN_MANAGER?.VOLUME_THRESHOLD ?? 1; // SOL
              const heatingPeriod = this.config.TOKEN_MANAGER?.HEATING_PERIOD ?? 300000; // 5 minutes
              
              if (timeInState >= heatingPeriod && this.volume > volumeThreshold) {
                this.stateManager.updateTokenState(this, 'active', metrics);
              }
            } else if (currentState.state === 'active') {
              // Check for potential drawdown
              if (marketConditions.trend === 'bearish' && marketConditions.strength > 0.7) {
                this.stateManager.updateTokenState(this, 'drawdown', metrics);
              }
            } else if (currentState.state === 'drawdown') {
              // Check for recovery
              if (marketConditions.trend === 'bullish' && marketConditions.strength > 0.5) {
                this.stateManager.updateTokenState(this, 'active', metrics);
              }
            }
          }
        }
      }

      // Update bonding curve data
      if (data.vTokensInBondingCurve !== undefined) {
        this.bondingCurveTokens = data.vTokensInBondingCurve;
      }
      if (data.vSolInBondingCurve !== undefined) {
        this.solInBondingCurve = data.vSolInBondingCurve;
      }
      if (data.marketCapSol !== undefined) {
        this.marketCapSol = data.marketCapSol;
      }

      // Calculate and update derived metrics
      this.calculateSupply();
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

  calculateSupply() {
    if (this.bondingCurveTokens !== null) {
      this.supply = this.bondingCurveTokens + Array.from(this.traders.values())
        .reduce((total, trader) => total + trader.getTokenBalance(this.mint), 0);
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

  updatePrice(price) {
    this.currentPrice = price;
    this.priceHistory.push(price);
    
    // Keep price history within window
    const maxHistoryLength = this.config.TOKEN_MANAGER?.PRICE_HISTORY_LENGTH ?? 1000;
    if (this.priceHistory.length > maxHistoryLength) {
      this.priceHistory.shift();
    }
    
    this.emit('priceUpdate', {
      mint: this.mint,
      price: price,
      timestamp: new Date()
    });
  }

  updateVolume(volume) {
    this.volume = volume;
    this.volumeHistory.push({
      volume,
      timestamp: new Date()
    });
    
    // Keep volume history within window
    const maxHistoryLength = this.config.TOKEN_MANAGER?.VOLUME_HISTORY_LENGTH ?? 1000;
    if (this.volumeHistory.length > maxHistoryLength) {
      this.volumeHistory.shift();
    }
    
    this.emit('volumeUpdate', {
      mint: this.mint,
      volume: volume,
      timestamp: new Date()
    });
  }
}

module.exports = Token;
