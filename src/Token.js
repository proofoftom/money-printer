const { EventEmitter } = require("events");

const STATES = {
  NEW: "NEW",
  READY: "READY",
  UNSAFE: "UNSAFE",
  DEAD: "DEAD",
};

// OHLCV timeframe constants
const TIMEFRAMES = {
  SECOND: 1000,
  FIVE_SECONDS: 5000,
  THIRTY_SECONDS: 30000,
  MINUTE: 60000,
};

const AGGREGATION_THRESHOLDS = {
  FIVE_MIN: 300000,    // 5 minutes in ms
  THIRTY_MIN: 1800000, // 30 minutes in ms
  ONE_HOUR: 3600000,   // 1 hour in ms
};

class Token extends EventEmitter {
  constructor(tokenData, { priceManager, safetyChecker, logger, config }) {
    super();

    // Validate required token data
    const requiredFields = [
      "mint",
      "symbol",
      "vTokensInBondingCurve",
      "vSolInBondingCurve",
      "marketCapSol",
    ];

    for (const field of requiredFields) {
      if (!tokenData[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate numeric fields
    const numericFields = [
      "vTokensInBondingCurve",
      "vSolInBondingCurve",
      "marketCapSol",
    ];
    for (const field of numericFields) {
      if (typeof tokenData[field] !== "number" || isNaN(tokenData[field])) {
        throw new Error(`Invalid numeric value for field: ${field}`);
      }
    }

    // Validate dependencies
    if (!safetyChecker || !logger || !config) {
      throw new Error("Missing required dependencies");
    }

    this.mint = tokenData.mint;
    this.name = tokenData.name;
    this.symbol = tokenData.symbol;
    this.createdAt = Date.now();
    this.minted = tokenData.minted;
    this.traderPublicKey = tokenData.traderPublicKey;
    this.bondingCurveKey = tokenData.bondingCurveKey;
    this.vTokensInBondingCurve = tokenData.vTokensInBondingCurve;
    this.vSolInBondingCurve = tokenData.vSolInBondingCurve;
    this.marketCapSol = tokenData.marketCapSol;
    this.totalSupplyOutsideCurve = 0;
    this.holders = new Map();
    this.holderHistory = [{
      timestamp: Date.now(),
      count: 0
    }];
    this.totalSupply = this.calculateTotalSupply();

    // Price tracking
    this.currentPrice = this.calculateTokenPrice();
    this.initialPrice = this.currentPrice;
    this.highestPrice = this.currentPrice;
    this.highestPriceTime = Date.now();
    this.highestMarketCap = this.marketCapSol;
    this.priceHistory = [];

    // Trade tracking
    this.volume = 0;
    this.tradeCount = 0;
    this.lastTradeType = null;
    this.lastTradeAmount = null;
    this.lastTradeTime = null;

    // Dependencies
    this.priceManager = priceManager;
    this.safetyChecker = safetyChecker;
    this.logger = logger;
    this.config = config;

    // State
    this.state = STATES.NEW;

    // Start safety checks
    this.safetyCheckInterval = setInterval(
      () => this.checkSafetyConditions(),
      this.config.SAFETY_CHECK_INTERVAL
    );

    // OHLCV data structures
    this.ohlcvData = {
      secondly: [],  // 1s data for first 5 minutes
      fiveSeconds: [], // 5s data from 5-30 minutes
      thirtySeconds: [], // 30s data from 30-60 minutes
      minute: [],    // 1m data after 1 hour
    };

    // Technical indicators
    this.indicators = {
      sma: new Map(),  // Simple Moving Averages
      ema: new Map(),  // Exponential Moving Averages
      volumeProfile: new Map(), // Volume analysis
    };

    // Scoring system for evaluating trading opportunities
    this.score = {
      overall: 0,          // Combined score from all components (0-100)
      priceComponent: 0,   // Score based on price movements and volatility
      volumeComponent: 0,  // Score based on trading volume and liquidity
      timeComponent: 0,    // Score based on token age and market maturity
      lastUpdate: Date.now(), // Timestamp of the last score update
    };

    // State tracking for pump and dump detection
    this.pumpState = {
      inCooldown: false,     // Whether we're in a cooldown period after a pump
      cooldownEnd: 0,        // Timestamp when the cooldown period ends
      pumpCount: 0,          // Number of pumps detected for this token
      lastPumpTime: null,    // Timestamp of the most recent pump
      firstDipDetected: false, // Whether we've detected the first significant dip
      firstDipTime: null,    // Timestamp when the first dip was detected
      firstDipPrice: null,   // Price at the time of the first dip
      recoveryHigh: null,    // Highest price seen during recovery after first dip
    };

    // Start OHLCV updates
    this.ohlcvInterval = setInterval(() => this.updateOHLCV(), 1000);

    this.logger.info("Token initialized", {
      mint: this.mint,
      symbol: this.symbol,
      price: this.currentPrice,
      marketCapSol: this.marketCapSol,
    });
  }

  calculateTokenPrice() {
    if (this.vTokensInBondingCurve === 0) return 0;
    return this.vSolInBondingCurve / this.vTokensInBondingCurve;
  }

  calculateTotalSupply() {
    const totalHolderSupply = Array.from(this.holders.values()).reduce(
      (a, b) => a + b,
      0
    );
    return this.vTokensInBondingCurve + totalHolderSupply;
  }

  update(tradeData) {
    try {
      // Validate required trade data
      const requiredFields = [
        "txType",
        "tokenAmount",
        "vTokensInBondingCurve",
        "vSolInBondingCurve",
        "marketCapSol",
        "newTokenBalance",
        "traderPublicKey",
      ];

      for (const field of requiredFields) {
        if (field === "newTokenBalance" && tradeData[field] === 0) {
          continue; // Allow zero balance
        }
        if (!tradeData[field]) {
          throw new Error(`Missing required trade data field: ${field}`);
        }
      }

      // Validate numeric fields
      const numericFields = [
        "tokenAmount",
        "vTokensInBondingCurve",
        "vSolInBondingCurve",
        "marketCapSol",
      ];
      for (const field of numericFields) {
        if (typeof tradeData[field] !== "number" || isNaN(tradeData[field])) {
          throw new Error(
            `Invalid numeric value for trade data field: ${field}`
          );
        }
      }

      // Update trade metrics
      this.lastTradeType = tradeData.txType;
      this.lastTradeAmount = tradeData.tokenAmount;
      this.lastTradeTime = Date.now();
      this.volume += tradeData.tokenAmount;
      this.tradeCount++;

      // Update market metrics
      this.vTokensInBondingCurve = tradeData.vTokensInBondingCurve;
      this.vSolInBondingCurve = tradeData.vSolInBondingCurve;
      this.marketCapSol = tradeData.marketCapSol;
      this.totalSupply = this.calculateTotalSupply();

      // Update price metrics
      this.currentPrice = this.calculateTokenPrice();
      if (this.currentPrice > this.highestPrice) {
        this.highestPrice = this.currentPrice;
        this.highestPriceTime = Date.now();
      }
      if (this.marketCapSol > this.highestMarketCap) {
        this.highestMarketCap = this.marketCapSol;
      }

      // Add to price history
      this.priceHistory.push({
        price: this.currentPrice,
        marketCapSol: this.marketCapSol,
        timestamp: Date.now(),
      });

      // Update holder balance
      this.updateHolderBalance(
        tradeData.traderPublicKey,
        tradeData.newTokenBalance
      );

      // Emit trade event with WebSocket-compatible structure
      // THIS IS THE EXACT STRUCTURE, DO NOT CHANGE UNLESS YOU KNOW WHAT YOU ARE DOING
      this.emit("trade", {
        txType: tradeData.txType,
        signature: tradeData.signature,
        mint: this.mint,
        traderPublicKey: tradeData.traderPublicKey,
        tokenAmount: tradeData.tokenAmount,
        newTokenBalance: tradeData.newTokenBalance,
        bondingCurveKey: tradeData.bondingCurveKey,
        vTokensInBondingCurve: this.vTokensInBondingCurve,
        vSolInBondingCurve: this.vSolInBondingCurve,
        marketCapSol: this.marketCapSol,
      });

      this.emit("updated", this);

      this.logger.debug("Token updated", {
        mint: this.mint,
        txType: tradeData.txType,
        price: this.currentPrice,
        marketCapSol: this.marketCapSol,
      });
    } catch (error) {
      this.logger.error("Error updating token", {
        mint: this.mint,
        error: error.message,
        tradeData,
      });
      throw error;
    }
  }

  updateHolderBalance(traderPublicKey, newBalance) {
    const oldBalance = this.holders.get(traderPublicKey) || 0;
    
    if (newBalance > 0) {
      this.holders.set(traderPublicKey, newBalance);
    } else {
      this.holders.delete(traderPublicKey);
    }

    // Update holder history when the count changes
    const currentCount = this.holders.size;
    const lastHistory = this.holderHistory[this.holderHistory.length - 1];
    
    if (lastHistory.count !== currentCount) {
      this.holderHistory.push({
        timestamp: Date.now(),
        count: currentCount
      });

      // Keep only last hour of holder history
      const oneHourAgo = Date.now() - 3600000;
      this.holderHistory = this.holderHistory.filter(h => h.timestamp >= oneHourAgo);
    }

    this.totalSupplyOutsideCurve = Array.from(this.holders.values()).reduce((a, b) => a + b, 0);
    this.emit('holderUpdated', { traderPublicKey, oldBalance, newBalance });
  }

  getHolderBalance(traderPublicKey) {
    return this.holders.get(traderPublicKey) || 0;
  }

  getHolderCount() {
    return this.holders.size;
  }

  getTopHolderConcentration(topNHolders = 10) {
    const totalSupply = this.vTokensInBondingCurve + this.totalSupplyOutsideCurve;
    if (totalSupply === 0) return 0;

    const topNHoldings = Array.from(this.holders.values())
      .sort((a, b) => b - a)
      .slice(0, topNHolders)
      .reduce((a, b) => a + b, 0);

    return (topNHoldings / totalSupply) * 100;
  }

  checkSafetyConditions() {
    try {
      const { safe, reasons } = this.safetyChecker.isTokenSafe(this);
      const previousState = this.state;

      if (safe && this.state === STATES.NEW) {
        this.state = STATES.READY;
      } else if (!safe && this.state !== STATES.DEAD) {
        this.state = STATES.UNSAFE;
      }

      // Check for dead state based on drawdown
      if (this.getDrawdownPercentage() >= 90) {
        this.state = STATES.DEAD;
      }

      if (this.state !== previousState) {
        this.emit("stateChanged", {
          from: previousState,
          to: this.state,
          token: this,
          reasons,
        });

        if (this.state === STATES.READY) {
          this.emit("readyForPosition", { token: this });
        }

        this.logger.info("Token state changed", {
          mint: this.mint,
          from: previousState,
          to: this.state,
          reasons,
        });
      }
    } catch (error) {
      this.logger.error("Error checking safety conditions", {
        mint: this.mint,
        error: error.message,
      });
      // Don't throw here as this is called from an interval
    }
  }

  getDrawdownPercentage() {
    if (this.highestMarketCap === 0) return 0;
    return (
      ((this.highestMarketCap - this.marketCapSol) / this.highestMarketCap) *
      100
    );
  }

  updateOHLCV() {
    const now = Date.now();
    const timeSinceCreation = now - this.createdAt;
    const candle = {
      timestamp: now,
      open: this.currentPrice,
      high: this.currentPrice,
      low: this.currentPrice,
      close: this.currentPrice,
      volume: this.volume,
    };

    // Determine appropriate timeframe
    if (timeSinceCreation < AGGREGATION_THRESHOLDS.FIVE_MIN) {
      this.ohlcvData.secondly.push(candle);
    } else if (timeSinceCreation < AGGREGATION_THRESHOLDS.THIRTY_MIN) {
      if (now % TIMEFRAMES.FIVE_SECONDS === 0) {
        this.ohlcvData.fiveSeconds.push(this.aggregateCandles(this.ohlcvData.secondly.slice(-5)));
      }
    } else if (timeSinceCreation < AGGREGATION_THRESHOLDS.ONE_HOUR) {
      if (now % TIMEFRAMES.THIRTY_SECONDS === 0) {
        this.ohlcvData.thirtySeconds.push(this.aggregateCandles(this.ohlcvData.fiveSeconds.slice(-6)));
      }
    } else {
      if (now % TIMEFRAMES.MINUTE === 0) {
        this.ohlcvData.minute.push(this.aggregateCandles(this.ohlcvData.thirtySeconds.slice(-2)));
      }
    }

    this.updateIndicators();
    this.updateScore();
    this.detectPumpAndDip();
  }

  aggregateCandles(candles) {
    if (!candles.length) return null;
    return {
      timestamp: candles[candles.length - 1].timestamp,
      open: candles[0].open,
      high: Math.max(...candles.map(c => c.high)),
      low: Math.min(...candles.map(c => c.low)),
      close: candles[candles.length - 1].close,
      volume: candles.reduce((sum, c) => sum + c.volume, 0),
    };
  }

  updateIndicators() {
    const prices = this.ohlcvData.secondly.map(c => c.close);
    
    // Update SMAs
    [10, 20, 50].forEach(period => {
      if (prices.length >= period) {
        const sma = prices.slice(-period).reduce((a, b) => a + b) / period;
        this.indicators.sma.set(period, sma);
      }
    });

    // Update EMAs
    [12, 26].forEach(period => {
      if (prices.length >= period) {
        const multiplier = 2 / (period + 1);
        const prevEma = this.indicators.ema.get(period) || prices[0];
        const ema = (this.currentPrice - prevEma) * multiplier + prevEma;
        this.indicators.ema.set(period, ema);
      }
    });

    // Update volume profile
    const recentVolume = this.ohlcvData.secondly.slice(-30).reduce((sum, c) => sum + c.volume, 0);
    const avgVolume = this.volume / this.tradeCount;
    this.indicators.volumeProfile.set('relativeVolume', recentVolume / (avgVolume * 30));
  }

  updateScore() {
    const now = Date.now();
    const timeSinceCreation = now - this.createdAt;
    
    // Price component
    const priceChange = (this.currentPrice - this.initialPrice) / this.initialPrice;
    const recentPriceVolatility = this.calculateVolatility(this.ohlcvData.secondly.slice(-30));
    
    // Volume component
    const relativeVolume = this.indicators.volumeProfile.get('relativeVolume') || 1;
    
    // Time component - weight recent activity more heavily
    const timeWeight = Math.max(0, 1 - (timeSinceCreation / AGGREGATION_THRESHOLDS.ONE_HOUR));
    
    // Calculate components
    this.score.priceComponent = (priceChange * 0.3 + recentPriceVolatility * 0.7) * 100;
    this.score.volumeComponent = (relativeVolume - 1) * 100;
    this.score.timeComponent = timeWeight * 100;
    
    // Overall score - weighted sum
    this.score.overall = (
      this.score.priceComponent * 0.4 +
      this.score.volumeComponent * 0.4 +
      this.score.timeComponent * 0.2
    );
    
    this.score.lastUpdate = now;
  }

  calculateVolatility(candles) {
    if (candles.length < 2) return 0;
    const returns = [];
    for (let i = 1; i < candles.length; i++) {
      returns.push((candles[i].close - candles[i-1].close) / candles[i-1].close);
    }
    const mean = returns.reduce((a, b) => a + b) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }

  detectPumpAndDip() {
    if (this.pumpState.inCooldown) {
      if (Date.now() >= this.pumpState.cooldownEnd) {
        this.pumpState.inCooldown = false;
      }
      return;
    }

    const recentCandles = this.ohlcvData.secondly.slice(-30);
    if (recentCandles.length < 2) return;

    const priceChange = (this.currentPrice - recentCandles[0].close) / recentCandles[0].close;
    const volumeSpike = this.indicators.volumeProfile.get('relativeVolume') > 2;

    // Detect first significant dip
    if (!this.pumpState.firstDipDetected) {
      const isPriceDrop = priceChange < -0.05; // 5% drop
      if (isPriceDrop && volumeSpike) {
        this.pumpState.firstDipDetected = true;
        this.pumpState.firstDipTime = Date.now();
        this.pumpState.firstDipPrice = this.currentPrice;
        this.emit('firstDipDetected', {
          price: this.currentPrice,
          timestamp: Date.now(),
          priceChange,
          relativeVolume: this.indicators.volumeProfile.get('relativeVolume'),
        });
      }
    }
    // Track recovery after first dip
    else if (this.pumpState.firstDipDetected && !this.pumpState.inCooldown) {
      const priceChangeFromDip = (this.currentPrice - this.pumpState.firstDipPrice) / this.pumpState.firstDipPrice;
      
      // Update recovery high
      if (!this.pumpState.recoveryHigh || this.currentPrice > this.pumpState.recoveryHigh) {
        this.pumpState.recoveryHigh = this.currentPrice;
      }

      // Detect potential entry point for second pump
      if (priceChangeFromDip > 0.1 && volumeSpike) { // 10% recovery with volume
        this.emit('potentialEntryPoint', {
          price: this.currentPrice,
          timestamp: Date.now(),
          priceChangeFromDip,
          relativeVolume: this.indicators.volumeProfile.get('relativeVolume'),
          score: this.score.overall,
        });

        // Enter cooldown period
        this.pumpState.inCooldown = true;
        this.pumpState.cooldownEnd = Date.now() + 60000; // 1 minute cooldown
        this.pumpState.pumpCount++;
        this.pumpState.lastPumpTime = Date.now();
      }
    }
  }

  cleanup() {
    try {
      if (this.safetyCheckInterval) {
        clearInterval(this.safetyCheckInterval);
      }
      clearInterval(this.ohlcvInterval);
      this.removeAllListeners();
      this.logger.debug("Token cleaned up", { mint: this.mint });
    } catch (error) {
      this.logger.error("Error cleaning up token", {
        mint: this.mint,
        error: error.message,
      });
    }
  }
}

module.exports = { Token, STATES };
