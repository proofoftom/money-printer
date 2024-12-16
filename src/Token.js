const EventEmitter = require("events");
const config = require("./config");

class Token extends EventEmitter {
  constructor(tokenData) {
    super();
    this.mint = tokenData.mint;
    this.name = tokenData.name;
    this.symbol = tokenData.symbol;
    this.minted = Date.now();
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

    // Unified trader/holder tracking
    this.wallets = new Map(); // Key: publicKey, Value: WalletData
    
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
      if (this.state === "drawdown" && data.marketCapSol < this.drawdownLow) {
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

    // Update all metrics
    this.updateMetrics();
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
    this.emit('priceUpdate', { 
      price: newPrice, 
      acceleration: this.pumpMetrics.priceAcceleration,
      pumpMetrics: this.pumpMetrics
    });
  }

  getRecentVolume(timeWindow) {
    const now = Date.now();
    const cutoff = now - timeWindow;
    let volume = 0;
    
    for (const [_, wallet] of this.wallets) {
      // Filter trades within timeWindow and sum their volumes
      const recentTrades = wallet.trades.filter(trade => trade.timestamp > cutoff);
      volume += recentTrades.reduce((sum, trade) => {
        // Ensure we're using absolute values for volume calculation
        return sum + Math.abs(trade.volumeInSol || 0);
      }, 0);
    }
    
    return volume;
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
    wallet.trades.push({
      amount: tradeData.amount,
      volumeInSol: tradeData.volumeInSol,
      priceChange: tradeData.priceChange,
      timestamp: now
    });

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
        stats.volumeTotal += trade.volumeInSol;
        if (trade.priceChange >= 0) {
          stats.buyVolume += trade.volumeInSol;
        } else {
          stats.sellVolume += trade.volumeInSol;
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
      traderStats
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

  async evaluateRecovery(safetyChecker) {
    try {
      if (this.state !== "drawdown" && this.state !== "unsafeRecovery") {
        return;
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
          this.emit("readyForPosition", this);
        } else {
          this.setState("unsafeRecovery");
          this.unsafeReason = safetyChecker.getFailureReason();
          this.emit("unsafeRecovery", { 
            token: this, 
            marketCap: this.marketCapSol, 
            reason: this.unsafeReason.reason,
            value: this.unsafeReason.value 
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
            this.emit("readyForPosition", this);
          } else {
            // If gain is too high, stay in unsafeRecovery but notify
            this.emit("recoveryGainTooHigh", {
              token: this,
              gainPercentage,
              marketCap: this.marketCapSol
            });
          }
        } else {
          // Update unsafe reason if it changed
          this.unsafeReason = safetyChecker.getFailureReason();
        }
      }
    } catch (error) {
      console.error("Error evaluating recovery:", error);
      // If we encounter an error during recovery evaluation, stay in current state
    }
  }

  setState(newState) {
    const oldState = this.state;
    this.state = newState;
    if (newState === "drawdown") {
      this.drawdownLow = this.marketCapSol;
    }
    this.emit("stateChanged", { token: this, from: oldState, to: newState });
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
}

module.exports = Token;
