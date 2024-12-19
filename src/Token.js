const EventEmitter = require("events");
const config = require("./config");
const {
  TokenStateManager,
  PricePoint,
  STATES,
} = require("./TokenStateManager");
const { type } = require("os");

class Token extends EventEmitter {
  constructor(tokenData, priceManager, safetyChecker) {
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
    this.safetyChecker = safetyChecker;

    // Initialize state manager
    this.stateManager = new TokenStateManager();

    this.highestMarketCap = this.marketCapSol;

    // Initialize metrics tracking
    this.metrics = {
      volumeData: {
        maxWalletVolumePercentage: 0,
        suspectedWashTradePercentage: 0,
        lastCleanup: Date.now(),
        cleanupInterval: 5 * 60 * 1000, // 5 minutes
      },
    };

    // Optimized price tracking with circular buffer
    this.priceBuffer = {
      data: new Array(30).fill(null),
      head: 0,
      size: 30,
      count: 0,
    };

    // Enhanced metrics for pump detection
    this.pumpMetrics = {
      lastPumpTime: null,
      pumpCount: 0,
      highestGainRate: 0,
      volumeSpikes: [],
      priceAcceleration: 0,
      initialMarketCapUSD: this.priceManager.solToUSD(tokenData.marketCapSol),
    };

    // Unified trade tracking data structure
    this.tradeHistory = {
      trades: [], // Array of {id, price, volume, timestamp, walletAddress, type, side}
      lastTradeId: 0,
      bodyPrice: null,
      wickHigh: null,
      wickLow: null,
      wickDirection: "neutral",
      lastSpreadEvent: 0,
    };

    // Calculate initial price
    this.currentPrice = this.calculateTokenPrice();
    this.initialPrice = this.currentPrice;
    this.priceHistory = [
      {
        price: this.currentPrice,
        timestamp: Date.now(),
      },
    ];
    this.priceVolatility = 0;

    // Initialize volume tracking
    this.volume1m = 0;
    this.volume5m = 0;
    this.volume30m = 0;

    // Initialize wallets map - now with trade references
    this.wallets = new Map(); // Map<walletAddress, {balance, initialBalance, tradeIds: Set<number>, firstSeen, lastActive, isCreator}>

    // Initialize creator as holder if initial balance provided
    if (tokenData.newTokenBalance || tokenData.initialBuy) {
      const balance = tokenData.newTokenBalance || tokenData.initialBuy;
      this.wallets.set(tokenData.traderPublicKey, {
        balance,
        initialBalance: balance,
        tradeIds: new Set(),
        firstSeen: Date.now(),
        lastActive: Date.now(),
        isCreator: true,
      });
    }
  }

  get state() {
    return this.stateManager.state;
  }

  update(data) {
    const now = Date.now();

    // Store initial market cap for new tokens
    if (!this.pumpMetrics.initialMarketCapUSD && data.marketCapSol) {
      this.pumpMetrics.initialMarketCapUSD = this.priceManager.solToUSD(
        data.marketCapSol
      );
    }

    // Update token data
    this.vTokensInBondingCurve = data.vTokensInBondingCurve;
    this.vSolInBondingCurve = data.vSolInBondingCurve;
    this.marketCapSol = data.marketCapSol;

    // Update price tracking
    this.updatePriceMetrics();

    // Update wallet data if trade occurred
    if (data.tokenAmount) {
      this.updateWalletActivity(data.traderPublicKey, {
        balance: data.newTokenBalance,
        amount: data.tokenAmount,
        type: data.txType,
        timestamp: now,
      });
    }
    // Handle token creation
    else if (data.txType === "create") {
      this.minted = now;
      this.initialPrice = this.calculateTokenPrice();
      if (data.initialBuy) {
        this.updateWalletActivity(data.traderPublicKey, {
          type: "create",
          amount: data.initialBuy,
          timestamp: now,
          newBalance: data.initialBuy,
          isCreator: true,
        });
      }
    }

    // Update all metrics including volume
    this.updateMetrics();

    // Handle state transitions based on new metrics
    this.handleStateTransitions();
  }

