const EventEmitter = require("events");
const config = require("./config");
const { TokenStateManager, PricePoint, STATES } = require("./TokenStateManager");

class Token extends EventEmitter {
  constructor(tokenData, priceManager) {
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
    this.priceManager = priceManager;

    // Initialize state manager
    this.stateManager = new TokenStateManager(config);
    this.highestMarketCap = this.marketCapSol;

    // Initialize metrics tracking
    this.metrics = {
      volumeData: {
        maxWalletVolumePercentage: 0,
        suspectedWashTradePercentage: 0,
        lastCleanup: Date.now(),
        cleanupInterval: 5 * 60 * 1000 // 5 minutes
      }
    };

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
      priceAcceleration: 0
    };

    // Price tracking
    this.currentPrice = this.calculateTokenPrice();
    this.initialPrice = this.currentPrice;
    this.priceHistory = [{
      price: this.currentPrice,
      timestamp: Date.now()
    }];
    this.priceVolatility = 0;

    // Initialize volume tracking (by-second windows for instant pump detection)
    this.volume5s = 0;    // 5 second volume
    this.volume10s = 0;   // 10 second volume
    this.volume30s = 0;   // 30 second volume

    // Initialize wallets map
    this.wallets = new Map();
    
    // Initialize creator as holder if initial balance provided
    if (tokenData.newTokenBalance || tokenData.initialBuy) {
      const balance = tokenData.newTokenBalance || tokenData.initialBuy;
      this.wallets.set(tokenData.traderPublicKey, {
        balance,
        initialBalance: balance,
        trades: [],
        firstSeen: Date.now(),
        lastActive: Date.now(),
        isCreator: true
      });
    }
  }

  get state() {
    return this.stateManager.state;
  }

  update(data) {
    const oldPrice = this.currentPrice;
    const now = Date.now();
    
    if (data.marketCapSol) {
      if (data.marketCapSol > this.highestMarketCap) {
        this.highestMarketCap = data.marketCapSol;
      }
      this.marketCapSol = data.marketCapSol;
    }

    if (data.vTokensInBondingCurve) {
      this.vTokensInBondingCurve = data.vTokensInBondingCurve;
    }

    if (data.vSolInBondingCurve) {
      this.vSolInBondingCurve = data.vSolInBondingCurve;
    }

    // Calculate new price
    this.currentPrice = this.calculateTokenPrice();

    // Handle trade data
    if (data.txType === 'buy' || data.txType === 'sell') {
      const volumeInSol = Math.abs(data.tokenAmount * this.currentPrice);
      const volumeInUSD = this.priceManager.solToUSD(volumeInSol);
      
      // Update wallet activity with trade data
      this.updateWalletActivity(data.traderPublicKey, {
        amount: data.tokenAmount,
        volumeInSol,
        volumeInUSD,
        priceChange: ((this.currentPrice - oldPrice) / oldPrice) * 100,
        timestamp: now,
        newBalance: data.newTokenBalance
      });

      // Update volume metrics with actual USD volume using by-second windows
      this.volume5s = this.getRecentVolume(5 * 1000);    // 5 seconds
      this.volume10s = this.getRecentVolume(10 * 1000);  // 10 seconds
      this.volume30s = this.getRecentVolume(30 * 1000);  // 30 seconds
    }
    // Update wallet balance if no trade (e.g., transfer)
    else if (data.traderPublicKey && typeof data.newTokenBalance !== "undefined") {
      this.updateWalletBalance(data.traderPublicKey, data.newTokenBalance, now);
    }

    // Update price metrics and check state transitions
    this.updatePriceMetrics();
    this.handleStateTransitions();
  }

  handleStateTransitions() {
    const currentPrice = new PricePoint(
      this.calculateTokenPrice(),
      this.calculateTokenPrice(),
      Date.now()
    );

    // Update price history based on current state
    this.stateManager.updatePriceHistory(currentPrice);

    // Handle state transitions based on current state
    if (this.state === STATES.NEW) {
      // Check for initial pump
      const metrics = {
        priceIncrease: this.getPriceIncrease(300), // 5 minutes
        volumeSpike: this.getVolumeSpike(),
        buyPressure: this.getBuyPressure(),
        isFirstPump: true,
        isHeatingUp: this.isHeatingUp()
      };

      if (this.stateManager.isPumpDetected(metrics)) {
        this.stateManager.transitionToPumping(currentPrice);
        this.emit("stateChanged", { token: this, from: STATES.NEW, to: STATES.PUMPING });
      }
    }
    // Handle pump monitoring and drawdown detection
    else if (this.state === STATES.PUMPING) {
      if (this.stateManager.isDrawdownTriggered(currentPrice, this.stateManager.priceHistory.peak)) {
        this.stateManager.transitionToDrawdown(currentPrice);
        this.emit("stateChanged", { token: this, from: STATES.PUMPING, to: STATES.DRAWDOWN });
      }
    }
    // Handle drawdown and check for new pump
    else if (this.state === STATES.DRAWDOWN) {
      // Check for new pump
      const metrics = {
        priceIncrease: this.getPriceIncrease(300), // 5 minutes
        volumeSpike: this.getVolumeSpike(),
        buyPressure: this.getBuyPressure(),
        isFirstPump: false,
        isHeatingUp: this.isHeatingUp()
      };

      if (this.stateManager.isPumpDetected(metrics)) {
        this.stateManager.transitionToPumping(currentPrice);
        this.emit("stateChanged", { token: this, from: STATES.DRAWDOWN, to: STATES.PUMPING });
      }
    }
  }

  getPriceIncrease(seconds) {
    const timeWindow = seconds * 1000;
    const now = Date.now();
    const oldPrice = this.priceBuffer.data
      .filter(p => p && p.timestamp > now - timeWindow)
      .sort((a, b) => a.timestamp - b.timestamp)[0];

    if (!oldPrice) return 0;
    return ((this.currentPrice - oldPrice.price) / oldPrice.price) * 100;
  }

  getVolumeSpike() {
    const volume5s = this.volume5s;
    const volume30s = this.volume30s;
    
    if (volume30s === 0) return 0;
    
    // Calculate volume spike by comparing 5s rate to 30s rate
    const volume5sRate = volume5s / 5;    // Volume per second in 5s window
    const volume30sRate = volume30s / 30; // Volume per second in 30s window
    
    if (volume30sRate === 0) return 0;
    
    // Convert to percentage increase/decrease from baseline rate
    const volumeSpike = ((volume5sRate / volume30sRate) - 1) * 100;
    return volumeSpike;
  }

  getBuyPressure() {
    const timeWindow = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();
    let buyVolume = 0;
    let totalVolume = 0;

    for (const [_, wallet] of this.wallets) {
      const recentTrades = wallet.trades.filter(t => t.timestamp > now - timeWindow);
      for (const trade of recentTrades) {
        if (trade.priceChange >= 0) {
          buyVolume += trade.volumeInUSD;
        }
        totalVolume += trade.volumeInUSD;
      }
    }

    return totalVolume > 0 ? (buyVolume / totalVolume) * 100 : 0;
  }

  async evaluateRecovery(safetyChecker) {
    try {
      if (this.state !== STATES.RECOVERY) return;

      const isSecure = await safetyChecker.runSecurityChecks(this);
      if (!isSecure) {
        const failureReason = safetyChecker.getFailureReason();
        this.stateManager.addUnsafeReason(failureReason.reason, failureReason.value);
        this.emit("unsafeRecovery", { 
          token: this, 
          marketCap: this.marketCapSol,
          ...failureReason
        });
      } else {
        this.stateManager.resetUnsafeReasons();
      }
    } catch (error) {
      console.error("Error evaluating recovery:", error);
    }
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
    let volumeInUSD = 0;
    
    for (const [_, wallet] of this.wallets) {
      // Filter trades within timeWindow and sum their volumes
      const recentTrades = wallet.trades.filter(trade => trade.timestamp > cutoff);
      volumeInUSD += recentTrades.reduce((sum, trade) => {
        // Ensure we're using absolute values for volume calculation
        return sum + Math.abs(trade.volumeInUSD || 0);
      }, 0);
    }
    
    return volumeInUSD;
  }

  updateWalletActivity(publicKey, tradeData) {
    let wallet = this.wallets.get(publicKey);
    const now = tradeData.timestamp;

    // Create new wallet data if doesn't exist
    if (!wallet) {
      wallet = {
        balance: 0,
        initialBalance: tradeData.newBalance || 0,
        trades: [],
        firstSeen: now,
        lastActive: now,
        isCreator: false
      };
      this.wallets.set(publicKey, wallet);
    }

    // Update wallet data
    wallet.lastActive = now;
    wallet.balance = tradeData.newBalance !== undefined ? tradeData.newBalance : wallet.balance;
    
    // Store trade data with volume in both SOL and USD
    wallet.trades.push({
      amount: tradeData.amount,
      volumeInSol: tradeData.volumeInSol,
      volumeInUSD: this.priceManager.solToUSD(tradeData.volumeInSol || 0),
      priceChange: tradeData.priceChange,
      timestamp: now
    });

    // Update volume metrics with USD volume
    this.volume5s = this.getRecentVolume(5 * 1000);    // 5 seconds
    this.volume10s = this.getRecentVolume(10 * 1000);  // 10 seconds
    this.volume30s = this.getRecentVolume(30 * 1000);  // 30 seconds

    // Cleanup old trades
    if (now - this.metrics.volumeData.lastCleanup > this.metrics.volumeData.cleanupInterval) {
      const cutoff = now - 30 * 60 * 1000; // 30 minutes
      for (const [_, walletData] of this.wallets) {
        walletData.trades = walletData.trades.filter(t => t.timestamp > cutoff);
      }
      this.metrics.volumeData.lastCleanup = now;
    }
  }

  updateWalletBalance(publicKey, newBalance, timestamp) {
    let wallet = this.wallets.get(publicKey);

    if (newBalance > 0) {
      if (!wallet) {
        wallet = {
          balance: newBalance,
          initialBalance: newBalance,
          trades: [],
          firstSeen: timestamp,
          lastActive: timestamp,
          isCreator: false
        };
        this.wallets.set(publicKey, wallet);
      } else {
        wallet.balance = newBalance;
        wallet.lastActive = timestamp;
      }
    } else {
      // Only delete if wallet exists and has no recent trades
      if (wallet) {
        const hasRecentTrades = wallet.trades.some(t => 
          t.timestamp > timestamp - 30 * 60 * 1000
        );
        if (!hasRecentTrades) {
          this.wallets.delete(publicKey);
        } else {
          wallet.balance = 0;
          wallet.lastActive = timestamp;
        }
      }
    }
  }

  getHolderCount() {
    return Array.from(this.wallets.values()).filter(w => w.balance > 0).length;
  }

  getTotalTokensHeld() {
    return Array.from(this.wallets.values())
      .reduce((sum, wallet) => sum + wallet.balance, 0);
  }

  getTopHolderConcentration(topN = 10) {
    const totalSupply = this.getTotalSupply();
    if (totalSupply === 0) return 0;

    // Get holder balances and sort by balance
    const holderBalances = Array.from(this.wallets.values())
      .filter(w => w.balance > 0)
      .map(w => w.balance)
      .sort((a, b) => b - a);

    // Take top N holders
    const topBalances = holderBalances.slice(0, Math.min(topN, holderBalances.length));
    const topHoldersBalance = topBalances.reduce((sum, balance) => sum + balance, 0);

    return (topHoldersBalance / totalSupply) * 100;
  }

  getTraderStats(interval = "5m") {
    const now = Date.now();
    const cutoffTime = now - (parseInt(interval) * 60 * 1000);
    let totalVolume = 0;
    const traderStats = new Map();

    // Analyze each wallet's trading activity
    for (const [publicKey, wallet] of this.wallets) {
      const recentTrades = wallet.trades.filter(t => t.timestamp > cutoffTime);
      if (recentTrades.length === 0) continue;

      const stats = {
        volumeTotal: 0,
        tradeCount: recentTrades.length,
        buyVolume: 0,
        sellVolume: 0,
        currentBalance: wallet.balance,
        walletAge: now - wallet.firstSeen
      };

      for (const trade of recentTrades) {
        stats.volumeTotal += trade.volumeInUSD;
        if (trade.priceChange >= 0) {
          stats.buyVolume += trade.volumeInUSD;
        } else {
          stats.sellVolume += trade.volumeInUSD;
        }
      }

      traderStats.set(publicKey, stats);
      totalVolume += stats.volumeTotal;
    }

    // Calculate suspicious activity metrics
    let totalSuspiciousVolume = 0;
    const suspiciousTraders = new Map();

    for (const [publicKey, stats] of traderStats) {
      const volumePercentage = (stats.volumeTotal / totalVolume) * 100;
      const buyToSellRatio = stats.buyVolume / (stats.sellVolume || 1);
      const isSuspicious = (
        (volumePercentage > config.SAFETY.MAX_WALLET_VOLUME_PERCENTAGE) ||
        (stats.tradeCount > 10 && buyToSellRatio > 0.9 && buyToSellRatio < 1.1)
      );

      if (isSuspicious) {
        suspiciousTraders.set(publicKey, {
          volumePercentage,
          buyToSellRatio,
          tradeCount: stats.tradeCount,
          balance: stats.currentBalance,
          walletAge: stats.walletAge
        });
        totalSuspiciousVolume += stats.volumeTotal;
      }
    }

    return {
      totalVolume,
      uniqueTraders: traderStats.size,
      maxWalletVolumePercentage: Math.max(
        0,
        ...Array.from(traderStats.values()).map(s => (s.volumeTotal / totalVolume) * 100)
      ),
      suspectedWashTradePercentage: totalVolume > 0 ? (totalSuspiciousVolume / totalVolume) * 100 : 0,
      suspiciousTraders: Object.fromEntries(suspiciousTraders)
    };
  }

  updateMetrics() {
    // Update volume metrics with by-second windows
    this.volume5s = this.getRecentVolume(5 * 1000);    // 5 seconds
    this.volume10s = this.getRecentVolume(10 * 1000);  // 10 seconds
    this.volume30s = this.getRecentVolume(30 * 1000);  // 30 seconds

    // Update price stats
    const priceStats = this.getPriceStats();
    const traderStats = this.getTraderStats();

    // Emit metrics update event
    this.emit("metricsUpdate", {
      mint: this.mint,
      symbol: this.symbol,
      state: this.state,
      holders: this.getHolderCount(),
      topHolderConcentration: this.getTopHolderConcentration(),
      priceStats,
      traderStats,
      volume: {
        volume5s: this.volume5s,
        volume10s: this.volume10s,
        volume30s: this.volume30s
      }
    });
  }

  hasCreatorSoldAll() {
    const creatorWallet = this.wallets.get(this.traderPublicKey);
    return creatorWallet ? creatorWallet.balance === 0 : true;
  }

  getCreatorSellPercentage() {
    const creatorWallet = this.wallets.get(this.traderPublicKey);
    if (!creatorWallet) return 0;
    const initialBalance = creatorWallet.initialBalance;
    const currentBalance = creatorWallet.balance;
    return (
      ((initialBalance - currentBalance) /
        initialBalance) *
      100
    );
  }

  getTopHolders(count = 5) {
    return Array.from(this.wallets.entries())
      .sort(([, a], [, b]) => b.balance - a.balance)
      .slice(0, count)
      .map(([address, balance]) => ({ address, balance }));
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

  isHeatingUp(threshold) {
    return this.marketCapSol > threshold;
  }

  isFirstPump(threshold) {
    return this.marketCapSol > threshold;
  }

  isDead(threshold) {
    return this.marketCapSol < threshold;
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
}

module.exports = Token;
