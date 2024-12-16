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
    this.holders = new Map();
    this.creatorInitialHoldings = 0;
    this.unsafeReason = null;

    // Price tracking
    this.currentPrice = this.calculateTokenPrice();
    this.initialPrice = this.currentPrice;
    this.priceHistory = [{
      price: this.currentPrice,
      timestamp: Date.now()
    }];
    this.priceVolatility = 0;

    // Volume and trade tracking
    this.volumeData = {
      trades: [],
      lastCleanup: Date.now(),
      cleanupInterval: 5 * 60 * 1000, // Cleanup every 5 minutes
      volumePriceCorrelation: 1, // Start at 1 (perfect correlation)
      suspectedWashTradePercentage: 0,
      maxWalletVolumePercentage: 0
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
    if (newState === "drawdown") {
      this.drawdownLow = this.marketCapSol;
    }
    this.emit("stateChanged", { token: this, from: oldState, to: newState });
  }

  update(data) {
    const oldPrice = this.currentPrice;
    
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
    this.currentPrice = this.calculateTokenPrice();
    const priceChange = ((this.currentPrice - oldPrice) / oldPrice) * 100;
    this.priceHistory.push({
      price: this.currentPrice,
      timestamp: Date.now()
    });

    // Keep last 30 minutes of price history
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
    this.priceHistory = this.priceHistory.filter(p => p.timestamp > thirtyMinutesAgo);

    // Calculate volatility as standard deviation of price changes
    if (this.priceHistory.length > 1) {
      const changes = [];
      for (let i = 1; i < this.priceHistory.length; i++) {
        const change = ((this.priceHistory[i].price - this.priceHistory[i-1].price) / this.priceHistory[i-1].price) * 100;
        changes.push(change);
      }
      const mean = changes.reduce((sum, change) => sum + change, 0) / changes.length;
      this.priceVolatility = Math.sqrt(changes.reduce((sum, change) => sum + Math.pow(change - mean, 2), 0) / changes.length);
    }

    // Update volume if trade data is provided
    if (data.tradeAmount && data.tokenAmount) {
      const volumeInSol = data.tokenAmount * this.currentPrice;
      this.updateVolume(volumeInSol, data.traderPublicKey, priceChange);
    }

    if (data.traderPublicKey && typeof data.newTokenBalance !== "undefined") {
      if (data.newTokenBalance > 0) {
        this.holders.set(data.traderPublicKey, data.newTokenBalance);
      } else {
        this.holders.delete(data.traderPublicKey);
      }
    }

    // Update all metrics
    this.updateMetrics();
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

  updateVolume(tradeAmount, traderPublicKey, priceChange) {
    const now = Date.now();

    // Add new trade
    this.volumeData.trades.push({
      amount: tradeAmount,
      timestamp: now,
      trader: traderPublicKey,
      priceChange
    });

    // Cleanup old trades periodically
    if (now - this.volumeData.lastCleanup > this.volumeData.cleanupInterval) {
      const thirtyMinutesAgo = now - 30 * 60 * 1000;
      this.volumeData.trades = this.volumeData.trades.filter(
        (trade) => trade.timestamp > thirtyMinutesAgo
      );
      this.volumeData.lastCleanup = now;

      // Calculate volume-price correlation
      if (this.volumeData.trades.length > 1) {
        const volumes = this.volumeData.trades.map(t => t.amount);
        const priceChanges = this.volumeData.trades.map(t => t.priceChange);
        this.volumeData.volumePriceCorrelation = this.calculateCorrelation(volumes, priceChanges);
      }

      // Calculate wallet volume percentages
      const traderVolumes = new Map();
      const totalVolume = this.volumeData.trades.reduce((sum, trade) => {
        const trader = trade.trader;
        const current = traderVolumes.get(trader) || 0;
        traderVolumes.set(trader, current + trade.amount);
        return sum + trade.amount;
      }, 0);

      // Find max wallet volume percentage
      this.volumeData.maxWalletVolumePercentage = Math.max(
        ...Array.from(traderVolumes.values()).map(vol => (vol / totalVolume) * 100)
      );

      // Detect potential wash trading
      this.detectWashTrading(traderVolumes, totalVolume);
    }
  }

  calculateCorrelation(volumes, priceChanges) {
    if (volumes.length !== priceChanges.length || volumes.length < 2) {
      return 1; // Default to perfect correlation if not enough data
    }

    const n = volumes.length;
    const sumX = volumes.reduce((a, b) => a + b, 0);
    const sumY = priceChanges.reduce((a, b) => a + b, 0);
    const sumXY = volumes.reduce((sum, x, i) => sum + x * priceChanges[i], 0);
    const sumX2 = volumes.reduce((sum, x) => sum + x * x, 0);
    const sumY2 = priceChanges.reduce((sum, y) => sum + y * y, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    return denominator === 0 ? 1 : numerator / denominator;
  }

  detectWashTrading(traderVolumes, totalVolume) {
    // Consider it wash trading if a trader's buy and sell volumes are suspiciously balanced
    let suspectedWashVolume = 0;

    for (const [trader, volume] of traderVolumes.entries()) {
      const trades = this.volumeData.trades.filter(t => t.trader === trader);
      const buyVolume = trades.filter(t => t.priceChange >= 0).reduce((sum, t) => sum + t.amount, 0);
      const sellVolume = trades.filter(t => t.priceChange < 0).reduce((sum, t) => sum + t.amount, 0);

      // If buy and sell volumes are within 10% of each other, consider it suspicious
      if (Math.abs(buyVolume - sellVolume) / Math.max(buyVolume, sellVolume) < 0.1) {
        suspectedWashVolume += volume;
      }
    }

    this.volumeData.suspectedWashTradePercentage = (suspectedWashVolume / totalVolume) * 100;
  }

  getVolume(interval = "1m") {
    const now = Date.now();
    let cutoffTime;

    switch (interval) {
      case "1m":
        cutoffTime = now - 60 * 1000;
        break;
      case "5m":
        cutoffTime = now - 5 * 60 * 1000;
        break;
      case "30m":
        cutoffTime = now - 30 * 60 * 1000;
        break;
      default:
        throw new Error('Invalid volume interval. Use "1m", "5m", or "30m"');
    }

    return this.volumeData.trades
      .filter((trade) => trade.timestamp > cutoffTime)
      .reduce((sum, trade) => sum + trade.amount, 0);
  }

  getTradeStats(interval = "5m") {
    const now = Date.now();
    const cutoffTime = now - parseInt(interval) * 60 * 1000;
    const periodTrades = this.volumeData.trades.filter(
      (trade) => trade.timestamp > cutoffTime
    );

    if (periodTrades.length === 0) {
      return {
        count: 0,
        volume: 0,
        averageSize: 0,
        largestTrade: 0,
        smallestTrade: 0,
      };
    }

    const volume = periodTrades.reduce((sum, trade) => sum + trade.amount, 0);
    const largestTrade = Math.max(...periodTrades.map((trade) => trade.amount));
    const smallestTrade = Math.min(
      ...periodTrades.map((trade) => trade.amount)
    );

    return {
      count: periodTrades.length,
      volume,
      averageSize: volume / periodTrades.length,
      largestTrade,
      smallestTrade,
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

  getHolderCount() {
    return this.holders.size;
  }

  getTotalTokensHeld() {
    // Sum only the tokens held by actual holders (excluding liquidity pool)
    return Array.from(this.holders.values()).reduce(
      (sum, balance) => sum + balance,
      0
    );
  }

  getTotalSupply() {
    // Total supply includes both held tokens and tokens in the liquidity pool
    return this.getTotalTokensHeld() + (this.vTokensInBondingCurve || 0);
  }

  getTopHolderConcentration(topN = 10) {
    const totalSupply = this.getTotalSupply();
    if (totalSupply === 0) return 0;

    // Get holder balances (excluding bonding curve)
    const holderBalances = Array.from(this.holders.values());

    // Sort balances in descending order and take top N
    const topBalances = holderBalances
      .sort((a, b) => b - a)
      .slice(0, Math.min(topN, holderBalances.length));

    // Calculate total balance of top holders
    const topHoldersBalance = topBalances.reduce((sum, balance) => sum + balance, 0);

    // Calculate concentration as percentage of total supply
    return (topHoldersBalance / totalSupply) * 100;
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

  getCreatorHoldings() {
    // Get current creator balance
    const creatorBalance = this.holders.get(this.traderPublicKey) || 0;
    const totalSupply = this.getTotalSupply();
    
    // Return as percentage
    return totalSupply > 0 ? (creatorBalance / totalSupply) * 100 : 0;
  }

  getPriceStats() {
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    const recentPrices = this.priceHistory.filter(p => p.timestamp > fiveMinutesAgo);

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

  getTraderStats(interval = "5m") {
    const now = Date.now();
    const cutoffTime = now - (parseInt(interval) * 60 * 1000);
    const relevantTrades = this.volumeData.trades.filter(t => t.timestamp > cutoffTime);

    // Group trades by trader
    const traderStats = new Map();
    let totalVolume = 0;

    for (const trade of relevantTrades) {
      const trader = trade.trader;
      const stats = traderStats.get(trader) || {
        volumeTotal: 0,
        tradeCount: 0,
        buyVolume: 0,
        sellVolume: 0
      };

      stats.volumeTotal += trade.amount;
      stats.tradeCount++;
      if (trade.priceChange >= 0) {
        stats.buyVolume += trade.amount;
      } else {
        stats.sellVolume += trade.amount;
      }

      traderStats.set(trader, stats);
      totalVolume += trade.amount;
    }

    // Calculate percentages and identify suspicious patterns
    const suspiciousTraders = new Map();
    let totalSuspiciousVolume = 0;

    for (const [trader, stats] of traderStats.entries()) {
      const volumePercentage = (stats.volumeTotal / totalVolume) * 100;
      const buyToSellRatio = stats.buyVolume / (stats.sellVolume || 1);

      // Check for suspicious patterns
      const isSuspicious = (
        (volumePercentage > config.SAFETY.MAX_WALLET_VOLUME_PERCENTAGE) ||
        (stats.tradeCount > 10 && buyToSellRatio > 0.9 && buyToSellRatio < 1.1) // Balanced buy/sell ratio with high frequency
      );

      if (isSuspicious) {
        suspiciousTraders.set(trader, {
          volumePercentage,
          buyToSellRatio,
          tradeCount: stats.tradeCount
        });
        totalSuspiciousVolume += stats.volumeTotal;
      }
    }

    return {
      totalVolume,
      uniqueTraders: traderStats.size,
      maxWalletVolumePercentage: Math.max(...Array.from(traderStats.values()).map(s => (s.volumeTotal / totalVolume) * 100)),
      suspectedWashTradePercentage: (totalSuspiciousVolume / totalVolume) * 100,
      suspiciousTraders: Object.fromEntries(suspiciousTraders)
    };
  }

  updateMetrics() {
    // Update price stats
    const priceStats = this.getPriceStats();
    this.priceVolatility = priceStats.volatility;

    // Update trader stats
    const traderStats = this.getTraderStats("5m");
    this.volumeData.maxWalletVolumePercentage = traderStats.maxWalletVolumePercentage;
    this.volumeData.suspectedWashTradePercentage = traderStats.suspectedWashTradePercentage;

    // Emit metrics update event for monitoring
    this.emit("metricsUpdated", {
      token: this.mint,
      priceStats,
      traderStats
    });
  }

  hasCreatorSoldAll() {
    return this.getCreatorHoldings() === 0;
  }

  getCreatorSellPercentage() {
    if (!this.creatorInitialHoldings) return 0;
    const currentCreatorHoldings = this.getCreatorHoldings();
    return (
      ((this.creatorInitialHoldings - currentCreatorHoldings) /
        this.creatorInitialHoldings) *
      100
    );
  }

  getTopHolders(count = 5) {
    return Array.from(this.holders.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, count)
      .map(([address, balance]) => ({ address, balance }));
  }
}

module.exports = Token;
