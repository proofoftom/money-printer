const EventEmitter = require("events");
const config = require("../../utils/config");
const TokenStateManager = require("./TokenStateManager");
const errorLogger = require("../../monitoring/errorLoggerInstance");

class Token extends EventEmitter {
  constructor(tokenData) {
    super();

    // Basic token info
    this.address = tokenData.mint;
    this.name = tokenData.name;
    this.symbol = tokenData.symbol;
    this.decimals = 9;

    // Balance tracking
    this.tokenBalance = 0n;
    this.circulatingSupply = 0n;
    this.vTokensInBondingCurve = tokenData.vTokensInBondingCurve;

    // Price and market metrics
    this.currentPrice = 0;
    this.marketCapSol = tokenData.marketCapSol;
    this.highestMarketCap = tokenData.marketCapSol;
    this.drawdownLow = null;

    // Volume metrics
    this.volume1m = 0;
    this.volume5m = 0;
    this.volume30m = 0;
    this.volume24h = 0;

    // Trade tracking
    this.tradeHistory = [];
    this.tradeCount = 0;
    this.lastTradeTime = 0;

    // Market structure analysis
    this.recoveryMetrics = {
      phase: "none",
      marketStructure: "neutral",
    };

    // Initialize balance ledger
    this.balanceLedger = new Map(); // address -> { balance, history, isDev }

    // Initialize creator balance
    if (tokenData.traderPublicKey && tokenData.initialBuy) {
      const creatorAddress = tokenData.traderPublicKey.toLowerCase();
      const initialBalance = BigInt(Math.floor(tokenData.initialBuy * 1e9));

      this.balanceLedger.set(creatorAddress, {
        balance: initialBalance,
        history: [
          {
            timestamp: Date.now(),
            change: initialBalance,
            balance: initialBalance,
            type: "mint",
          },
        ],
        isDev: true,
      });

      // Update total supply to include creator's initial balance
      this.circulatingSupply += initialBalance;
    }

    // Initialize state
    this.state = "new";
    this.stateChangedAt = Date.now();
    this.stateChangeReason = "Token created";

    // Set max listeners
    this.setMaxListeners(20);

    // Initialize listener tracking
    this.registeredListeners = new Map();

    // Set up automatic listener cleanup
    if (process.env.NODE_ENV !== "test") {
      this._cleanupInterval = setInterval(() => {
        this.cleanupStaleListeners();
      }, 60000); // Check every minute
    }
  }

  initializeMetrics() {
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
      pumpTimes: [], // Array to track pump event timestamps
    };

    // Recovery metrics
    this.recoveryMetrics = {
      drawdownDepth: 0,
      recoveryStrength: 0,
      recoveryPhase: "none",
      accumulationScore: 0,
      marketStructure: "neutral",
    };