  async handleStateTransitions() {
    // Calculate current prices
    const prices = this.calculatePrices();
    const currentPrice = new PricePoint(
      prices.bodyPrice,
      prices.wickPrice,
      Date.now()
    );

    // Update price history based on current state
    this.stateManager.updatePriceHistory(currentPrice);

    // Update price history and check for state transitions
    const stateChange = this.stateManager.updatePriceHistory(
      currentPrice,
      this.volume5m
    );
    if (stateChange) {
      this.emit("stateChanged", { token: this, ...stateChange });
    }

    // Handle state-specific logic
    if (this.state === STATES.NEW) {
      // Check for initial pump
      if (this.stateManager.isPumpDetected({ currentPrice })) {
        this.stateManager.setState(STATES.PUMPING);
        this.emit("stateChanged", {
          token: this,
          from: STATES.NEW,
          to: STATES.PUMPING,
        });
      }
    } else if (this.state === STATES.PUMPING) {
      // Check for first pump entry opportunity
      if (this.stateManager.canEnterPosition(true)) {
        // Check volume hasn't dropped too much
        if (!this.stateManager.checkPumpSafety(this.volume5m)) {
          this.stateManager.markUnsafe(
            "Volume dropped significantly during pump"
          );
          return;
        }

        // Run safety checks
        const isSafe = await this.safetyChecker.runSecurityChecks(this);
        if (isSafe) {
          this.stateManager.markPositionEntered(true);
          this.emit("readyForPosition", {
            token: this,
            sizeRatio: this.stateManager.getPositionSizeRatio(),
          });
        } else {
          this.stateManager.markUnsafe(this.safetyChecker.lastFailureReason);
        }
      }

      // Check for transition to pumped state
      const gainFromInitial =
        this.stateManager.getGainFromInitial(currentPrice);
      if (gainFromInitial >= config.THRESHOLDS.PUMPED) {
        this.stateManager.setState(STATES.PUMPED);
        this.emit("stateChanged", {
          token: this,
          from: STATES.PUMPING,
          to: STATES.PUMPED,
        });
      }
    }
    // Handle pumped state
    else if (this.state === STATES.PUMPED) {
      // Check for drawdown
      if (this.stateManager.isDrawdownTriggered(currentPrice)) {
        this.stateManager.setState(STATES.DRAWDOWN);
        this.emit("stateChanged", {
          token: this,
          from: STATES.PUMPED,
          to: STATES.DRAWDOWN,
        });
      }
    }
    // Handle drawdown state
    else if (this.state === STATES.DRAWDOWN) {
      // Check if token is dead
      const marketCapUSD = this.priceManager.solToUSD(this.marketCapSol);
      if (marketCapUSD < config.THRESHOLDS.DEAD_USD) {
        this.stateManager.setState(STATES.DEAD);
        this.emit("stateChanged", {
          token: this,
          from: STATES.DRAWDOWN,
          to: STATES.DEAD,
        });
        return;
      }

      // Check for new pump from drawdown
      if (this.stateManager.isPumpDetected({ currentPrice }, true)) {
        // Check if volume has dropped too much
        if (!this.stateManager.checkPumpSafety(this.volume5m)) {
          this.stateManager.markUnsafe(
            "Volume dropped significantly during pump"
          );
          return;
        }

        // Run safety checks if within entry window
        if (this.stateManager.canEnterPosition(false)) {
          const isSafe = await this.safetyChecker.runSecurityChecks(this);
          if (isSafe) {
            this.stateManager.setState(STATES.PUMPING);
            this.stateManager.markPositionEntered(false);
            this.emit("stateChanged", {
              token: this,
              from: STATES.DRAWDOWN,
              to: STATES.PUMPING,
            });
            this.emit("readyForPosition", {
              token: this,
              sizeRatio: this.stateManager.getPositionSizeRatio(),
            });
          } else {
            this.stateManager.markUnsafe(this.safetyChecker.lastFailureReason);
          }
        }
      }
    }
    // Handle recovery state
    else if (this.state === STATES.RECOVERY) {
      // Update recovery price point if higher
      if (
        !this.stateManager.priceHistory.recovery ||
        currentPrice.bodyPrice >
          this.stateManager.priceHistory.recovery.bodyPrice
      ) {
        this.stateManager.priceHistory.recovery = currentPrice;
      }

      // Check if we should enter position
      if (this.stateManager.shouldEnterPosition(currentPrice)) {
        this.emit("readyForPosition", this);
      }
      // Check for new drawdown cycle if we drop below our previous bottom
      else if (
        this.stateManager.priceHistory.bottom &&
        currentPrice.bodyPrice < this.stateManager.priceHistory.bottom.bodyPrice
      ) {
        // Reset bottom for new drawdown cycle
        this.stateManager.priceHistory.bottom = null;
        this.stateManager.transitionToDrawdown(currentPrice);
        this.emit("stateChanged", {
          token: this,
          from: STATES.RECOVERY,
          to: STATES.DRAWDOWN,
        });
      }
    }
  }

