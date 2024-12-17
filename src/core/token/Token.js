const EventEmitter = require("events");
const config = require("../../utils/config");
const TraderManager = require("../trader/TraderManager");
const TokenStateManager = require("./TokenStateManager");
const errorLogger = require("../../monitoring/errorLoggerInstance");

class Token extends EventEmitter {
  constructor(tokenData) {
    super();
    this.mint = tokenData.mint;
    this.name = tokenData.name;
    this.symbol = tokenData.symbol;
    this.minted = tokenData.minted || Date.now();
    this.uri = tokenData.uri;
    this.traderPublicKey = tokenData.traderPublicKey;
    this.initialBuy = tokenData.initialBuy;
    this.vTokensInBondingCurve = tokenData.vTokensInBondingCurve;
    this.vSolInBondingCurve = tokenData.vSolInBondingCurve;
    this.marketCapSol = tokenData.marketCapSol;
    this.signature = tokenData.signature;
    this.bondingCurveKey = tokenData.bondingCurveKey;

    this.state = "new";
    this.highestMarketCap = this.marketCapSol;
    this.drawdownLow = null;
    this.unsafeReason = null;

    // Optimized price tracking with circular buffer
    this.priceBuffer = {
      data: new Array(30).fill(null),
      head: 0,
      size: 30,
      count: 0
    };

    // Enhanced metrics for pump detection
    this.pumpMetrics = {
      lastPumpTime: null,
      pumpCount: 0,
      highestGainRate: 0,
      volumeSpikes: [],
      priceAcceleration: 0,
      pumpTimes: []  // Array to track pump event timestamps
    };

    // Price tracking
    this.currentPrice = this.calculateTokenPrice();
    this.initialPrice = this.currentPrice;
    this.priceHistory = [{
      price: this.currentPrice,
      timestamp: Date.now()
    }];
    this.priceVolatility = 0;

    // Initialize managers
    this.traderManager = new TraderManager();
    this.stateManager = new TokenStateManager();
    
    // Forward state change events
    this.stateManager.on("stateChanged", ({ from, to }) => {
      this.emit("stateChanged", { token: this, from, to });
    });

    // Initialize creator as holder if initial balance provided
    if (tokenData.newTokenBalance || tokenData.initialBuy) {
      const balance = tokenData.newTokenBalance || tokenData.initialBuy;
      this.traderManager.getOrCreateTrader(tokenData.traderPublicKey, {
        isCreator: true,
        tokens: {
          [this.mint]: {
            balance,
            initialBalance: balance,
            firstSeen: Date.now(),
            lastActive: Date.now()
          }
        }
      });
    }

    // Initialize metrics
    this.metrics = {
      volumeData: {
        lastCleanup: Date.now(),
        cleanupInterval: 5 * 60 * 1000, // 5 minutes
        maxWalletVolumePercentage: 0,
        suspectedWashTradePercentage: 0
      }
    };

    // Initialize volume tracking
    this.volume1m = 0;
    this.volume5m = 0;
    this.volume30m = 0;
  }

  update(data) {
    const oldPrice = this.currentPrice;
    const now = Date.now();
    
    if (data.marketCapSol) {
      if (data.marketCapSol > this.highestMarketCap) {
        this.highestMarketCap = data.marketCapSol;
      }
      
      // Check if we're in drawdown and need to update drawdownLow
      if (this.state === "drawdown" || this.state === "unsafeRecovery") {
        // Initialize drawdownLow if not set
        if (this.drawdownLow === null) {
          this.drawdownLow = data.marketCapSol;
          const warning = new Error(`Initialized drawdownLow for token ${this.mint} in ${this.state} state`);
          errorLogger.logError(warning, 'Token.update', { state: this.state, marketCap: data.marketCapSol });
        }
        // Update drawdownLow if new market cap is lower
        else if (data.marketCapSol < this.drawdownLow) {
          this.drawdownLow = data.marketCapSol;
        }
      }
      
      this.marketCapSol = data.marketCapSol;
    }

    if (data.vTokensInBondingCurve) {
      this.vTokensInBondingCurve = data.vTokensInBondingCurve;
    }

    if (data.vSolInBondingCurve) {
      this.vSolInBondingCurve = data.vSolInBondingCurve;
    }

    // Update price tracking
    this.updatePriceMetrics();

    // Update wallet data if trade occurred
    if (data.tokenAmount) {
      const volumeInSol = Math.abs(data.tokenAmount * this.currentPrice);
      this.updateWalletActivity(data.traderPublicKey, {
        amount: data.tokenAmount,
        volumeInSol,
        priceChange: ((this.currentPrice - oldPrice) / oldPrice) * 100,
        timestamp: now,
        newBalance: data.newTokenBalance
      });
    }
    // Update wallet balance if no trade (e.g., transfer)
    else if (data.traderPublicKey && typeof data.newTokenBalance !== "undefined") {
      this.updateWalletBalance(data.traderPublicKey, data.newTokenBalance, now);
    }

    // Update all metrics including volume
    this.updateMetrics();

    // Emit price and volume updates together
    this.emit('priceUpdate', { 
      price: this.currentPrice, 
      acceleration: this.pumpMetrics.priceAcceleration,
      pumpMetrics: this.pumpMetrics,
      volume1m: this.volume1m,
      volume5m: this.volume5m,
      volume30m: this.volume30m
    });
  }