    // Price tracking
    this.currentPrice = this.calculateTokenPrice();
    this.initialPrice = this.currentPrice;
    this.priceHistory = [
      {
        price: this.currentPrice,
        timestamp: Date.now(),
      },
    ];
    this.priceVolatility = 0;
  }

  update(data) {
    if (!data) return;

    // Create trade entry
    const trade = {
      timestamp: data.timestamp,
      price: data.price,
      amount: data.tokenAmount,
      type: data.type,
      otherParty: data.otherParty,
      signature: data.signature,
      vTokensInBondingCurve: data.vTokensInBondingCurve,
      newTokenBalance: data.newTokenBalance,
      volumeInSol:
        data.tokenAmount * (data.price || this.calculateTokenPrice()),
    };

    // Update trade history
    this.tradeHistory.push(trade);
    this.tradeCount++;
    this.lastTradeTime = trade.timestamp;
    this.currentPrice = trade.price;

    // Update balances based on trade
    this.updateBalances({
      newTokenBalance: trade.newTokenBalance,
      vTokensInBondingCurve: trade.vTokensInBondingCurve,
      traderAddress: trade.traderAddress,
    });

    // Update market cap and recovery metrics
    this.updateMarketMetrics();
    this.analyzeMarketStructure();

    // Emit consolidated state update
    this.emit("stateUpdate", {
      type: "trade",
      token: this,
      data: {
        trade,
        metrics: {
          price: this.currentPrice,
          marketCap: this.marketCapSol,
          volume24h: this.volume24h,
          tradeCount: this.tradeCount,
          recoveryMetrics: this.recoveryMetrics,
        },
      },
    });
  }

  updateVolume(amount, price, timestamp) {
    const volumeInSol = amount * price;
    const now = Date.now();

    // Add to trade history with volume
    const trade = {
      timestamp,
      price,
      amount,
      volumeInSol,
    };

    // Update volume metrics using consolidated method
    this.updateVolumeMetrics();
  }

  updateVolumeMetrics() {
    const now = Date.now();
    this.volume1m = this.getRecentVolume(60 * 1000); // 1 minute
    this.volume5m = this.getRecentVolume(5 * 60 * 1000); // 5 minutes
    this.volume30m = this.getRecentVolume(30 * 60 * 1000); // 30 minutes
    this.volume24h = this.getRecentVolume(24 * 60 * 60 * 1000); // 24 hours
  }

  getRecentVolume(timeWindow) {
    const now = Date.now();
    const cutoff = now - timeWindow;
    return this.tradeHistory
      .filter((trade) => trade.timestamp > cutoff)
      .reduce((sum, trade) => sum + (trade.volumeInSol || 0), 0);
  }

  updatePriceMetrics(newPrice) {
    this.updatePriceBuffer(newPrice);
    this.updateMarketCap(newPrice);
  }

  updatePriceBuffer(newPrice) {
    // Update current price
    this.currentPrice = newPrice;

    // Add to price buffer
    this.priceBuffer.data[this.priceBuffer.head] = newPrice;
    this.priceBuffer.head = (this.priceBuffer.head + 1) % this.priceBuffer.size;
    if (this.priceBuffer.count < this.priceBuffer.size) {
      this.priceBuffer.count++;
    }

    // Calculate price volatility if we have enough data
    if (this.priceBuffer.count > 1) {
      this.calculatePriceVolatility();
    }
  }

  calculatePriceVolatility() {
    const prices = this.priceBuffer.data.slice(0, this.priceBuffer.count);
    const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    this.priceVolatility = Math.sqrt(
      prices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) /
        (prices.length - 1)
    );
  }

  updateMarketCap(newPrice) {
    // Update market cap
    this.marketCapSol =
      (this.circulatingSupply * BigInt(Math.floor(newPrice * 1e9))) /
      BigInt(1e9);

    // Update highest market cap and drawdown
    if (this.marketCapSol > this.highestMarketCap) {
      this.highestMarketCap = this.marketCapSol;
      this.drawdownLow = null;
    } else if (!this.drawdownLow || this.marketCapSol < this.drawdownLow) {
      this.drawdownLow = this.marketCapSol;
    }
  }

  updateMarketMetrics(tradeData) {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    // Update volume metrics
    this.volume24h = this.tradeHistory
      .filter((t) => t.timestamp > oneDayAgo)
      .reduce((sum, t) => sum + (t.volumeInSol || 0), 0);

    this.volume1m = this.tradeHistory
      .filter((t) => t.timestamp > now - 60 * 1000)
      .reduce((sum, t) => sum + (t.volumeInSol || 0), 0);

    this.volume5m = this.tradeHistory
      .filter((t) => t.timestamp > now - 5 * 60 * 1000)
      .reduce((sum, t) => sum + (t.volumeInSol || 0), 0);

    this.volume30m = this.tradeHistory
      .filter((t) => t.timestamp > now - 30 * 60 * 1000)
      .reduce((sum, t) => sum + (t.volumeInSol || 0), 0);

    // Update market cap
    this.marketCapSol =
      Number(
        this.circulatingSupply * BigInt(Math.floor(this.currentPrice * 1e9))
      ) / 1e9;

    // Update highest market cap if needed
    if (this.marketCapSol > this.highestMarketCap) {
      this.highestMarketCap = this.marketCapSol;
      this.drawdownLow = null; // Reset drawdown tracking on new high
    }

    // Update drawdown if we're below ATH
    if (this.marketCapSol < this.highestMarketCap) {
      if (!this.drawdownLow || this.marketCapSol < this.drawdownLow) {
        this.drawdownLow = this.marketCapSol;
      }
    }

    // Emit metrics update
    this.emit("stateUpdate", {
      type: "metrics",
      token: this,
      data: {
        price: this.currentPrice,
        marketCap: this.marketCapSol,
        volume: {
          volume1m: this.volume1m,
          volume5m: this.volume5m,
          volume30m: this.volume30m,
          volume24h: this.volume24h,
        },
        drawdown: this.drawdownLow
          ? {
              highestMarketCap: this.highestMarketCap,
              currentDrawdown: this.drawdownLow,
            }
          : null,
      },
    });
  }

  async evaluateRecovery(safetyChecker) {
    try {
      if (!safetyChecker) {
        const error = new Error(
          "SafetyChecker is required for evaluateRecovery"
        );
        errorLogger.logError(error, "Token.evaluateRecovery");
        this.emit("recoveryError", { token: this, error: error.message });
        return;
      }

      if (this.state !== "drawdown" && this.state !== "recovery") {
        return;
      }

      // Initialize drawdownLow if not set (this should never happen, but let's be safe)
      if (this.drawdownLow === null) {
        console.warn(
          `drawdownLow was null for token ${this.address} in ${this.state} state. Initializing with current market cap.`
        );
        this.drawdownLow = this.marketCapSol;
      }

      // Check for new drawdown in either state
      if (this.marketCapSol < this.drawdownLow) {
        // Only set state to drawdown if we're not already in drawdown
        if (this.state !== "drawdown") {
          this.state = "drawdown";
          this.stateChangedAt = Date.now();
          this.stateChangeReason = "Drawdown detected";
        }
        this.drawdownLow = this.marketCapSol;
        return;
      }

      const gainPercentage = this.getGainPercentage();
      const recoveryPercentage = this.getRecoveryPercentage();

      // If we're in drawdown and hit recovery threshold
      if (
        this.state === "drawdown" &&
        recoveryPercentage >= this.config.RECOVERY.THRESHOLD
      ) {
        const isSecure = await safetyChecker.runSecurityChecks(this);
        if (isSecure) {
          // If safe, immediately emit readyForPosition
          this.state = "open";
          this.stateChangedAt = Date.now();
          this.stateChangeReason = "Recovery complete";
        } else {
          // If unsafe, get failure reason and enter recovery state
          const failureReason = safetyChecker.getFailureReason();
          this.state = "recovery";
          this.stateChangedAt = Date.now();
          this.stateChangeReason = "Recovery incomplete";
          this.unsafeReason = failureReason;
          this.emit("unsafeRecovery", {
            token: this,
            marketCap: this.marketCapSol,
            reason: failureReason.reason,
            value: failureReason.value,
          });
        }
        return;
      }

      // If we're in recovery state
      if (this.state === "recovery") {
        const isSecure = await safetyChecker.runSecurityChecks(this);
        const currentPrice = this.calculateTokenPrice();
        const gainFromBottom = this.drawdownLow
          ? ((currentPrice - this.drawdownLow) / this.drawdownLow) * 100
          : 0;

        if (isSecure) {
          // If gain from bottom is acceptable, enter position
          if (gainFromBottom <= this.config.RECOVERY.SAFE_GAIN) {
            this.unsafeReason = null;
            this.state = "open";
            this.stateChangedAt = Date.now();
            this.stateChangeReason = "Recovery complete";
          } else {
            // If gain too high, go back to drawdown to wait for better entry
            this.state = "drawdown";
            this.stateChangedAt = Date.now();
            this.stateChangeReason = "Gain too high";
            this.unsafeReason = null;
            this.emit("recoveryGainTooHigh", {
              token: this,
              gainFromBottom,
              marketCap: this.marketCapSol,
            });
          }
        } else {
          // If still unsafe, check if we're in a new drawdown from recovery high
          const drawdownFromRecoveryHigh = this.highestMarketCap
            ? ((this.marketCapSol - this.highestMarketCap) /
                this.highestMarketCap) *
              100
            : 0;

          if (drawdownFromRecoveryHigh <= -this.config.DRAWDOWN.THRESHOLD) {
            // We've hit a significant drawdown from recovery high, go back to drawdown state
            this.state = "drawdown";
            this.stateChangedAt = Date.now();
            this.stateChangeReason = "New drawdown cycle";
            this.drawdownLow = currentPrice; // Reset drawdown low for new cycle
            this.emit("newDrawdownCycle", {
              token: this,
              drawdownFromHigh: drawdownFromRecoveryHigh,
              newDrawdownLow: currentPrice,
            });
          } else {
            // Still in recovery but unsafe, update reason if changed
            const newReason = safetyChecker.getFailureReason();
            if (
              !this.unsafeReason ||
              this.unsafeReason.reason !== newReason.reason ||
              this.unsafeReason.value !== newReason.value
            ) {
              this.unsafeReason = newReason;
              this.emit("recoveryUpdate", {
                token: this,
                reason: newReason.reason,
                value: newReason.value,
              });
            }
          }
        }
      }
    } catch (error) {
      const logError = new Error("Error in evaluateRecovery");
      errorLogger.logError(logError, "Token.evaluateRecovery", {
        error: error.message,
      });
      this.emit("recoveryError", { token: this, error: error.message });
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

  getPriceMomentum() {
    // Get the last 5 minutes of price data
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    const recentPrices = this.priceHistory.filter(
      (p) => p.timestamp > fiveMinutesAgo
    );

    if (recentPrices.length < 2) return 0;

    // Calculate momentum as rate of price change
    const oldestPrice = recentPrices[0].price;
    const latestPrice = recentPrices[recentPrices.length - 1].price;
    return ((latestPrice - oldestPrice) / oldestPrice) * 100;
  }

  getVolumeChange(timeWindowSeconds) {
    const now = Date.now();
    const timeWindow = timeWindowSeconds * 1000;
    const previousWindow = timeWindow * 2;

    // Get volume for current window
    const currentVolume = this.getRecentVolume(timeWindow);

    // Get volume for previous window
    const previousVolume = this.getRecentVolume(previousWindow) - currentVolume;

    // Calculate percentage change
    if (previousVolume === 0) return currentVolume > 0 ? 100 : 0;
    return ((currentVolume - previousVolume) / previousVolume) * 100;
  }

  getRecentVolume(timeWindow) {
    const now = Date.now();
    const cutoff = now - timeWindow;

    // Get volume from price history
    return this.priceHistory
      .filter((p) => p.timestamp > cutoff)
      .reduce((sum, p) => sum + (p.volume || 0), 0);
  }

  getMarketCap() {
    return this.marketCapSol;
  }

  getBuyPressureMetrics(timeWindow = 300000) {
    // 5 minutes default
    return {
      buyRatio: 0,
      avgBuySize: 0,
      uniqueBuyers: 0,
      buySizeIncreasing: false,
    };
  }

  getRecoveryStrength() {
    const recoveryPercentage = this.getRecoveryPercentage();
    const buyPressure = this.getBuyPressureMetrics();
    const momentum = this.getPriceMomentum();

    // Weight different factors
    const recoveryScore = recoveryPercentage * 0.4; // 40% weight
    const buyPressureScore =
      (buyPressure.buyRatio * 30 + // Up to 30 points for buy ratio
        (buyPressure.buySizeIncreasing ? 15 : 0) + // 15 points for increasing buy sizes
        Math.min(buyPressure.uniqueBuyers * 2, 15)) * // Up to 15 points for unique buyers
      0.4; // 40% weight
    const momentumScore = momentum * 100 * 0.2; // 20% weight

    return {
      total: recoveryScore + buyPressureScore + momentumScore,
      breakdown: {
        recoveryPercentage,
        buyPressure,
        momentum,
      },
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

  getTradeRecommendation() {
    return {
      action: "hold",
      confidence: 0,
      reason: "Market analysis disabled",
    };
  }

  detectPricePattern() {
    return null;
  }

  getVolumeProfile() {
    return null;
  }

  calculateAccumulationScore() {
    return 0;
  }

  isPumping() {
    return false;
  }

  isHeatingUp() {
    return false;
  }

  isFirstPump() {
    return false;
  }

  getBuyPressureMetrics() {
    return {
      buyRatio: 0,
      buySizeIncreasing: false,
      uniqueBuyers: 0,
    };
  }

  getRecoveryStrength() {
    return {
      total: 0,
      components: {},
    };
  }

  analyzeMarketStructure() {
    const recentTrades = this.tradeHistory
      .filter((t) => t.timestamp > Date.now() - 30 * 60 * 1000) // Last 30 minutes
      .sort((a, b) => a.timestamp - b.timestamp);

    if (recentTrades.length < 2) {
      this.recoveryMetrics = { phase: "none", marketStructure: "neutral" };
      return;
    }

    // Calculate price trend
    const priceChanges = recentTrades
      .map((t, i) => {
        if (i === 0) return 0;
        return t.price - recentTrades[i - 1].price;
      })
      .slice(1);

    const positiveChanges = priceChanges.filter((c) => c > 0).length;
    const negativeChanges = priceChanges.filter((c) => c < 0).length;
    const trend =
      positiveChanges > negativeChanges
        ? "bullish"
        : negativeChanges > positiveChanges
        ? "bearish"
        : "neutral";

    // Determine phase based on trend and volume
    const phase =
      trend === "bullish"
        ? "accumulation"
        : trend === "bearish"
        ? "distribution"
        : "consolidation";

    this.recoveryMetrics = {
      phase,
      marketStructure: trend,
    };

    // Emit recovery update
    this.emit("stateUpdate", {
      type: "recovery",
      token: this,
      data: this.recoveryMetrics,
    });
  }

  updateRecoveryMetrics() {
    if (!this.priceHistory || this.priceHistory.length < 5) return;

    const recentPrices = this.priceHistory.slice(-5);
    const peakPrice = Math.max(...this.priceHistory.map((p) => p.price));

    // Update drawdown metrics
    this.recoveryMetrics.drawdownDepth =
      (peakPrice - Math.min(...recentPrices.map((p) => p.price))) / peakPrice;

    // Calculate recovery strength
    const lowestPrice = Math.min(...recentPrices.map((p) => p.price));
    const currentRecovery = (this.currentPrice - lowestPrice) / lowestPrice;
    this.recoveryMetrics.recoveryStrength = currentRecovery;

    // Calculate volume metrics
    const recentVolumes = this.volumeHistory.slice(-5);
    this.recoveryMetrics.recoveryVolume = recentVolumes.reduce(
      (sum, v) => sum + v.volume,
      0
    );

    // Calculate accumulation score
    const volumeProfile = this.calculateVolumeProfile();
    this.recoveryMetrics.accumulationScore =
      this.calculateAccumulationScore(volumeProfile);

    // Update buy pressure
    const buyCandles = recentPrices.filter(
      (p, i) => i > 0 && p.price > recentPrices[i - 1].price
    ).length;
    this.recoveryMetrics.buyPressure = buyCandles / (recentPrices.length - 1);

    // Analyze market structure
    this.recoveryMetrics.marketStructure = this.analyzeMarketStructure();

    // Update recovery phase
    this.updateRecoveryPhase();

    // Track recovery attempts
    if (
      this.recoveryMetrics.recoveryStrength > 0.1 &&
      this.state === "drawdown"
    ) {
      this.recoveryMetrics.recoveryAttempts.push({
        timestamp: Date.now(),
        strength: this.recoveryMetrics.recoveryStrength,
        volume: this.recoveryMetrics.recoveryVolume,
        buyPressure: this.recoveryMetrics.buyPressure,
      });
    }
  }

  calculateAccumulationScore(volumeProfile) {
    if (!volumeProfile) return 0;

    const { maxVolume, minVolume, avgVolume, volumeStability, recentTrend } =
      volumeProfile;

    let score = 0;

    // Volume stability indicates accumulation
    score += (1 - volumeStability) * 0.3;

    // Increasing volume trend is positive
    if (recentTrend === "increasing") score += 0.4;
    else if (recentTrend === "stable") score += 0.2;

    // Higher than average volume is positive
    if (maxVolume > avgVolume * 1.5) score += 0.3;

    return Math.min(1, score);
  }

  analyzeMarketStructure() {
    const prices = this.priceHistory.slice(-10);
    if (prices.length < 10) return "unknown";

    const highs = [];
    const lows = [];

    for (let i = 1; i < prices.length - 1; i++) {
      if (
        prices[i].price > prices[i - 1].price &&
        prices[i].price > prices[i + 1].price
      ) {
        highs.push(prices[i].price);
      }
      if (
        prices[i].price < prices[i - 1].price &&
        prices[i].price < prices[i + 1].price
      ) {
        lows.push(prices[i].price);
      }
    }

    if (highs.length >= 2 && lows.length >= 2) {
      const higherHighs = highs[highs.length - 1] > highs[highs.length - 2];
      const higherLows = lows[lows.length - 1] > lows[lows.length - 2];

      if (higherHighs && higherLows) return "bullish";
      if (!higherHighs && !higherLows) return "bearish";
    }

    return "neutral";
  }

  updateRecoveryPhase() {
    const {
      recoveryStrength,
      buyPressure,
      accumulationScore,
      marketStructure,
    } = this.recoveryMetrics;

    if (recoveryStrength < 0.1) {
      this.recoveryMetrics.recoveryPhase = "none";
    } else if (
      recoveryStrength < 0.3 &&
      buyPressure > 0.6 &&
      accumulationScore > 0.7
    ) {
      this.recoveryMetrics.recoveryPhase = "accumulation";
    } else if (recoveryStrength >= 0.3 && marketStructure === "bullish") {
      this.recoveryMetrics.recoveryPhase = "expansion";
    } else if (recoveryStrength >= 0.5 && buyPressure < 0.4) {
      this.recoveryMetrics.recoveryPhase = "distribution";
    }
  }

  isPumping() {
    // Check price increases
    const price1mChange = this.getPriceChange(60); // 1 minute
    const price5mChange = this.getPriceChange(300); // 5 minutes

    // Check volume spike
    const volumeSpike = this.getVolumeChange(300); // 5 minutes

    // Check buy pressure
    const buyPressure = this.getBuyPressure(300); // 5 minutes

    return (
      price1mChange >= this.config.PUMP.PRICE.CHANGE_1M &&
      price5mChange >= this.config.PUMP.PRICE.CHANGE_5M &&
      volumeSpike >= this.config.PUMP.VOLUME.SPIKE &&
      buyPressure >= this.config.PUMP.MARKET.MIN_BUYS
    );
  }

  isSafe() {
    // Check liquidity
    if (this.vSolInBondingCurve < this.config.SAFETY.MIN_LIQUIDITY_SOL) {
      return false;
    }

    // Check volume
    const volume24h = this.getRecentVolume(24 * 60 * 60 * 1000);
    if (volume24h < this.config.SAFETY.MIN_VOLUME_24H) {
      return false;
    }

    return true;
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
        const marketCapUSD = this.marketCapSol * this.solPrice;
        const isPumping =
          // Market cap threshold
          marketCapUSD >= this.config.MCAP.PUMP &&
          // Significant price increase
          priceChange1m >= this.config.PUMP.PRICE.CHANGE_1M &&
          priceChange5m >= this.config.PUMP.PRICE.CHANGE_5M &&
          // Volume spike
          volumeChange5m >= this.config.PUMP.VOLUME.CHANGE &&
          // Strong buy pressure
          buyPressure >= this.config.PUMP.MARKET.MIN_BUYS;

        if (isPumping) {
          this.state = "pumping";
          this.stateChangedAt = Date.now();
          this.stateChangeReason = "Pumping detected";
        }
      }

      // Calculate drawdown from peak
      const drawdownPercentage = this.highestMarketCap
        ? ((this.marketCapSol - this.highestMarketCap) /
            this.highestMarketCap) *
          100
        : 0;

      // Detect drawdown state
      if (
        this.state === "pumping" &&
        drawdownPercentage <= -this.config.DRAWDOWN.THRESHOLD
      ) {
        this.state = "drawdown";
        this.stateChangedAt = Date.now();
        this.stateChangeReason = "Drawdown detected";
        this.drawdownLow = currentPrice;
      }

      // Handle recovery
      const recoveryPercentage = this.drawdownLow
        ? ((currentPrice - this.drawdownLow) / this.drawdownLow) * 100
        : 0;

      if (
        this.state === "drawdown" &&
        recoveryPercentage >= this.config.RECOVERY.THRESHOLD
      ) {
        const isSecure = await safetyChecker.runSecurityChecks(this);
        if (isSecure) {
          // If safe, immediately emit readyForPosition
          this.state = "open";
          this.stateChangedAt = Date.now();
          this.stateChangeReason = "Recovery complete";
        } else {
          // If unsafe, get failure reason and enter recovery state
          const failureReason = safetyChecker.getFailureReason();
          this.state = "recovery";
          this.stateChangedAt = Date.now();
          this.stateChangeReason = "Recovery incomplete";
          this.unsafeReason = failureReason;
        }
        return;
      }

      // Handle recovery state
      if (this.state === "recovery") {
        const isSecure = await safetyChecker.runSecurityChecks(this);
        const currentPrice = this.calculateTokenPrice();
        const gainFromBottom = this.drawdownLow
          ? ((currentPrice - this.drawdownLow) / this.drawdownLow) * 100
          : 0;

        if (isSecure) {
          // If gain from bottom is acceptable, enter position
          if (gainFromBottom <= this.config.RECOVERY.SAFE_GAIN) {
            this.unsafeReason = null;
            this.state = "open";
            this.stateChangedAt = Date.now();
            this.stateChangeReason = "Recovery complete";
          } else {
            // If gain too high, go back to drawdown to wait for better entry
            this.state = "drawdown";
            this.stateChangedAt = Date.now();
            this.stateChangeReason = "Gain too high";
            this.unsafeReason = null;
            this.emit("recoveryGainTooHigh", {
              token: this,
              gainFromBottom,
              marketCap: this.marketCapSol,
            });
          }
        } else {
          // If still unsafe, check if we're in a new drawdown from recovery high
          const drawdownFromRecoveryHigh = this.highestMarketCap
            ? ((this.marketCapSol - this.highestMarketCap) /
                this.highestMarketCap) *
              100
            : 0;

          if (drawdownFromRecoveryHigh <= -this.config.DRAWDOWN.THRESHOLD) {
            // We've hit a significant drawdown from recovery high, go back to drawdown state
            this.state = "drawdown";
            this.stateChangedAt = Date.now();
            this.stateChangeReason = "New drawdown cycle";
            this.drawdownLow = currentPrice; // Reset drawdown low for new cycle
            this.emit("newDrawdownCycle", {
              token: this,
              drawdownFromHigh: drawdownFromRecoveryHigh,
              newDrawdownLow: currentPrice,
            });
          } else {
            // Still in recovery but unsafe, update reason if changed
            const newReason = safetyChecker.getFailureReason();
            if (
              !this.unsafeReason ||
              this.unsafeReason.reason !== newReason.reason ||
              this.unsafeReason.value !== newReason.value
            ) {
              this.unsafeReason = newReason;
              this.emit("recoveryUpdate", {
                token: this,
                reason: newReason.reason,
                value: newReason.value,
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
    const cutoffTime = Date.now() - timeWindowSeconds * 1000;
    const recentTrades = [];

    if (recentTrades.length === 0) return 0;

    const buyVolume = recentTrades
      .filter((t) => t.type === "buy")
      .reduce((sum, t) => sum + t.amount * t.price, 0);

    const totalVolume = recentTrades.reduce(
      (sum, t) => sum + t.amount * t.price,
      0
    );

    return totalVolume > 0 ? buyVolume / totalVolume : 0;
  }

  getPriceChange(timeWindowSeconds) {
    const timeWindow = timeWindowSeconds * 1000;
    const oldPrice = this.getPriceAtTime(Date.now() - timeWindow);
    if (!oldPrice) return 0;

    return ((this.currentPrice - oldPrice) / oldPrice) * 100;
  }

  getVolumeChange(timeWindowSeconds) {
    const timeWindow = timeWindowSeconds * 1000;
    const now = Date.now();

    // Ensure trades array exists
    if (!Array.isArray(this.tradeHistory)) {
      return 0;
    }

    // Calculate current window volume
    const currentWindow = this.tradeHistory
      .filter((t) => now - t.timestamp <= timeWindow)
      .reduce((sum, t) => sum + t.price * t.size, 0);

    // Calculate previous window volume
    const previousWindow = this.tradeHistory
      .filter(
        (t) =>
          now - t.timestamp <= timeWindow * 2 && now - t.timestamp > timeWindow
      )
      .reduce((sum, t) => sum + t.price * t.size, 0);

    // Calculate percentage change, handling edge cases
    if (previousWindow <= 0) {
      return currentWindow > 0 ? 100 : 0; // 100% increase if we went from 0 to something
    }

    return ((currentWindow - previousWindow) / previousWindow) * 100;
  }

  async recordTrade(trade) {
    try {
      // Update metrics based on trade data
      this.metrics = {
        ...this.metrics,
        marketCap: trade.marketCapSol,
        lastTradeTime: Date.now(),
        tradeCount: (this.metrics.tradeCount || 0) + 1,
        volume: trade.tokenAmount
          ? (this.metrics.volume || 0) + trade.tokenAmount
          : this.metrics.volume,
      };

      // Add trade to history
      this.tradeHistory.push({
        ...trade,
        timestamp: Date.now(),
      });

      // Emit trade event
      this.emit("trade", {
        token: this,
        trade: trade,
        metrics: this.metrics,
      });

      // Emit metrics update
      this.emit("metricsUpdated", this);

      return true;
    } catch (error) {
      console.error(
        `Failed to record trade for token ${this.symbol}:`,
        error.message
      );
      return false;
    }
  }

  updateMetrics(trade) {
    try {
      // Update basic metrics
      this.metrics.lastPrice = trade.price;
      this.metrics.volume = (this.metrics.volume || 0) + trade.tokenAmount;
      this.metrics.tradeCount = (this.metrics.tradeCount || 0) + 1;

      // Update market cap if available
      if (trade.marketCapSol) {
        this.metrics.marketCap = trade.marketCapSol;
      }

      // Calculate price change
      if (this.tradeHistory.length > 0) {
        const previousPrice =
          this.tradeHistory[this.tradeHistory.length - 1].price;
        this.metrics.priceChange =
          ((trade.price - previousPrice) / previousPrice) * 100;
      }

      return true;
    } catch (error) {
      console.error(
        `Failed to update metrics for token ${this.symbol}:`,
        error.message
      );
      return false;
    }
  }

  getTopHolders(limit = 10) {
    const holders = Array.from(this.balanceLedger.entries())
      .map(([address, data]) => ({
        address,
        balance: data.balance,
        percentage: Number(
          data.balance * BigInt(100) / (this.circulatingSupply + this.vTokensInBondingCurve)
        ),
      }))
      .sort((a, b) => b.balance - a.balance)
      .slice(0, limit);

    return holders;
  }

  getConcentrationMetrics() {
    const holders = this.getTopHolders();
    const totalSupply = this.circulatingSupply + this.vTokensInBondingCurve;

    // Calculate top 10 concentration (sum of percentages)
    const top10Concentration = holders.reduce((sum, holder) => {
      return sum + Number(holder.balance * BigInt(100) / totalSupply);
    }, 0);

    return {
      top10Concentration,
      holders: this.balanceLedger.size,
      totalSupply,
    };
  }

  updateMetrics(trade) {
    try {
      // Update trade metrics
      if (trade) {
        this.recordTrade(trade);
      }

      // Get concentration metrics
      const concentrationMetrics = this.getConcentrationMetrics();

      // Emit consolidated state update
      this.emit("stateUpdate", {
        type: "metrics",
        token: this,
        data: {
          price: this.currentPrice,
          marketCap: this.marketCapSol,
          volume: {
            "1m": this.volume1m,
            "5m": this.volume5m,
            "30m": this.volume30m,
            "24h": this.volume24h,
          },
          top10Concentration: concentrationMetrics.top10Concentration,
          holders: concentrationMetrics.holders,
          totalSupply: concentrationMetrics.totalSupply,
          recoveryMetrics: this.recoveryMetrics,
        },
      });
    } catch (error) {
      console.error("Error updating metrics:", error);
    }
  }

  // Override the standard emit to track active listeners
  emit(event, ...args) {
    if (this.listenerCount(event) === 0) {
      console.warn(
        `No listeners for event '${event}' on token ${this.address}`
      );
    }
    return super.emit(event, ...args);
  }

  // Override addListener to track registration time
  addListener(event, listener) {
    super.addListener(event, listener);
    this.registeredListeners.set(listener, {
      event,
      time: Date.now(),
    });
    return this;
  }

  // Override removeListener to clean up tracking
  removeListener(event, listener) {
    super.removeListener(event, listener);
    this.registeredListeners.delete(listener);
    return this;
  }

  // Clean up stale listeners (older than 5 minutes)
  cleanupStaleListeners() {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes

    for (const [listener, info] of this.registeredListeners.entries()) {
      if (now - info.time > staleThreshold) {
        this.removeListener(info.event, listener);
        console.log(
          `Removed stale listener for event ${info.event} on token ${this.address}`
        );
      }
    }
  }

  updateBalances({ newTokenBalance, vTokensInBondingCurve, traderAddress }) {
    if (typeof newTokenBalance !== "undefined") {
      this.tokenBalance = newTokenBalance;
    }

    if (typeof vTokensInBondingCurve !== "undefined") {
      this.vTokensInBondingCurve = vTokensInBondingCurve;
      this.circulatingSupply = vTokensInBondingCurve;
    }

    if (traderAddress) {
      const normalizedAddress = traderAddress.toLowerCase();

      // Initialize balance record if it doesn't exist
      if (!this.balanceLedger.has(normalizedAddress)) {
        this.balanceLedger.set(normalizedAddress, {
          balance: 0n,
          history: [],
          isDev: false,
        });
      }

      const record = this.balanceLedger.get(normalizedAddress);
      const newBalance = BigInt(Math.floor(Number(newTokenBalance) * 1e9)); // Convert to BigInt with 9 decimals
      const change = newBalance - record.balance;

      // Update balance and history
      record.history.push({
        timestamp: Date.now(),
        change,
        balance: newBalance,
      });

      record.balance = newBalance;

      // Emit balance update
      this.emit("stateUpdate", {
        type: "balance",
        token: this,
        data: {
          address: normalizedAddress,
          balance: newBalance,
          change,
        },
      });
    }
  }

  /**
   * Get balance metrics for an address
   * @param {string} address Wallet address
   * @returns {Object} Balance metrics
   */
  getBalanceMetrics(address) {
    const normalizedAddress = address.toLowerCase();
    const record = this.balanceLedger.get(normalizedAddress);

    if (!record) {
      return {
        balance: BigInt(0),
        percentageOfSupply: 0,
        trades: 0,
        averageHoldTime: 0,
        isDev: false,
      };
    }

    const now = Date.now();
    const history = record.history;
    let totalHoldTime = 0;
    let lastTradeTime = null;

    for (let i = 0; i < history.length; i++) {
      const trade = history[i];
      if (lastTradeTime) {
        totalHoldTime += trade.timestamp - lastTradeTime;
      }
      lastTradeTime = trade.timestamp;
    }

    if (lastTradeTime) {
      totalHoldTime += now - lastTradeTime;
    }

    return {
      balance: record.balance,
      percentageOfSupply: Number(
        (record.balance * BigInt(100)) / this.circulatingSupply
      ),
      trades: history.length,
      averageHoldTime: history.length > 0 ? totalHoldTime / history.length : 0,
      isDev: record.isDev || false,
    };
  }

  /**
   * Get top token holders
   * @param {number} limit Number of holders to return
   * @returns {Array} Top holders with their metrics
   */
  getTopHolders(limit = 10) {
    const holders = Array.from(this.balanceLedger.entries())
      .map(([address, record]) => ({
        address,
        ...this.getBalanceMetrics(address),
      }))
      .filter((holder) => holder.balance > BigInt(0))
      .sort((a, b) => Number(b.balance - a.balance))
      .slice(0, limit);

    return holders;
  }

  /**
   * Calculate concentration metrics
   * @returns {Object} Concentration metrics
   */
  getConcentrationMetrics() {
    const holders = this.getTopHolders();
    const totalHoldings = holders.reduce(
      (sum, holder) => sum + holder.balance,
      BigInt(0)
    );

    return {
      topHolderCount: holders.length,
      topHolderConcentration: Number(
        (totalHoldings * BigInt(100)) / this.circulatingSupply
      ),
      averageBalance:
        this.circulatingSupply / BigInt(Math.max(1, holders.length)),
    };
  }
}

module.exports = Token;
