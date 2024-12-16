const EventEmitter = require("events");
const Token = require("./Token");
const Trader = require("./Trader");
const config = require("./config");

class TokenTracker extends EventEmitter {
  constructor(
    safetyChecker,
    positionManager,
    priceManager,
    webSocketManager
  ) {
    super();
    this.safetyChecker = safetyChecker;
    this.positionManager = positionManager;
    this.priceManager = priceManager;
    this.webSocketManager = webSocketManager;
    this.tokens = new Map();
    this.traders = new Map(); // Track traders across all tokens
  }

  getOrCreateTrader(publicKey) {
    if (!this.traders.has(publicKey)) {
      const trader = new Trader(publicKey);
      this.traders.set(publicKey, trader);

      // Listen for trader events
      trader.on('tradeAdded', ({ mint, trade }) => {
        this.emit('traderTradeAdded', { trader, mint, trade });
      });
    }
    return this.traders.get(publicKey);
  }

  handleNewToken(tokenData) {
    const token = new Token(tokenData);

    // Check market cap threshold before processing
    const marketCapUSD = this.priceManager.solToUSD(token.marketCapSol);
    if (marketCapUSD >= config.THRESHOLDS.MAX_MARKET_CAP_USD) {
      console.info(
        `Ignoring new token ${token.symbol || token.mint.slice(0, 8)} - Market cap too high: $${marketCapUSD.toFixed(2)} (${token.marketCapSol.toFixed(2)} SOL)`
      );
      return null;
    }

    this.tokens.set(token.mint, token);

    token.on("stateChanged", ({ token, from, to }) => {
      this.emit("tokenStateChanged", { token, from, to });
      
      // Unsubscribe from WebSocket updates when token enters dead state
      if (to === "dead") {
        console.log(`Token ${token.symbol || token.mint.slice(0, 8)} marked as dead, unsubscribing from updates`);
        this.webSocketManager.unsubscribeFromToken(token.mint);
      }
    });

    token.on("readyForPosition", async (token) => {
      // Check if we already have a position for this token
      if (this.positionManager.getPosition(token.mint)) {
        console.log(`Position already exists for ${token.symbol || token.mint.slice(0, 8)}, skipping`);
        return;
      }

      const success = await this.positionManager.openPosition(
        token.mint,
        token.marketCapSol,
        token.volatility || 0
      );
      if (success) {
        token.setState("inPosition");
        this.emit("positionOpened", token);
      }
    });

    token.on("unsafeRecovery", (data) => {
      this.emit("unsafeRecovery", data);
    });

    token.on("recoveryGainTooHigh", (data) => {
      this.emit("recoveryGainTooHigh", data);
      const { token, gainPercentage } = data;
      console.warn(
        `Token ${token.symbol} (${token.mint}) recovery gain too high: ${gainPercentage.toFixed(2)}%`
      );
    });

    // Let handleTokenUpdate manage all state transitions
    this.handleTokenUpdate(tokenData);
    this.emit("tokenAdded", token);
    return token;
  }

  async handleTokenUpdate(tokenData) {
    try {
      const token = this.tokens.get(tokenData.mint);
      if (!token || typeof token.update !== 'function') {
        throw new Error('Invalid token object received');
      }
      await token.update();
      this.emit('tokenUpdated', token);
    } catch (error) {
      this.emit('error', {
        component: 'TokenTracker',
        method: 'handleTokenUpdate',
        error: error.message,
        token: tokenData?.mint
      });
    }
  }

  getToken(mint) {
    return this.tokens.get(mint);
  }

  getTokensByState(state) {
    return Array.from(this.tokens.values()).filter(
      (token) => token.state === state
    );
  }

  async getTraderMetrics() {
    try {
      const metrics = {
        basic: {
          activeTraders: 0,
          totalTrades: 0,
          uniqueTraders: this.traders.size,
          crossTokenTraders: 0
        },
        profitability: {
          topTraders: [],
          averageProfitPerTrade: 0,
          profitByTraderType: {
            whale: 0,
            retail: 0,
            suspicious: 0
          }
        },
        behavior: {
          averageHoldingTime: 0,
          tradingFrequency: {
            high: 0,
            medium: 0,
            low: 0
          },
          correlatedTraders: []
        },
        risk: {
          whaleConcentration: 0,
          suspiciousActivity: 0,
          volatilityImpact: 0
        }
      };

      // Calculate basic metrics
      const traders = Array.from(this.traders.values());
      metrics.basic.activeTraders = traders.filter(trader => 
        Array.from(this.tokens.keys()).some(mint => trader.getTokenBalance(mint) > 0)
      ).length;

      // Calculate total trades and cross-token activity
      traders.forEach(trader => {
        const traderTrades = Array.from(this.tokens.keys()).reduce((total, mint) => {
          const history = trader.getTradeHistory(mint);
          return total + (history?.length || 0);
        }, 0);
        
        metrics.basic.totalTrades += traderTrades;
        
        const tradedTokens = Array.from(this.tokens.keys())
          .filter(mint => (trader.getTradeHistory(mint)?.length || 0) > 0);
        
        if (tradedTokens.length > 1) {
          metrics.basic.crossTokenTraders++;
        }

        // Calculate holding time and frequency
        const holdingTimes = this.calculateHoldingTimes(trader);
        metrics.behavior.averageHoldingTime += holdingTimes.average;
        
        if (traderTrades > 50) metrics.behavior.tradingFrequency.high++;
        else if (traderTrades > 10) metrics.behavior.tradingFrequency.medium++;
        else metrics.behavior.tradingFrequency.low++;
      });

      // Normalize average holding time
      metrics.behavior.averageHoldingTime /= traders.length || 1;

      // Calculate risk metrics
      metrics.risk = this.calculateRiskMetrics();

      // Find correlated traders
      metrics.behavior.correlatedTraders = this.findCorrelatedTraders();

      return metrics;
    } catch (error) {
      this.emit('error', {
        component: 'TokenTracker',
        method: 'getTraderMetrics',
        error: error.message
      });
      return null;
    }
  }