  updatePriceMetrics() {
    const now = Date.now();
    const newPrice = this.calculateTokenPrice();
    
    // Update circular buffer
    this.priceBuffer.data[this.priceBuffer.head] = {
      price: newPrice,
      timestamp: now
    };
    this.priceBuffer.head = (this.priceBuffer.head + 1) % this.priceBuffer.size;
    this.priceBuffer.count = Math.min(this.priceBuffer.count + 1, this.priceBuffer.size);
    
    // Calculate price acceleration (rate of price change)
    if (this.priceBuffer.count >= 3) {
      const idx1 = (this.priceBuffer.head - 1 + this.priceBuffer.size) % this.priceBuffer.size;
      const idx2 = (this.priceBuffer.head - 2 + this.priceBuffer.size) % this.priceBuffer.size;
      const idx3 = (this.priceBuffer.head - 3 + this.priceBuffer.size) % this.priceBuffer.size;
      
      const price1 = this.priceBuffer.data[idx1].price;
      const price2 = this.priceBuffer.data[idx2].price;
      const price3 = this.priceBuffer.data[idx3].price;
      
      const time1 = this.priceBuffer.data[idx1].timestamp;
      const time2 = this.priceBuffer.data[idx2].timestamp;
      const time3 = this.priceBuffer.data[idx3].timestamp;
      
      const rate1 = (price1 - price2) / (time1 - time2);
      const rate2 = (price2 - price3) / (time2 - time3);
      
      this.pumpMetrics.priceAcceleration = (rate1 - rate2) / ((time1 - time3) / 2000);
    }
    
    // Detect pump conditions
    const priceChange = ((newPrice - this.currentPrice) / this.currentPrice) * 100;
    const timeWindow = 60 * 1000; // 1 minute window
    
    if (priceChange > config.THRESHOLDS.PUMP && 
        (!this.pumpMetrics.lastPumpTime || now - this.pumpMetrics.lastPumpTime > timeWindow)) {
      this.pumpMetrics.pumpCount++;
      this.pumpMetrics.lastPumpTime = now;
      this.pumpMetrics.pumpTimes.push(now);  // Record pump timestamp
      
      const gainRate = priceChange / (timeWindow / 1000); // %/second
      this.pumpMetrics.highestGainRate = Math.max(this.pumpMetrics.highestGainRate, gainRate);
      
      // Track volume spike
      const recentVolume = this.getRecentVolume(timeWindow);
      this.pumpMetrics.volumeSpikes.push({
        timestamp: now,
        volume: recentVolume,
        priceChange
      });
      
      // Cleanup old volume spikes
      const cutoff = now - (5 * 60 * 1000); // Keep last 5 minutes
      this.pumpMetrics.volumeSpikes = this.pumpMetrics.volumeSpikes.filter(spike => 
        spike.timestamp > cutoff
      );
    }
    
    this.currentPrice = newPrice;
  }

  getRecentVolume(timeWindow) {
    const now = Date.now();
    const cutoff = now - timeWindow;
    let volume = 0;
    
    const traders = this.traderManager.getTraders();
    for (const trader of traders) {
      const recentTrades = trader.getTradesForToken(this.mint, cutoff);
      volume += recentTrades.reduce((sum, trade) => {
        return sum + Math.abs(trade.volumeInSol || 0);
      }, 0);
    }
    
    return volume;
  }