  calculatePrices() {
    const now = Date.now();
    const windowStart = now - config.PRICE_CALC.WINDOW;
    const recentStart = now - config.PRICE_CALC.RECENT_WINDOW;

    // Filter trades within window
    this.tradeHistory.trades = this.tradeHistory.trades.filter(
      (t) => t.timestamp > windowStart
    );

    if (this.tradeHistory.trades.length === 0) {
      const currentPrice = this.calculateTokenPrice();
      return {
        bodyPrice: currentPrice,
        wickPrice: currentPrice,
      };
    }

    // Calculate weighted body price
    let totalWeight = 0;
    let weightedSum = 0;

    this.tradeHistory.trades.forEach((trade) => {
      const weight =
        trade.volume *
        (trade.timestamp > recentStart ? config.PRICE_CALC.RECENT_WEIGHT : 1);
      weightedSum += trade.price * weight;
      totalWeight += weight;
    });

    const bodyPrice = weightedSum / totalWeight;

    // Calculate wick prices
    const wickHigh = Math.max(...this.tradeHistory.trades.map((t) => t.price));
    const wickLow = Math.min(...this.tradeHistory.trades.map((t) => t.price));

    // Determine wick direction
    const upperWick = wickHigh - bodyPrice;
    const lowerWick = bodyPrice - wickLow;
    const wickDirection =
      upperWick > lowerWick ? "up" : lowerWick > upperWick ? "down" : "neutral";

    // Check for spread event
    const spreadPercentage = ((wickHigh - wickLow) / bodyPrice) * 100;
    if (
      spreadPercentage >= config.THRESHOLDS.SPREAD &&
      now - this.tradeHistory.lastSpreadEvent > config.PRICE_CALC.WINDOW
    ) {
      this.tradeHistory.lastSpreadEvent = now;
      this.emit("significantSpread", {
        token: this,
        spreadPercentage,
        wickDirection,
        bodyPrice,
        wickHigh,
        wickLow,
      });
    }

    // Update price data
    this.tradeHistory.bodyPrice = bodyPrice;
    this.tradeHistory.wickHigh = wickHigh;
    this.tradeHistory.wickLow = wickLow;
    this.tradeHistory.wickDirection = wickDirection;

    return {
      bodyPrice,
      wickPrice: wickDirection === "up" ? wickHigh : wickLow,
    };
  }

  getSpreadMetrics() {
    return {
      spreadPercentage: this.tradeHistory.wickHigh
        ? ((this.tradeHistory.wickHigh - this.tradeHistory.wickLow) /
            this.tradeHistory.bodyPrice) *
          100
        : 0,
      wickDirection: this.tradeHistory.wickDirection,
      bodyPrice: this.tradeHistory.bodyPrice,
      wickHigh: this.tradeHistory.wickHigh,
      wickLow: this.tradeHistory.wickLow,
    };
  }

  getPriceIncrease(seconds) {
    const timeWindow = seconds * 1000;
    const now = Date.now();
    const oldPrice = this.priceBuffer.data
      .filter((p) => p && p.timestamp > now - timeWindow)
      .sort((a, b) => a.timestamp - b.timestamp)[0];

    if (!oldPrice) return 0;
    return ((this.currentPrice - oldPrice.price) / oldPrice.price) * 100;
  }

  getVolumeSpike() {
    const baseVolume = this.volume5m / 5; // Average volume per minute over 5 minutes
    return this.volume1m > 0 ? (this.volume1m / baseVolume) * 100 : 0;
  }