  calculateHoldingTimes(trader) {
    try {
      let totalHoldingTime = 0;
      let tradeCount = 0;

      Array.from(this.tokens.keys()).forEach(mint => {
        const history = trader.getTradeHistory(mint);
        if (!history) return;

        for (let i = 0; i < history.length - 1; i += 2) {
          const buyTime = new Date(history[i].timestamp);
          const sellTime = new Date(history[i + 1]?.timestamp || Date.now());
          totalHoldingTime += sellTime - buyTime;
          tradeCount++;
        }
      });

      return {
        average: tradeCount ? totalHoldingTime / tradeCount : 0,
        total: totalHoldingTime
      };
    } catch (error) {
      this.emit('error', {
        component: 'TokenTracker',
        method: 'calculateHoldingTimes',
        error: error.message
      });
      return { average: 0, total: 0 };
    }
  }

  calculateRiskMetrics() {
    try {
      const totalValue = Array.from(this.tokens.values())
        .reduce((sum, token) => sum + (token.price * token.totalSupply), 0);

      const whaleThreshold = totalValue * 0.1; // 10% of total value
      let whaleHoldings = 0;
      let suspiciousCount = 0;

      Array.from(this.traders.values()).forEach(trader => {
        const traderValue = Array.from(this.tokens.keys())
          .reduce((sum, mint) => {
            const token = this.tokens.get(mint);
            return sum + (trader.getTokenBalance(mint) * token.price);
          }, 0);

        if (traderValue > whaleThreshold) {
          whaleHoldings += traderValue;
        }

        if (this.isSuspiciousTrader(trader)) {
          suspiciousCount++;
        }
      });

      return {
        whaleConcentration: whaleHoldings / totalValue,
        suspiciousActivity: suspiciousCount / this.traders.size,
        volatilityImpact: this.calculateVolatilityImpact()
      };
    } catch (error) {
      this.emit('error', {
        component: 'TokenTracker',
        method: 'calculateRiskMetrics',
        error: error.message
      });
      return {
        whaleConcentration: 0,
        suspiciousActivity: 0,
        volatilityImpact: 0
      };
    }
  }

  findCorrelatedTraders() {
    try {
      const correlations = [];
      const traders = Array.from(this.traders.values());
      
      for (let i = 0; i < traders.length; i++) {
        for (let j = i + 1; j < traders.length; j++) {
          const correlation = this.calculateTraderCorrelation(traders[i], traders[j]);
          if (correlation > 0.8) { // High correlation threshold
            correlations.push({
              trader1: traders[i].address,
              trader2: traders[j].address,
              correlation
            });
          }
        }
      }

      return correlations.slice(0, 10); // Return top 10 correlations
    } catch (error) {
      this.emit('error', {
        component: 'TokenTracker',
        method: 'findCorrelatedTraders',
        error: error.message
      });
      return [];
    }
  }

  calculateTraderCorrelation(trader1, trader2) {
    try {
      let matchingTrades = 0;
      let totalTrades = 0;

      Array.from(this.tokens.keys()).forEach(mint => {
        const history1 = trader1.getTradeHistory(mint);
        const history2 = trader2.getTradeHistory(mint);
        
        if (!history1 || !history2) return;

        history1.forEach(trade1 => {
          const matchingTrade = history2.find(trade2 => 
            Math.abs(new Date(trade1.timestamp) - new Date(trade2.timestamp)) < 300000 && // 5 minutes
            trade1.type === trade2.type
          );
          
          if (matchingTrade) matchingTrades++;
          totalTrades++;
        });
      });

      return totalTrades > 0 ? matchingTrades / totalTrades : 0;
    } catch (error) {
      this.emit('error', {
        component: 'TokenTracker',
        method: 'calculateTraderCorrelation',
        error: error.message
      });
      return 0;
    }
  }

  calculateVolatilityImpact() {
    try {
      let totalImpact = 0;
      const tokens = Array.from(this.tokens.values());
      
      tokens.forEach(token => {
        const recentTrades = token.getRecentTrades(24); // Last 24 hours
        if (!recentTrades.length) return;

        const priceChanges = recentTrades.map(trade => trade.priceImpact || 0);
        const volatility = this.calculateStandardDeviation(priceChanges);
        totalImpact += volatility;
      });

      return totalImpact / tokens.length;
    } catch (error) {
      this.emit('error', {
        component: 'TokenTracker',
        method: 'calculateVolatilityImpact',
        error: error.message
      });
      return 0;
    }
  }

  calculateStandardDeviation(values) {
    try {
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const squareDiffs = values.map(value => Math.pow(value - mean, 2));
      const avgSquareDiff = squareDiffs.reduce((sum, diff) => sum + diff, 0) / squareDiffs.length;
      return Math.sqrt(avgSquareDiff);
    } catch (error) {
      this.emit('error', {
        component: 'TokenTracker',
        method: 'calculateStandardDeviation',
        error: error.message
      });
      return 0;
    }
  }

  isSuspiciousTrader(trader) {
    // TO DO: implement logic to determine if a trader is suspicious
    return false;
  }
}

module.exports = TokenTracker;