  updateWalletActivity(publicKey, tradeData) {
    const now = tradeData.timestamp;
    const trader = this.traderManager.getOrCreateTrader(publicKey);

    // Update trader data for this token
    trader.updateTokenBalance(this.mint, tradeData.newBalance);
    trader.recordTrade({
      mint: this.mint,
      amount: tradeData.amount,
      price: this.currentPrice,
      type: tradeData.amount > 0 ? 'buy' : 'sell',
      timestamp: now,
      volumeInSol: tradeData.volumeInSol
    });

    // Cleanup old trades periodically
    if (now - this.metrics.volumeData.lastCleanup > this.metrics.volumeData.cleanupInterval) {
      const cutoff = now - 30 * 60 * 1000; // 30 minutes
      this.traderManager.cleanupOldTrades(cutoff);
      this.metrics.volumeData.lastCleanup = now;
    }
  }

  updateWalletBalance(publicKey, newBalance, timestamp) {
    if (newBalance > 0) {
      const trader = this.traderManager.getOrCreateTrader(publicKey);
      trader.updateTokenBalance(this.mint, newBalance, timestamp);
    } else {
      const trader = this.traderManager.getTrader(publicKey);
      if (trader) {
        trader.updateTokenBalance(this.mint, 0, timestamp);
      }
    }
  }

  getHolderCount() {
    return this.traderManager.getHolderCountForToken(this.mint);
  }

  getTotalTokensHeld() {
    return this.traderManager.getTotalTokensHeldForToken(this.mint);
  }

  getTopHolderConcentration(topN = 10) {
    const totalSupply = this.getTotalSupply();
    if (totalSupply === 0) return 0;

    const topHolders = this.traderManager.getTopHoldersForToken(this.mint, topN);
    const topHoldersBalance = topHolders.reduce((sum, holder) => sum + holder.balance, 0);

    return (topHoldersBalance / totalSupply) * 100;
  }

  getTraderStats(interval = "5m") {
    const now = Date.now();
    const cutoffTime = now - (parseInt(interval) * 60 * 1000);
    const stats = this.traderManager.getTokenTraderStats(this.mint, cutoffTime);

    // Calculate suspicious activity metrics based on stats
    const suspiciousTraders = new Map();
    let totalSuspiciousVolume = 0;

    for (const [publicKey, traderStats] of Object.entries(stats.traderStats)) {
      const volumePercentage = (traderStats.volumeTotal / stats.totalVolume) * 100;
      const buyToSellRatio = traderStats.buyVolume / (traderStats.sellVolume || 1);
      const isSuspicious = (
        (volumePercentage > config.SAFETY.MAX_WALLET_VOLUME_PERCENTAGE) ||
        (traderStats.tradeCount > 10 && buyToSellRatio > 0.9 && buyToSellRatio < 1.1)
      );

      if (isSuspicious) {
        suspiciousTraders.set(publicKey, {
          volumePercentage,
          buyToSellRatio,
          tradeCount: traderStats.tradeCount,
          balance: traderStats.currentBalance,
          walletAge: traderStats.walletAge
        });
        totalSuspiciousVolume += traderStats.volumeTotal;
      }
    }

    return {
      totalVolume: stats.totalVolume,
      uniqueTraders: stats.uniqueTraders,
      maxWalletVolumePercentage: stats.maxWalletVolumePercentage,
      suspectedWashTradePercentage: stats.totalVolume > 0 ? 
        (totalSuspiciousVolume / stats.totalVolume) * 100 : 0,
      suspiciousTraders: Object.fromEntries(suspiciousTraders)
    };
  }

  updateMetrics() {
    // Update volume metrics
    this.volume1m = this.getRecentVolume(60 * 1000);     // 1 minute
    this.volume5m = this.getRecentVolume(5 * 60 * 1000); // 5 minutes
    this.volume30m = this.getRecentVolume(30 * 60 * 1000); // 30 minutes

    // Update price stats
    const priceStats = this.getPriceStats();
    this.priceVolatility = priceStats.volatility;

    // Update trader stats
    const traderStats = this.getTraderStats("5m");
    this.metrics.volumeData.maxWalletVolumePercentage = traderStats.maxWalletVolumePercentage;
    this.metrics.volumeData.suspectedWashTradePercentage = traderStats.suspectedWashTradePercentage;

    // Emit metrics update event for monitoring
    this.emit("metricsUpdated", {
      token: this.mint,
      priceStats,
      traderStats,
      volume: {
        volume1m: this.volume1m,
        volume5m: this.volume5m,
        volume30m: this.volume30m
      }
    });
  }