  getBuyPressure() {
    const timeWindow = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();
    let buyVolume = 0;
    let totalVolume = 0;

    for (const [_, wallet] of this.wallets) {
      const recentTrades = wallet.trades.filter(
        (t) => t.timestamp > now - timeWindow
      );
      for (const trade of recentTrades) {
        if (trade.priceChange >= 0) {
          buyVolume += trade.volumeInSol;
        }
        totalVolume += trade.volumeInSol;
      }
    }

    return totalVolume > 0 ? (buyVolume / totalVolume) * 100 : 0;
  }

  updatePriceMetrics() {
    const now = Date.now();
    const newPrice = this.calculateTokenPrice();

    // Update circular buffer
    this.priceBuffer.data[this.priceBuffer.head] = {
      price: newPrice,
      timestamp: now,
    };
    this.priceBuffer.head = (this.priceBuffer.head + 1) % this.priceBuffer.size;
    this.priceBuffer.count = Math.min(
      this.priceBuffer.count + 1,
      this.priceBuffer.size
    );

    // Calculate price acceleration (rate of price change)
    if (this.priceBuffer.count >= 3) {
      const idx1 =
        (this.priceBuffer.head - 1 + this.priceBuffer.size) %
        this.priceBuffer.size;
      const idx2 =
        (this.priceBuffer.head - 2 + this.priceBuffer.size) %
        this.priceBuffer.size;
      const idx3 =
        (this.priceBuffer.head - 3 + this.priceBuffer.size) %
        this.priceBuffer.size;

      const price1 = this.priceBuffer.data[idx1].price;
      const price2 = this.priceBuffer.data[idx2].price;
      const price3 = this.priceBuffer.data[idx3].price;

      const time1 = this.priceBuffer.data[idx1].timestamp;
      const time2 = this.priceBuffer.data[idx2].timestamp;
      const time3 = this.priceBuffer.data[idx3].timestamp;

      const rate1 = (price1 - price2) / (time1 - time2);
      const rate2 = (price2 - price3) / (time2 - time3);

      this.pumpMetrics.priceAcceleration =
        (rate1 - rate2) / ((time1 - time3) / 2000);
    }

    // Detect pump conditions
    const priceChange =
      ((newPrice - this.currentPrice) / this.currentPrice) * 100;
    const timeWindow = 5 * 1000; // 5 second window for pump detection

    if (
      priceChange > config.THRESHOLDS.PUMP &&
      (!this.pumpMetrics.lastPumpTime ||
        now - this.pumpMetrics.lastPumpTime > timeWindow)
    ) {
      this.pumpMetrics.pumpCount++;
      this.pumpMetrics.lastPumpTime = now;

      const gainRate = priceChange / (timeWindow / 1000); // %/second
      this.pumpMetrics.highestGainRate = Math.max(
        this.pumpMetrics.highestGainRate,
        gainRate
      );

      // Track volume spike
      // const recentVolume = this.getRecentVolume(timeWindow);
      // this.pumpMetrics.volumeSpikes.push({
      //   timestamp: now,
      //   volume: recentVolume,
      //   priceChange,
      // });

      // // Cleanup old volume spikes
      // const cutoff = now - 30 * 1000; // Keep last 30 seconds
      // this.pumpMetrics.volumeSpikes = this.pumpMetrics.volumeSpikes.filter(
      //   (spike) => spike.timestamp > cutoff
      // );
    }

    this.currentPrice = newPrice;
  }

  getRecentVolume(timeWindow) {
    const now = Date.now();
    const cutoff = now - timeWindow;
    
    return this.tradeHistory.trades
      .filter(trade => trade.timestamp > cutoff)
      .reduce((sum, trade) => sum + Math.abs(trade.volume), 0);
  }

  updateWalletActivity(publicKey, tradeData) {
    let wallet = this.wallets.get(publicKey);
    const now = tradeData.timestamp;

    // Create new wallet data if doesn't exist
    if (!wallet) {
      wallet = {
        balance: tradeData.balance,
        initialBalance: tradeData.balance,
        trades: [],
        firstSeen: now,
        lastActive: now,
        isCreator: false,
      };
      this.wallets.set(publicKey, wallet);
    }

    // Update wallet data
    wallet.lastActive = now;
    wallet.balance = tradeData.balance;

    // Store trade data with token amount
    wallet.trades.push({
      amount: tradeData.amount,
      type: tradeData.type, // "buy" or "sell"
      timestamp: now,
    });

    // Cleanup old trades
    if (
      now - this.metrics.volumeData.lastCleanup >
      this.metrics.volumeData.cleanupInterval
    ) {
      const cutoff = now - 30 * 60 * 1000; // 30 minutes
      for (const [_, walletData] of this.wallets) {
        walletData.trades = walletData.trades.filter(
          (t) => t.timestamp > cutoff
        );
      }
      this.metrics.volumeData.lastCleanup = now;
    }
  }

