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

    // Recovery metrics
    this.recoveryMetrics = {
      drawdownDepth: 0,           // Maximum drawdown from peak
      recoveryStrength: 0,        // Current recovery strength
      recoveryVolume: 0,          // Volume during recovery
      accumulationScore: 0,       // Score based on accumulation patterns
      buyPressure: 0,            // Buy side pressure during recovery
      marketStructure: 'unknown', // Current market structure
      recoveryPhase: 'none',     // Current recovery phase
      lastDrawdownTime: null,    // Timestamp of last significant drawdown
      recoveryAttempts: []       // History of recovery attempts
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
    this.stateManager = null; // Initialize state manager to null
    
    // Forward state change events
    this.on("stateChanged", ({ from, to }) => {
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
    const newPrice = this.calculateTokenPrice();
    
    // Update wallet data if trade occurred
    if (data.tokenAmount) {
      const volumeInSol = Math.abs(data.tokenAmount * newPrice);
      this.updateWalletActivity(data.traderPublicKey, {
        amount: data.tokenAmount,
        volumeInSol,
        priceChange: ((newPrice - oldPrice) / oldPrice) * 100,
        timestamp: now,
        newBalance: data.newTokenBalance
      });
    }
    // Update wallet balance if no trade (e.g., transfer)
    else if (data.traderPublicKey && typeof data.newTokenBalance !== "undefined") {
      this.updateWalletBalance(data.traderPublicKey, data.newTokenBalance, now);
    }

    // Calculate volumes before price update
    this.volume1m = this.getRecentVolume(60 * 1000);
    this.volume5m = this.getRecentVolume(5 * 60 * 1000);
    this.volume30m = this.getRecentVolume(30 * 60 * 1000);

    // Update price metrics with volumes
    this.updatePriceMetrics(newPrice);

    // Update all metrics
    this.updateMetrics();

    // Update recovery metrics
    this.updateRecoveryMetrics();

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

  updatePriceMetrics(newPrice) {
    const now = Date.now();
    const priceChange = ((newPrice - this.currentPrice) / this.currentPrice) * 100;
    
    // Update price buffer
    this.priceBuffer.data[this.priceBuffer.head] = {
      price: newPrice,
      timestamp: now
    };
    this.priceBuffer.head = (this.priceBuffer.head + 1) % this.priceBuffer.size;
    this.priceBuffer.count = Math.min(this.priceBuffer.count + 1, this.priceBuffer.size);
    
    // Calculate price acceleration over multiple time windows
    const timeWindows = [15000, 30000, 60000]; // 15s, 30s, 1m windows
    const accelerations = timeWindows.map(window => {
      const oldPrice = this.getPriceAtTime(now - window);
      if (!oldPrice) return 0;
      const changeInWindow = ((newPrice - oldPrice) / oldPrice) * 100;
      return changeInWindow / (window / 1000); // %/second
    });
    
    // Use the highest acceleration from any window
    const acceleration = Math.max(...accelerations);
    this.pumpMetrics.priceAcceleration = acceleration;
    
    // Check for pump conditions
    const pumpConfig = config.SAFETY.PUMP_DETECTION;
    if (acceleration >= pumpConfig.MIN_PRICE_ACCELERATION) {
      const timeSinceLastPump = !this.pumpMetrics.lastPumpTime ? Infinity : now - this.pumpMetrics.lastPumpTime;
      if (timeSinceLastPump >= pumpConfig.PUMP_WINDOW_MS) {
        this.pumpMetrics.pumpCount++;
        this.pumpMetrics.lastPumpTime = now;
        this.pumpMetrics.pumpTimes.push(now);
        
        const gainRate = acceleration;
        this.pumpMetrics.highestGainRate = Math.max(this.pumpMetrics.highestGainRate, gainRate);
      }
    }
    
    this.currentPrice = newPrice;
  }

  getRecentVolume(timeWindow) {
    const now = Date.now();
    const cutoff = now - timeWindow;
    let volume = 0;
    
    // Get all trades from all traders
    const traders = Array.from(this.traderManager.traders.values());
    for (const trader of traders) {
      // Get trades within time window
      const recentTrades = trader.tradeHistory.all.filter(trade => 
        trade.mint === this.mint && trade.timestamp > cutoff
      );
      
      // Sum up the volume in SOL
      volume += recentTrades.reduce((sum, trade) => {
        // Calculate volume as amount * price
        const tradeVolume = Math.abs(trade.amount * trade.price);
        return sum + tradeVolume;
      }, 0);
    }
    
    return volume;
  }

  updateWalletActivity(publicKey, tradeData) {
    const now = tradeData.timestamp;
    const trader = this.traderManager.getOrCreateTrader(publicKey);

    // Calculate volume in SOL
    const volumeInSol = Math.abs(tradeData.amount * this.currentPrice);

    // Update trader data for this token
    trader.updateTokenBalance(this.mint, tradeData.newBalance);
    trader.recordTrade({
      mint: this.mint,
      amount: tradeData.amount,
      price: this.currentPrice,
      type: tradeData.amount > 0 ? 'buy' : 'sell',
      timestamp: now,
      volumeInSol
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
    if (!this.drawdownLow || this.marketCapSol === 0) return 0;
    return ((this.marketCapSol - this.drawdownLow) / this.drawdownLow) * 100;
  }

  getDrawdownPercentage() {
    if (!this.highestMarketCap || this.marketCapSol === 0) return 0;
    return ((this.marketCapSol - this.highestMarketCap) / this.highestMarketCap) * 100;
  }

  getGainPercentage() {
    if (!this.drawdownLow || this.marketCapSol === 0) return 0;
    return ((this.marketCapSol - this.drawdownLow) / this.drawdownLow) * 100;
  }

  async evaluateRecovery(safetyChecker) {
    try {
      if (!safetyChecker) {
        const error = new Error('SafetyChecker is required for evaluateRecovery');
        errorLogger.logError(error, 'Token.evaluateRecovery');
        this.emit('recoveryError', { token: this, error: error.message });
        return;
      }

      if (this.state !== "drawdown" && this.state !== "recovery") {
        return;
      }

      // Initialize drawdownLow if not set (this should never happen, but let's be safe)
      if (this.drawdownLow === null) {
        console.warn(`drawdownLow was null for token ${this.mint} in ${this.state} state. Initializing with current market cap.`);
        this.drawdownLow = this.marketCapSol;
      }

      // Check for new drawdown in either state
      if (this.marketCapSol < this.drawdownLow) {
        // Only set state to drawdown if we're not already in drawdown
        if (this.state !== "drawdown") {
          this.setState("drawdown");
        }
        this.drawdownLow = this.marketCapSol;
        return;
      }

      const gainPercentage = this.getGainPercentage();
      const recoveryPercentage = this.getRecoveryPercentage();

      // If we're in drawdown and hit recovery threshold
      if (this.state === "drawdown" && recoveryPercentage >= config.THRESHOLDS.RECOVERY) {
        const isSecure = await safetyChecker.runSecurityChecks(this);
        if (isSecure) {
          // If safe, immediately emit readyForPosition
          this.emit("readyForPosition", this);
        } else {
          // If unsafe, get failure reason and enter recovery state
          const failureReason = safetyChecker.getFailureReason();
          this.setState("recovery");
          this.unsafeReason = failureReason;
          this.emit("unsafeRecovery", { 
            token: this, 
            marketCap: this.marketCapSol, 
            reason: failureReason.reason,
            value: failureReason.value 
          });
        }
        return;
      }

      // If we're in recovery state
      if (this.state === "recovery") {
        const isSecure = await safetyChecker.runSecurityChecks(this);
        const currentPrice = this.calculateTokenPrice();
        const gainFromBottom = this.drawdownLow ? ((currentPrice - this.drawdownLow) / this.drawdownLow) * 100 : 0;
        
        if (isSecure) {
          // If gain from bottom is acceptable, enter position
          if (gainFromBottom <= config.THRESHOLDS.SAFE_RECOVERY_GAIN) {
            this.unsafeReason = null;
            this.emit("readyForPosition", this);
          } else {
            // If gain too high, go back to drawdown to wait for better entry
            this.setState("drawdown");
            this.unsafeReason = null;
            this.emit("recoveryGainTooHigh", {
              token: this,
              gainFromBottom,
              marketCap: this.marketCapSol
            });
          }
        } else {
          // If still unsafe, check if we're in a new drawdown from recovery high
          const drawdownFromRecoveryHigh = this.highestMarketCap ? 
            ((this.marketCapSol - this.highestMarketCap) / this.highestMarketCap) * 100 : 0;
            
          if (drawdownFromRecoveryHigh <= -config.THRESHOLDS.DRAWDOWN) {
            // We've hit a significant drawdown from recovery high, go back to drawdown state
            this.setState("drawdown");
            this.drawdownLow = currentPrice; // Reset drawdown low for new cycle
            this.emit("newDrawdownCycle", {
              token: this,
              drawdownFromHigh: drawdownFromRecoveryHigh,
              newDrawdownLow: currentPrice
            });
          } else {
            // Still in recovery but unsafe, update reason if changed
            const newReason = safetyChecker.getFailureReason();
            if (!this.unsafeReason || 
                this.unsafeReason.reason !== newReason.reason || 
                this.unsafeReason.value !== newReason.value) {
              this.unsafeReason = newReason;
              this.emit("recoveryUpdate", {
                token: this,
                reason: newReason.reason,
                value: newReason.value
              });
            }
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
    if (this.stateManager) {
      this.stateManager.setState(this, newState);
    } else {
      throw new Error('StateManager not initialized for token');
    }
  }

  setStateManager(stateManager) {
    this.stateManager = stateManager;
    // Initialize state if not already set
    if (!this.state) {
      this.setState("new");
    }
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

  getPriceAtTime(timestamp) {
    // Find the most recent price data point before the given timestamp
    for (let i = 0; i < this.priceBuffer.count; i++) {
      const idx = (this.priceBuffer.head - 1 - i + this.priceBuffer.size) % this.priceBuffer.size;
      const data = this.priceBuffer.data[idx];
      if (data && data.timestamp <= timestamp) {
        return data.price;
      }
    }
    return null;
  }

  cleanup() {
    // Clear any price tracking data
    this.priceBuffer = {
      data: new Array(30).fill(null),
      head: 0,
      size: 30,
      count: 0
    };
    
    this.priceHistory = [];
    
    // Reset pump metrics
    this.pumpMetrics = {
      lastPumpTime: null,
      pumpCount: 0,
      highestGainRate: 0,
      volumeSpikes: [],
      priceAcceleration: 0,
      pumpTimes: []
    };
    
    // Remove all event listeners
    this.removeAllListeners();
  }

  getDrawdownPercentage() {
    if (!this.highestMarketCap || this.marketCapSol === 0) return 0;
    return ((this.marketCapSol - this.highestMarketCap) / this.highestMarketCap) * 100;
  }

  getRecoveryPercentage() {
    if (!this.drawdownLow || this.marketCapSol === 0) return 0;
    return ((this.marketCapSol - this.drawdownLow) / this.drawdownLow) * 100;
  }

  getPriceMomentum() {
    if (this.priceHistory.length < 2) return 0;
    
    const recentPrices = this.priceHistory.slice(-5); // Last 5 price points
    if (recentPrices.length < 2) return 0;
    
    // Calculate price changes
    const changes = [];
    for (let i = 1; i < recentPrices.length; i++) {
      const change = (recentPrices[i].price - recentPrices[i-1].price) / recentPrices[i-1].price;
      changes.push(change);
    }
    
    // Return average of recent changes
    return changes.reduce((sum, change) => sum + change, 0) / changes.length;
  }

  getRecentVolume(timeWindow) {
    const now = Date.now();
    return this.traderManager.getTotalVolumeInTimeWindow(this.mint, now - timeWindow, now);
  }

  getAverageVolume(timeWindow) {
    const now = Date.now();
    const totalVolume = this.traderManager.getTotalVolumeInTimeWindow(this.mint, now - timeWindow, now);
    return totalVolume / (timeWindow / 60000); // Convert to per minute average
  }

  getMarketCap() {
    return this.marketCapSol;
  }

  getBuyPressureMetrics(timeWindow = 300000) { // 5 minutes default
    const now = Date.now();
    const trades = this.traderManager.getTradesInTimeWindow(this.mint, now - timeWindow, now);
    
    if (!trades || trades.length === 0) return {
      buyRatio: 0,
      avgBuySize: 0,
      uniqueBuyers: 0,
      buySizeIncreasing: false
    };

    const buys = trades.filter(t => t.type === 'buy');
    const uniqueBuyerSet = new Set(buys.map(t => t.trader));
    
    // Calculate average buy size trend
    const buySizes = buys.map(t => t.amount);
    const recentBuys = buySizes.slice(-3); // Look at last 3 buys
    const buySizeIncreasing = recentBuys.length >= 2 && 
      recentBuys.every((size, i) => i === 0 || size >= recentBuys[i-1]);

    return {
      buyRatio: buys.length / trades.length,
      avgBuySize: buys.length > 0 ? buySizes.reduce((a,b) => a + b, 0) / buys.length : 0,
      uniqueBuyers: uniqueBuyerSet.size,
      buySizeIncreasing
    };
  }

  getRecoveryStrength() {
    const recoveryPercentage = this.getRecoveryPercentage();
    const buyPressure = this.getBuyPressureMetrics();
    const momentum = this.getPriceMomentum();
    
    // Weight different factors
    const recoveryScore = recoveryPercentage * 0.4; // 40% weight
    const buyPressureScore = (
      (buyPressure.buyRatio * 30) + // Up to 30 points for buy ratio
      (buyPressure.buySizeIncreasing ? 15 : 0) + // 15 points for increasing buy sizes
      (Math.min(buyPressure.uniqueBuyers * 2, 15)) // Up to 15 points for unique buyers
    ) * 0.4; // 40% weight
    const momentumScore = (momentum * 100) * 0.2; // 20% weight

    return {
      total: recoveryScore + buyPressureScore + momentumScore,
      breakdown: {
        recoveryPercentage,
        buyPressure,
        momentum
      }
    };
  }

  isRecoveryHealthy() {
    const strength = this.getRecoveryStrength();
    const buyPressure = strength.breakdown.buyPressure;
    
    return (
      strength.total >= 60 && // Overall strong recovery
      buyPressure.buyRatio >= 0.6 && // More buys than sells
      buyPressure.uniqueBuyers >= 3 && // Multiple unique buyers
      strength.breakdown.momentum > 0 // Positive momentum
    );
  }

  detectPricePattern(timeWindow = 1800000) { // 30 minutes default
    const prices = this.priceHistory
      .filter(p => p.timestamp > Date.now() - timeWindow)
      .map(p => p.price);
    
    if (prices.length < 10) return null;

    // Normalize prices to 0-1 range for pattern matching
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice;
    const levelSize = priceRange / 10;

    // Initialize volume profile
    const profile = Array(10).fill(0).map((_, i) => ({
      priceLevel: minPrice + (i * levelSize),
      buyVolume: 0,
      sellVolume: 0,
      totalVolume: 0,
      trades: 0
    }));

    // Aggregate volumes by price level
    const trades = this.traderManager.getTradesInTimeWindow(this.mint, Date.now() - timeWindow, Date.now());
    trades.forEach(trade => {
      const level = Math.min(9, Math.floor((trade.price - minPrice) / levelSize));
      profile[level].trades++;
      profile[level].totalVolume += trade.amount;
      if (trade.type === 'buy') {
        profile[level].buyVolume += trade.amount;
      } else {
        profile[level].sellVolume += trade.amount;
      }
    });

    // Calculate point of control (price level with highest volume)
    const poc = profile.reduce((max, level, i) => 
      level.totalVolume > profile[max].totalVolume ? i : max, 0
    );

    // Calculate value area (70% of volume)
    const totalVolume = profile.reduce((sum, level) => sum + level.totalVolume, 0);
    const valueAreaTarget = totalVolume * 0.7;
    let valueAreaVolume = 0;
    const valueArea = profile
      .map((level, i) => ({...level, index: i}))
      .sort((a, b) => b.totalVolume - a.totalVolume)
      .filter(level => {
        if (valueAreaVolume < valueAreaTarget) {
          valueAreaVolume += level.totalVolume;
          return true;
        }
        return false;
      })
      .map(level => level.index);

    // Pattern definitions
    const patterns = {
      vShape: {
        name: 'V-Shape Recovery',
        confidence: 0,
        ideal: [1, 0.8, 0.6, 0.4, 0.2, 0, 0.2, 0.4, 0.6, 0.8]
      },
      doubleBottom: {
        name: 'Double Bottom',
        confidence: 0,
        ideal: [1, 0.5, 0.2, 0.5, 0.2, 0.5, 0.8]
      },
      roundedBottom: {
        name: 'Rounded Bottom',
        confidence: 0,
        ideal: [1, 0.7, 0.4, 0.2, 0.1, 0.1, 0.2, 0.4, 0.7]
      }
    };

    // Calculate pattern match confidence
    Object.keys(patterns).forEach(patternName => {
      const pattern = patterns[patternName];
      const idealLength = pattern.ideal.length;
      const stride = Math.floor(profile.length / idealLength);
      
      // Sample prices at regular intervals
      const sampledPrices = Array(idealLength).fill(0).map((_, i) => 
        profile[Math.min(i * stride, profile.length - 1)]
      );

      // Calculate pattern similarity
      let similarity = 0;
      for (let i = 0; i < idealLength; i++) {
        similarity += 1 - Math.abs(pattern.ideal[i] - sampledPrices[i].totalVolume / totalVolume);
      }
      pattern.confidence = (similarity / idealLength) * 100;
    });

    // Find best matching pattern
    const bestPattern = Object.entries(patterns)
      .reduce((best, [name, pattern]) => 
        pattern.confidence > best.confidence ? {name, confidence: pattern.confidence} : best,
        {name: 'Unknown', confidence: 0}
      );

    return {
      pattern: bestPattern.name,
      confidence: bestPattern.confidence,
      details: patterns
    };
  }

  getVolumeProfile(timeWindow = 1800000) { // 30 minutes default
    const trades = this.traderManager.getTradesInTimeWindow(
      this.mint,
      Date.now() - timeWindow,
      Date.now()
    );

    if (!trades || trades.length === 0) return null;

    // Divide price range into 10 levels
    const prices = trades.map(t => t.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = maxPrice - minPrice;
    const levelSize = priceRange / 10;

    // Initialize volume profile
    const profile = Array(10).fill(0).map((_, i) => ({
      priceLevel: minPrice + (i * levelSize),
      buyVolume: 0,
      sellVolume: 0,
      totalVolume: 0,
      trades: 0
    }));

    // Aggregate volumes by price level
    trades.forEach(trade => {
      const level = Math.min(9, Math.floor((trade.price - minPrice) / levelSize));
      profile[level].trades++;
      profile[level].totalVolume += trade.amount;
      if (trade.type === 'buy') {
        profile[level].buyVolume += trade.amount;
      } else {
        profile[level].sellVolume += trade.amount;
      }
    });

    // Calculate point of control (price level with highest volume)
    const poc = profile.reduce((max, level, i) => 
      level.totalVolume > profile[max].totalVolume ? i : max, 0
    );

    // Calculate value area (70% of volume)
    const totalVolume = profile.reduce((sum, level) => sum + level.totalVolume, 0);
    const valueAreaTarget = totalVolume * 0.7;
    let valueAreaVolume = 0;
    const valueArea = profile
      .map((level, i) => ({...level, index: i}))
      .sort((a, b) => b.totalVolume - a.totalVolume)
      .filter(level => {
        if (valueAreaVolume < valueAreaTarget) {
          valueAreaVolume += level.totalVolume;
          return true;
        }
        return false;
      })
      .map(level => level.index);

    return {
      profile,
      pointOfControl: poc,
      valueArea,
      volumeDistribution: {
        buyVolume: profile.reduce((sum, level) => sum + level.buyVolume, 0),
        sellVolume: profile.reduce((sum, level) => sum + level.sellVolume, 0)
      }
    };
  }

  analyzeMarketStructure() {
    const pattern = this.detectPricePattern();
    const volumeProfile = this.getVolumeProfile();
    const buyPressure = this.getBuyPressureMetrics();
    const strength = this.getRecoveryStrength();

    // Identify key price levels
    const prices = this.priceHistory.map(p => p.price);
    const currentPrice = prices[prices.length - 1];
    const recentLow = Math.min(...prices.slice(-20));
    const recentHigh = Math.max(...prices.slice(-20));

    // Calculate market structure score
    const structureScore = {
      patternQuality: pattern ? pattern.confidence : 0,
      volumeSupport: volumeProfile ? 
        (volumeProfile.profile[volumeProfile.pointOfControl].buyVolume / 
         volumeProfile.profile[volumeProfile.pointOfControl].totalVolume) * 100 : 0,
      buyPressureScore: (
        (buyPressure.buyRatio * 40) +
        (buyPressure.buySizeIncreasing ? 30 : 0) +
        (Math.min(buyPressure.uniqueBuyers * 3, 30))
      ),
      recoveryQuality: strength.total
    };

    // Calculate overall market structure health
    const overallHealth = (
      structureScore.patternQuality * 0.3 +
      structureScore.volumeSupport * 0.2 +
      structureScore.buyPressureScore * 0.3 +
      structureScore.recoveryQuality * 0.2
    );

    return {
      pattern,
      volumeProfile,
      keyLevels: {
        current: currentPrice,
        recentLow,
        recentHigh,
        valueArea: volumeProfile ? {
          low: volumeProfile.profile[Math.min(...volumeProfile.valueArea)].priceLevel,
          high: volumeProfile.profile[Math.max(...volumeProfile.valueArea)].priceLevel
        } : null
      },
      structureScore,
      overallHealth,
      recommendation: this.getTradeRecommendation(overallHealth, pattern, volumeProfile)
    };
  }

  getTradeRecommendation(health, pattern, volumeProfile) {
    if (!pattern || !volumeProfile) return { action: 'WAIT', confidence: 0 };

    const confidence = health * (pattern.confidence / 100);
    let action = 'WAIT';
    let reason = '';

    if (confidence >= 80) {
      action = 'STRONG_BUY';
      reason = 'High confidence recovery pattern with strong market structure';
    } else if (confidence >= 60) {
      action = 'BUY';
      reason = 'Moderate confidence in recovery with supporting volume';
    } else if (confidence >= 40) {
      action = 'LIGHT_BUY';
      reason = 'Early signs of recovery, consider small position';
    } else if (confidence <= 20) {
      action = 'AVOID';
      reason = 'Weak market structure, high risk';
    }

    return {
      action,
      confidence,
      reason,
      suggestedEntry: volumeProfile.profile[volumeProfile.pointOfControl].priceLevel,
      stopLoss: Math.min(...volumeProfile.profile
        .filter(level => level.buyVolume > level.sellVolume)
        .map(level => level.priceLevel)
      )
    };
  }

  updateRecoveryMetrics() {
    if (!this.priceHistory || this.priceHistory.length < 5) return;

    const recentPrices = this.priceHistory.slice(-5);
    const peakPrice = Math.max(...this.priceHistory.map(p => p.price));
    
    // Update drawdown metrics
    this.recoveryMetrics.drawdownDepth = (peakPrice - Math.min(...recentPrices.map(p => p.price))) / peakPrice;
    
    // Calculate recovery strength
    const lowestPrice = Math.min(...recentPrices.map(p => p.price));
    const currentRecovery = (this.currentPrice - lowestPrice) / lowestPrice;
    this.recoveryMetrics.recoveryStrength = currentRecovery;
    
    // Calculate volume metrics
    const recentVolumes = this.volumeHistory.slice(-5);
    this.recoveryMetrics.recoveryVolume = recentVolumes.reduce((sum, v) => sum + v.volume, 0);
    
    // Calculate accumulation score
    const volumeProfile = this.calculateVolumeProfile();
    this.recoveryMetrics.accumulationScore = this.calculateAccumulationScore(volumeProfile);
    
    // Update buy pressure
    const buyCandles = recentPrices.filter((p, i) => 
      i > 0 && p.price > recentPrices[i-1].price
    ).length;
    this.recoveryMetrics.buyPressure = buyCandles / (recentPrices.length - 1);
    
    // Analyze market structure
    this.recoveryMetrics.marketStructure = this.analyzeMarketStructure();
    
    // Update recovery phase
    this.updateRecoveryPhase();
    
    // Track recovery attempts
    if (this.recoveryMetrics.recoveryStrength > 0.1 && 
        this.state === 'drawdown') {
      this.recoveryMetrics.recoveryAttempts.push({
        timestamp: Date.now(),
        strength: this.recoveryMetrics.recoveryStrength,
        volume: this.recoveryMetrics.recoveryVolume,
        buyPressure: this.recoveryMetrics.buyPressure
      });
    }
  }

  calculateAccumulationScore(volumeProfile) {
    if (!volumeProfile) return 0;
    
    const {
      maxVolume,
      minVolume,
      avgVolume,
      volumeStability,
      recentTrend
    } = volumeProfile;
    
    let score = 0;
    
    // Volume stability indicates accumulation
    score += (1 - volumeStability) * 0.3;
    
    // Increasing volume trend is positive
    if (recentTrend === 'increasing') score += 0.4;
    else if (recentTrend === 'stable') score += 0.2;
    
    // Higher than average volume is positive
    if (maxVolume > avgVolume * 1.5) score += 0.3;
    
    return Math.min(1, score);
  }

  analyzeMarketStructure() {
    const prices = this.priceHistory.slice(-10);
    if (prices.length < 10) return 'unknown';
    
    const highs = [];
    const lows = [];
    
    for (let i = 1; i < prices.length - 1; i++) {
      if (prices[i].price > prices[i-1].price && prices[i].price > prices[i+1].price) {
        highs.push(prices[i].price);
      }
      if (prices[i].price < prices[i-1].price && prices[i].price < prices[i+1].price) {
        lows.push(prices[i].price);
      }
    }
    
    if (highs.length >= 2 && lows.length >= 2) {
      const higherHighs = highs[highs.length-1] > highs[highs.length-2];
      const higherLows = lows[lows.length-1] > lows[lows.length-2];
      
      if (higherHighs && higherLows) return 'bullish';
      if (!higherHighs && !higherLows) return 'bearish';
    }
    
    return 'neutral';
  }

  updateRecoveryPhase() {
    const {
      recoveryStrength,
      buyPressure,
      accumulationScore,
      marketStructure
    } = this.recoveryMetrics;
    
    if (recoveryStrength < 0.1) {
      this.recoveryMetrics.recoveryPhase = 'none';
    } else if (recoveryStrength < 0.3 && buyPressure > 0.6 && accumulationScore > 0.7) {
      this.recoveryMetrics.recoveryPhase = 'accumulation';
    } else if (recoveryStrength >= 0.3 && marketStructure === 'bullish') {
      this.recoveryMetrics.recoveryPhase = 'expansion';
    } else if (recoveryStrength >= 0.5 && buyPressure < 0.4) {
      this.recoveryMetrics.recoveryPhase = 'distribution';
    }
  }

  async updateState() {
    try {
      // Skip if token is in a terminal state
      if (["closed", "dead"].includes(this.state)) {
        return;
      }

      const currentPrice = this.calculateTokenPrice();
      if (!currentPrice) return;

      // Update highest market cap if current is higher
      if (this.marketCapSol > this.highestMarketCap) {
        this.highestMarketCap = this.marketCapSol;
      }

      // Calculate key metrics
      const priceChange1m = this.getPriceChange(60); // 1 minute
      const priceChange5m = this.getPriceChange(300); // 5 minutes
      const volumeChange5m = this.getVolumeChange(300);
      const buyPressure = this.getBuyPressure(300);

      // Detect pumping state
      if (this.state === "new") {
        const isPumping = 
          // Significant price increase
          priceChange1m >= config.THRESHOLDS.PUMP.PRICE_CHANGE_1M &&
          priceChange5m >= config.THRESHOLDS.PUMP.PRICE_CHANGE_5M &&
          // Volume spike
          volumeChange5m >= config.THRESHOLDS.PUMP.VOLUME_CHANGE &&
          // Strong buy pressure
          buyPressure >= config.THRESHOLDS.PUMP.BUY_PRESSURE;

        if (isPumping) {
          this.setState("pumping");
          this.emit("pumpDetected", {
            token: this,
            metrics: {
              priceChange1m,
              priceChange5m,
              volumeChange5m,
              buyPressure
            }
          });
        }
      }

      // Calculate drawdown from peak
      const drawdownPercentage = this.highestMarketCap ? 
        ((this.marketCapSol - this.highestMarketCap) / this.highestMarketCap) * 100 : 0;

      // Detect drawdown state
      if (this.state === "pumping" && drawdownPercentage <= -config.THRESHOLDS.DRAWDOWN) {
        this.setState("drawdown");
        this.drawdownLow = currentPrice;
        this.emit("drawdownStarted", {
          token: this,
          drawdownPercentage,
          fromPrice: this.highestMarketCap,
          currentPrice
        });
      }

      // Handle recovery
      const recoveryPercentage = this.drawdownLow ? 
        ((currentPrice - this.drawdownLow) / this.drawdownLow) * 100 : 0;

      if (this.state === "drawdown" && recoveryPercentage >= config.THRESHOLDS.RECOVERY) {
        const isSecure = await safetyChecker.runSecurityChecks(this);
        if (isSecure) {
          // If safe, immediately emit readyForPosition
          this.setState("open");
          this.emit("readyForPosition", this);
        } else {
          // If unsafe, get failure reason and enter recovery state
          const failureReason = safetyChecker.getFailureReason();
          this.setState("recovery");
          this.unsafeReason = failureReason;
          this.emit("recoveryStarted", { 
            token: this, 
            marketCap: this.marketCapSol, 
            reason: failureReason.reason,
            value: failureReason.value 
          });
        }
        return;
      }

      // Handle recovery state
      if (this.state === "recovery") {
        const isSecure = await safetyChecker.runSecurityChecks(this);
        const currentPrice = this.calculateTokenPrice();
        const gainFromBottom = this.drawdownLow ? ((currentPrice - this.drawdownLow) / this.drawdownLow) * 100 : 0;
        
        if (isSecure) {
          // If gain from bottom is acceptable, enter position
          if (gainFromBottom <= config.THRESHOLDS.SAFE_RECOVERY_GAIN) {
            this.unsafeReason = null;
            this.setState("open");
            this.emit("readyForPosition", this);
          } else {
            // If gain too high, go back to drawdown to wait for better entry
            this.setState("drawdown");
            this.unsafeReason = null;
            this.emit("recoveryGainTooHigh", {
              token: this,
              gainFromBottom,
              marketCap: this.marketCapSol
            });
          }
        } else {
          // If still unsafe, check if we're in a new drawdown from recovery high
          const drawdownFromRecoveryHigh = this.highestMarketCap ? 
            ((this.marketCapSol - this.highestMarketCap) / this.highestMarketCap) * 100 : 0;
            
          if (drawdownFromRecoveryHigh <= -config.THRESHOLDS.DRAWDOWN) {
            // We've hit a significant drawdown from recovery high, go back to drawdown state
            this.setState("drawdown");
            this.drawdownLow = currentPrice; // Reset drawdown low for new cycle
            this.emit("newDrawdownCycle", {
              token: this,
              drawdownFromHigh: drawdownFromRecoveryHigh,
              newDrawdownLow: currentPrice
            });
          } else {
            // Still in recovery but unsafe, update reason if changed
            const newReason = safetyChecker.getFailureReason();
            if (!this.unsafeReason || 
                this.unsafeReason.reason !== newReason.reason || 
                this.unsafeReason.value !== newReason.value) {
              this.unsafeReason = newReason;
              this.emit("recoveryUpdate", {
                token: this,
                reason: newReason.reason,
                value: newReason.value
              });
            }
          }
        }
      }
    } catch (error) {
      this.emit("error", error);
    }
  }

  getBuyPressure(timeWindowSeconds) {
    const timeWindow = timeWindowSeconds * 1000;
    const recentTrades = this.trades.filter(t => 
      Date.now() - t.timestamp <= timeWindow
    );

    if (recentTrades.length === 0) return 0;

    const buyVolume = recentTrades
      .filter(t => t.type === 'BUY')
      .reduce((sum, t) => sum + (t.price * t.size), 0);

    const totalVolume = recentTrades
      .reduce((sum, t) => sum + (t.price * t.size), 0);

    return totalVolume > 0 ? (buyVolume / totalVolume) * 100 : 0;
  }

  getPriceChange(timeWindowSeconds) {
    const timeWindow = timeWindowSeconds * 1000;
    const oldPrice = this.getPriceAtTime(Date.now() - timeWindow);
    if (!oldPrice) return 0;
    
    return ((this.currentPrice - oldPrice) / oldPrice) * 100;
  }

  getVolumeChange(timeWindowSeconds) {
    const timeWindow = timeWindowSeconds * 1000;
    const currentWindow = this.trades
      .filter(t => Date.now() - t.timestamp <= timeWindow)
      .reduce((sum, t) => sum + (t.price * t.size), 0);

    const previousWindow = this.trades
      .filter(t => 
        Date.now() - t.timestamp <= timeWindow * 2 && 
        Date.now() - t.timestamp > timeWindow
      )
      .reduce((sum, t) => sum + (t.price * t.size), 0);

    return previousWindow > 0 ? 
      ((currentWindow - previousWindow) / previousWindow) * 100 : 0;
  }
}

module.exports = Token;