  hasCreatorSoldAll() {
    const creatorWallet = this.traderManager.getTrader(this.traderPublicKey);
    return creatorWallet ? creatorWallet.getTokenBalance(this.mint) === 0 : true;
  }

  getCreatorSellPercentage() {
    const creatorWallet = this.traderManager.getTrader(this.traderPublicKey);
    if (!creatorWallet) return 0;

    const initialBalance = creatorWallet.getInitialTokenBalance(this.mint);
    const currentBalance = creatorWallet.getTokenBalance(this.mint);
    return (
      ((initialBalance - currentBalance) /
        initialBalance) *
      100
    );
  }

  getTopHolders(count = 5) {
    return this.traderManager.getTopHoldersForToken(this.mint, count);
  }

  getTotalSupply() {
    // Total supply includes both held tokens and tokens in the liquidity pool
    return this.getTotalTokensHeld() + (this.vTokensInBondingCurve || 0);
  }

  getPriceStats() {
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    const recentPrices = this.priceBuffer.data.filter(p => p && p.timestamp > fiveMinutesAgo);

    if (recentPrices.length < 2) {
      return {
        volatility: 0,
        highestPrice: this.currentPrice,
        lowestPrice: this.currentPrice,
        priceChange: 0
      };
    }

    // Calculate price changes as percentages
    const changes = [];
    for (let i = 1; i < recentPrices.length; i++) {
      const change = ((recentPrices[i].price - recentPrices[i-1].price) / recentPrices[i-1].price) * 100;
      changes.push(change);
    }

    // Calculate volatility (standard deviation of price changes)
    const mean = changes.reduce((sum, change) => sum + change, 0) / changes.length;
    const volatility = Math.sqrt(changes.reduce((sum, change) => sum + Math.pow(change - mean, 2), 0) / changes.length);

    // Get highest and lowest prices
    const prices = recentPrices.map(p => p.price);
    const highestPrice = Math.max(...prices);
    const lowestPrice = Math.min(...prices);

    // Calculate total price change
    const totalChange = ((this.currentPrice - recentPrices[0].price) / recentPrices[0].price) * 100;

    return {
      volatility,
      highestPrice,
      lowestPrice,
      priceChange: totalChange
    };
  }

  getRecoveryPercentage() {
    if (!this.drawdownLow || !this.marketCapSol) return 0;
    return ((this.marketCapSol - this.drawdownLow) / this.drawdownLow) * 100;
  }

  getDrawdownPercentage() {
    if (!this.highestMarketCap || !this.marketCapSol) return 0;
    return (
      ((this.highestMarketCap - this.marketCapSol) / this.highestMarketCap) *
      100
    );
  }

  getGainPercentage() {
    if (!this.drawdownLow || !this.marketCapSol) return 0;
    return ((this.marketCapSol - this.drawdownLow) / this.drawdownLow) * 100;
  }