  getHolderCount() {
    return Array.from(this.wallets.values()).filter((w) => w.balance > 0)
      .length;
  }

  getTotalTokensHeld() {
    return Array.from(this.wallets.values()).reduce(
      (sum, wallet) => sum + wallet.balance,
      0
    );
  }

  getTopHolderConcentration(topN = 10) {
    const totalSupply = this.getTotalSupply();
    if (totalSupply === 0) return 0;

    // Get holder balances and sort by balance
    const holderBalances = Array.from(this.wallets.values())
      .filter((w) => w.balance > 0)
      .map((w) => w.balance)
      .sort((a, b) => b - a);

    // Take top N holders
    const topBalances = holderBalances.slice(
      0,
      Math.min(topN, holderBalances.length)
    );
    const topHoldersBalance = topBalances.reduce(
      (sum, balance) => sum + balance,
      0
    );

    return (topHoldersBalance / totalSupply) * 100;
  }

  getTraderStats(interval = "5m") {
    const now = Date.now();
    const cutoffTime = now - parseInt(interval) * 60 * 1000;
    let totalVolume = 0;
    const traderStats = new Map();

    // Analyze each wallet's trading activity
    for (const [publicKey, wallet] of this.wallets) {
      const recentTrades = wallet.trades.filter(
        (t) => t.timestamp > cutoffTime
      );
      if (recentTrades.length === 0) continue;

      const stats = {
        volumeTotal: 0,
        tradeCount: recentTrades.length,
        buyVolume: 0,
        sellVolume: 0,
        currentBalance: wallet.balance,
        walletAge: now - wallet.firstSeen,
      };

      for (const trade of recentTrades) {
        stats.volumeTotal += trade.amount;
        if (trade.type === "buy") {
          stats.buyVolume += trade.amount;
        } else {
          stats.sellVolume += trade.amount;
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
      const isSuspicious =
        volumePercentage > config.SAFETY.MAX_WALLET_VOLUME_PERCENTAGE ||
        (stats.tradeCount > 10 && buyToSellRatio > 0.9 && buyToSellRatio < 1.1);

      if (isSuspicious) {
        suspiciousTraders.set(publicKey, {
          volumePercentage,
          buyToSellRatio,
          tradeCount: stats.tradeCount,
          balance: stats.currentBalance,
          walletAge: stats.walletAge,
        });
        totalSuspiciousVolume += stats.volumeTotal;
      }
    }

    return {
      totalVolume,
      uniqueTraders: traderStats.size,
      maxWalletVolumePercentage: Math.max(
        0,
        ...Array.from(traderStats.values()).map(
          (s) => (s.volumeTotal / totalVolume) * 100
        )
      ),
      suspectedWashTradePercentage:
        totalVolume > 0 ? (totalSuspiciousVolume / totalVolume) * 100 : 0,
      suspiciousTraders: Object.fromEntries(suspiciousTraders),
    };
  }

  updateMetrics() {
    // Update volume metrics
    this.volume1m = this.getRecentVolume(60 * 1000); // 1 minute
    this.volume5m = this.getRecentVolume(5 * 60 * 1000); // 5 minutes
    this.volume30m = this.getRecentVolume(30 * 60 * 1000); // 30 minutes

    // Update price stats
    const priceStats = this.getPriceStats();
    this.priceVolatility = priceStats.volatility;

    // Update trader stats
    const traderStats = this.getTraderStats("5m");
    this.metrics.volumeData.maxWalletVolumePercentage =
      traderStats.maxWalletVolumePercentage;
    this.metrics.volumeData.suspectedWashTradePercentage =
      traderStats.suspectedWashTradePercentage;

    // Emit metrics update event for monitoring
    this.emit("metricsUpdated", {
      token: this.mint,
      priceStats,
      traderStats,
      volume: {
        volume1m: this.volume1m,
        volume5m: this.volume5m,
        volume30m: this.volume30m,
      },
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
    return ((initialBalance - currentBalance) / initialBalance) * 100;
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
    const recentPrices = this.priceBuffer.data.filter(
      (p) => p && p.timestamp > fiveMinutesAgo
    );

    if (recentPrices.length < 2) {
      return {
        volatility: 0,
        highestPrice: this.currentPrice,
        lowestPrice: this.currentPrice,
        priceChange: 0,
      };
    }

    // Calculate price changes as percentages
    const changes = [];
    for (let i = 1; i < recentPrices.length; i++) {
      const change =
        ((recentPrices[i].price - recentPrices[i - 1].price) /
          recentPrices[i - 1].price) *
        100;
      changes.push(change);
    }

    // Calculate volatility (standard deviation of price changes)
    const mean =
      changes.reduce((sum, change) => sum + change, 0) / changes.length;
    const volatility = Math.sqrt(
      changes.reduce((sum, change) => sum + Math.pow(change - mean, 2), 0) /
        changes.length
    );

    // Get highest and lowest prices
    const prices = recentPrices.map((p) => p.price);
    const highestPrice = Math.max(...prices);
    const lowestPrice = Math.min(...prices);

    // Calculate total price change
    const totalChange =
      ((this.currentPrice - recentPrices[0].price) / recentPrices[0].price) *
      100;

    return {
      volatility,
      highestPrice,
      lowestPrice,
      priceChange: totalChange,
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
    if (!this.currentPrice) return 0;

    // For new tokens, calculate gain from initial price
    if (this.state === STATES.NEW) {
      if (!this.initialPrice) return 0;
      return (
        ((this.currentPrice - this.initialPrice) / this.initialPrice) * 100
      );
    }

    // For tokens pumping again, calculate gain from drawdown low
    if (this.state === STATES.PUMPING && this.drawdownLow) {
      return ((this.currentPrice - this.drawdownLow) / this.drawdownLow) * 100;
    }

    // Default to initial price if no drawdown low exists
    if (!this.initialPrice) return 0;
    return ((this.currentPrice - this.initialPrice) / this.initialPrice) * 100;
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

  recordTrade(tradeData) {
    const { price, volume, walletAddress, type, side } = tradeData;
    const timestamp = Date.now();
    
    // Create trade record
    const trade = {
      id: ++this.tradeHistory.lastTradeId,
      price,
      volume,
      timestamp,
      walletAddress,
      type,
      side
    };
    
    // Add to trade history
    this.tradeHistory.trades.push(trade);
    
    // Update wallet data
    let wallet = this.wallets.get(walletAddress);
    if (!wallet) {
      wallet = {
        balance: 0,
        initialBalance: 0,
        tradeIds: new Set(),
        firstSeen: timestamp,
        lastActive: timestamp,
        isCreator: false
      };
      this.wallets.set(walletAddress, wallet);
    }
    
    wallet.tradeIds.add(trade.id);
    wallet.lastActive = timestamp;
    
    // Update wallet balance based on trade side
    if (side === 'buy') {
      wallet.balance += volume;
    } else if (side === 'sell') {
      wallet.balance -= volume;
    }
    
    // Update volume metrics
    this.updateVolumeMetrics();
    
    // Emit trade event for dashboard
    this.emit('trade', trade);
    
    // Update price metrics
    this.updatePriceMetrics();
    
    return trade.id;
  }

  updateVolumeMetrics() {
    const now = Date.now();
    
    // Update rolling volume windows
    this.volume1m = this.getRecentVolume(60 * 1000);      // 1 minute
    this.volume5m = this.getRecentVolume(5 * 60 * 1000);  // 5 minutes
    this.volume30m = this.getRecentVolume(30 * 60 * 1000); // 30 minutes

    // Calculate initial volume metrics for new tokens
    if (now - this.minted < 5 * 60 * 1000) { // Token is less than 5 minutes old
      // Track buy vs sell ratio in early trades
      const recentTrades = this.tradeHistory.trades.filter(t => t.timestamp > this.minted);
      const buyVolume = recentTrades.reduce((sum, t) => sum + (t.side === 'buy' ? t.volume : 0), 0);
      const sellVolume = recentTrades.reduce((sum, t) => sum + (t.side === 'sell' ? t.volume : 0), 0);
      
      this.metrics.earlyTrading = {
        buyToSellRatio: buyVolume / (sellVolume || 1),
        uniqueBuyers: new Set(recentTrades.filter(t => t.side === 'buy').map(t => t.walletAddress)).size,
        uniqueSellers: new Set(recentTrades.filter(t => t.side === 'sell').map(t => t.walletAddress)).size,
        creatorSells: recentTrades.filter(t => t.walletAddress === this.traderPublicKey && t.side === 'sell').length,
        timeToFirstTrade: recentTrades.length > 0 ? recentTrades[0].timestamp - this.minted : null,
        volumeAcceleration: this.calculateVolumeAcceleration()
      };

      // Detect potential fake volume
      const repeatedTraders = this.detectRepeatedTraders(recentTrades);
      if (repeatedTraders.length > 0) {
        this.metrics.earlyTrading.suspiciousActivity = repeatedTraders;
      }
    }
    
    // Update volume spikes detection with enhanced sensitivity for new tokens
    const volumeSpike = this.getVolumeSpike();
    if (volumeSpike) {
      this.pumpMetrics.volumeSpikes.push({
        timestamp: now,
        volume: this.volume1m,
        ratio: volumeSpike,
        isNewToken: now - this.minted < 5 * 60 * 1000
      });
      
      // Cleanup old spikes
      const spikesCutoff = now - 30 * 1000; // Keep last 30 seconds
      this.pumpMetrics.volumeSpikes = this.pumpMetrics.volumeSpikes
        .filter(spike => spike.timestamp > spikesCutoff);
    }
  }

  calculateVolumeAcceleration() {
    const trades = this.tradeHistory.trades;
    if (trades.length < 3) return 0;

    const intervals = [];
    for (let i = 1; i < trades.length; i++) {
      const timeDiff = trades[i].timestamp - trades[i-1].timestamp;
      const volumeDiff = trades[i].volume - trades[i-1].volume;
      intervals.push(volumeDiff / (timeDiff || 1));
    }

    // Calculate rate of change of volume over time
    let acceleration = 0;
    for (let i = 1; i < intervals.length; i++) {
      acceleration += intervals[i] - intervals[i-1];
    }
    
    return acceleration / (intervals.length - 1);
  }

  detectRepeatedTraders(trades) {
    const traderFrequency = new Map();
    const suspiciousTraders = [];

    trades.forEach(trade => {
      const count = (traderFrequency.get(trade.walletAddress) || 0) + 1;
      traderFrequency.set(trade.walletAddress, count);
      
      // Check for rapid back-and-forth trading
      if (count >= 3) {
        const traderTrades = trades.filter(t => t.walletAddress === trade.walletAddress);
        const rapidTrading = this.checkRapidTrading(traderTrades);
        if (rapidTrading) {
          suspiciousTraders.push({
            wallet: trade.walletAddress,
            tradeCount: count,
            pattern: rapidTrading
          });
        }
      }
    });

    return suspiciousTraders;
  }

  checkRapidTrading(trades) {
    if (trades.length < 3) return null;

    // Look for alternating buy/sell patterns
    let alternatingCount = 0;
    for (let i = 1; i < trades.length; i++) {
      if (trades[i].side !== trades[i-1].side) {
        alternatingCount++;
      }
    }

    if (alternatingCount / trades.length > 0.7) {
      return 'alternating';
    }

    // Check for trades happening too quickly
    const avgTimeBetweenTrades = trades.reduce((sum, trade, i) => {
      if (i === 0) return 0;
      return sum + (trade.timestamp - trades[i-1].timestamp);
    }, 0) / (trades.length - 1);

    if (avgTimeBetweenTrades < 1000) { // Less than 1 second between trades
      return 'rapid';
    }

    return null;
  }

  getTradesByWallet(walletAddress) {
    const wallet = this.wallets.get(walletAddress);
    if (!wallet) return [];
    
    return Array.from(wallet.tradeIds)
      .map(id => this.tradeHistory.trades.find(t => t.id === id))
      .filter(Boolean);
  }
  
  getRecentTrades(timeWindow = 5 * 60 * 1000) { // Default 5 minutes
    const cutoff = Date.now() - timeWindow;
    return this.tradeHistory.trades.filter(t => t.timestamp > cutoff);
  }
}

module.exports = Token;