  async evaluateRecovery(safetyChecker) {
    try {
      if (!safetyChecker) {
        const error = new Error('SafetyChecker is required for evaluateRecovery');
        errorLogger.logError(error, 'Token.evaluateRecovery');
        return;
      }

      if (this.state !== "drawdown" && this.state !== "unsafeRecovery") {
        return;
      }

      // Initialize drawdownLow if not set (this should never happen, but let's be safe)
      if (this.drawdownLow === null) {
        console.warn(`drawdownLow was null for token ${this.mint} in ${this.state} state. Initializing with current market cap.`);
        this.drawdownLow = this.marketCapSol;
      }

      // Check for new drawdown in either state
      if (this.marketCapSol < this.drawdownLow) {
        this.setState("drawdown");
        this.drawdownLow = this.marketCapSol;
        return;
      }

      const gainPercentage = this.getGainPercentage();
      const recoveryPercentage = this.getRecoveryPercentage();

      // If we're in drawdown and hit recovery threshold
      if (this.state === "drawdown" && recoveryPercentage >= config.THRESHOLDS.RECOVERY) {
        const isSecure = await safetyChecker.runSecurityChecks(this);
        if (isSecure) {
          // Emit readyForPosition event to signal that we can open a position
          this.emit("readyForPosition", this);
        } else {
          this.setState("unsafeRecovery");
          this.unsafeReason = safetyChecker.getFailureReason();
          this.emit("unsafeRecovery", { 
            token: this, 
            marketCap: this.marketCapSol, 
            reason: this.unsafeReason?.reason || 'Unknown',
            value: this.unsafeReason?.value 
          });
        }
        return;
      }

      // If we're in unsafeRecovery
      if (this.state === "unsafeRecovery") {
        // Check if token has become safe
        const isSecure = await safetyChecker.runSecurityChecks(this);
        
        if (isSecure) {
          // Only enter position if gain is less than threshold
          if (gainPercentage <= config.THRESHOLDS.SAFE_RECOVERY_GAIN) {
            // Emit readyForPosition event to signal that we can open a position
            this.emit("readyForPosition", this);
          } else {
            // If gain is too high, go back to drawdown to wait for better entry
            this.setState("drawdown");
            this.emit("recoveryGainTooHigh", {
              token: this,
              gainPercentage,
              marketCap: this.marketCapSol
            });
          }
        } else {
          // Update unsafe reason if it changed
          const newReason = safetyChecker.getFailureReason();
          if (JSON.stringify(newReason) !== JSON.stringify(this.unsafeReason)) {
            this.unsafeReason = newReason;
            this.emit("unsafeRecoveryUpdate", {
              token: this,
              reason: this.unsafeReason?.reason || 'Unknown',
              value: this.unsafeReason?.value
            });
          }
        }
      }
    } catch (error) {
      const logError = new Error('Error in evaluateRecovery');
      errorLogger.logError(logError, 'Token.evaluateRecovery', { error: error.message });
      this.emit('recoveryError', { token: this, error: error.message });
    }
  }

  setState(newState) {
    return this.stateManager.setState(this, newState);
  }

  isHeatingUp(threshold) {
    return this.stateManager.isHeatingUp(this, threshold);
  }

  isFirstPump(threshold) {
    return this.stateManager.isFirstPump(this, threshold);
  }

  isDead(threshold) {
    return this.stateManager.isDead(this, threshold);
  }

  getTokenPrice() {
    return this.currentPrice;
  }

  calculateTokenPrice() {
    if (
      !this.vTokensInBondingCurve ||
      !this.vSolInBondingCurve ||
      this.vTokensInBondingCurve === 0
    ) {
      return 0;
    }
    return this.vSolInBondingCurve / this.vTokensInBondingCurve;
  }

  analyzeHolders() {
    if (!this.traderManager) return null;

    const now = Date.now();
    const holders = this.traderManager.getHoldersForToken(this.mint);
    const totalHolders = holders.length;
    
    // Get creator behavior
    const creatorStats = {
      sellPercentage: this.getCreatorSellPercentage(),
      hasExited: this.hasCreatorSoldAll()
    };

    // Analyze top holders
    const topHolders = this.getTopHolders(5);
    const topHolderConcentration = this.getTopHolderConcentration(5);

    // Analyze trading patterns
    const traderStats = this.getTraderStats("5m");
    
    // Calculate holder turnover (percentage of holders who have traded in last 5 minutes)
    const recentlyActiveHolders = holders.filter(holder => 
      holder.lastActive > now - 5 * 60 * 1000
    ).length;
    
    const holderTurnover = (recentlyActiveHolders / totalHolders) * 100;

    return {
      totalHolders,
      topHolderConcentration,
      holderTurnover,
      creatorBehavior: creatorStats,
      tradingActivity: {
        uniqueTraders: traderStats.uniqueTraders,
        tradeCount: traderStats.totalTrades,
        averageTradeSize: traderStats.averageTradeSize,
        buyToSellRatio: traderStats.buyToSellRatio
      },
      topHolders: topHolders.map(holder => ({
        balance: holder.balance,
        percentageHeld: (holder.balance / this.getTotalTokensHeld()) * 100,
        isCreator: holder.isCreator || false
      }))
    };
  }
}

module.exports = Token;
