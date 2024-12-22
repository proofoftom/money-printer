const { EventEmitter } = require("events");

const STATES = {
  NEW: "NEW", // Just created, monitoring for initial pump
  PUMPING: "PUMPING", // In first pump phase
  PUMPED: "PUMPED", // First pump reached target
  DIPPING: "DIPPING", // In first dip phase
  RECOVERING: "RECOVERING", // Recovering from first dip
  READY: "READY", // Ready for position (during recovery)
  DEAD: "DEAD", // Exceeded max recovery time or 90% drawdown
  CLOSED: "CLOSED", // Position closed
};

const PRICE_THRESHOLDS = {
  // Initial pump detection
  INITIAL_PUMP: 20, // 20% price increase from initial price
  TARGET_PUMP: 40, // 40% total increase triggers PUMPED state

  // Dip detection
  DIP_THRESHOLD: 15, // 15% drop from high triggers DIPPING state
  MAX_DIP: 40, // 40% max drop before DEAD state

  // Recovery thresholds
  RECOVERY_THRESHOLD: 10, // 10% increase from dip triggers RECOVERING
  STRONG_RECOVERY: 20, // 20% increase from dip triggers READY

  // Volume thresholds
  VOLUME_SPIKE: 2, // 2x average volume
  VOLUME_SUSTAIN: 1.5, // 1.5x volume needed during recovery
};

const TIME_WINDOWS = {
  INITIAL_PUMP_WINDOW: 5 * 60 * 1000, // 5 minutes
  MAX_PUMP_WINDOW: 15 * 60 * 1000, // 15 minutes
  MAX_DIP_WINDOW: 10 * 60 * 1000, // 10 minutes
  MAX_RECOVERY_WINDOW: 5 * 60 * 1000, // 5 minutes
};

const AGGREGATION_THRESHOLDS = {
  FIVE_MIN: 300000, // 5 minutes in ms
  THIRTY_MIN: 1800000, // 30 minutes in ms
  ONE_HOUR: 3600000, // 1 hour in ms
};

class Token extends EventEmitter {
  constructor(tokenData, { priceManager, /*safetyChecker,*/ logger, config }) {
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
    this.totalSupply = this.calculateTotalSupply();

    // Safety tracking
    this.isSafe = true;
    this.safetyReasons = [];

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

    this.pumpMetrics = {
      firstPump: {
        detected: false,
        startMarketCap: null,
        time: null,
        highestMarketCap: null,
      },
      secondPump: {
        detected: false,
        startMarketCap: null,
        time: null,
      },
    };

    this.dipMetrics = {
      detected: false,
      startMarketCap: null,
      time: null,
      recovery: {
        started: false,
        startMarketCap: null,
        startTime: null,
        highestMarketCap: null,
      },
      analytics: {
        uniqueBuyers: new Set(),
        uniqueSellers: new Set(),
        volume: 0,
      },
    };

    // Enhanced scoring system
    this.score = {
      overall: 0,
      components: {
        momentum: 0, // Price momentum score
        volume: 0, // Volume profile score
        safety: 0, // Safety checks score
        dipQuality: 0, // Quality of the dip (depth, volume, unique traders)
        recoveryStrength: 0, // Strength of recovery attempt
      },
      lastUpdate: Date.now(),
    };

    // Position management
    this.position = null;

    // Listen for ready for position events
    this.on("readyForPosition", ({ token, metrics, suggestedSize }) => {
      if (this.position) {
        this.logger.warn("Position already exists", { mint: this.mint });
        return;
      }

      try {
        // Double-check safety conditions
        const { safe, reasons } = this.safetyChecker.isTokenSafe(this);
        if (!safe) {
          this.logger.warn(
            "Failed final safety check before opening position",
            {
              mint: this.mint,
              reasons,
            }
          );
          return;
        }

        // Create and open position
        this.position = new Position(this, this.priceManager, {
          takeProfitLevel: config.TAKE_PROFIT_PERCENT,
          stopLossLevel: config.STOP_LOSS_PERCENT,
          trailingStopLevel: config.TRAILING_STOP_PERCENT,
        });

        const success = this.position.open(this.currentPrice, suggestedSize);
        if (success) {
          this.logger.info("Opened position", {
            mint: this.mint,
            price: this.currentPrice,
            size: suggestedSize,
            metrics,
          });

          // Update position price on each price update
          this.on("priceUpdate", ({ price }) => {
            if (this.position && this.position.state === "OPEN") {
              this.position.updatePrice(price);
            }
          });

          // Handle position close
          this.position.on("closed", (positionState) => {
            this.logger.info("Position closed", {
              mint: this.mint,
              reason: positionState.closeReason,
              roi: positionState.roiPercentage,
              pnl: positionState.realizedPnLSol,
            });

            // Clean up position and transition state
            this.position = null;
            this.transitionTo(
              STATES.PUMPED,
              `Position closed: ${positionState.closeReason}`
            );
          });
        }
      } catch (error) {
        this.logger.error("Error opening position", {
          mint: this.mint,
          error: error.message,
        });
      }
    });

    // Start more frequent checks in first few minutes
    this.stateCheckInterval = setInterval(
      () => this.checkStateTransitions(),
      1000 // Check every second initially
    );

    // Start safety checks
    // TODO: This feels like it's about to become cruft
    this.safetyCheckInterval = setInterval(
      () => this.checkSafetyConditions(),
      this.config.SAFETY_CHECK_INTERVAL
    );

    // OHLCV data structures
    this.ohlcvData = {
      secondly: [], // Keep all data until death
      fiveSeconds: [], // Keep for dashboard
      thirtySeconds: [], // Keep for dashboard
      minute: [], // Keep for dashboard
      lastVolume: 0,
    };

    // Technical indicators
    this.indicators = {
      sma: new Map(), // Simple Moving Averages
      ema: new Map(), // Exponential Moving Averages
      volumeProfile: new Map(), // Volume analysis
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

      // Update token metrics
      this.updateTokenMetrics(tradeData);

      // Update OHLCV data
      this.updateOHLCV();

      // Check state transitions
      this.checkStateTransitions();

      this.logger.debug("Token updated", {
        mint: this.mint,
        txType: tradeData.txType,
        price: this.currentPrice,
        marketCapUSD: this.priceManager.soltoUsd(this.marketCapSol),
      });

      // Emit update event
      this.emit("update", this);
    } catch (error) {
      this.logger.error("Error updating token", {
        mint: this.mint,
        error: error.message,
      });
    }
  }

  updateHolderBalance(traderPublicKey, newBalance) {
    if (newBalance === 0) {
      this.holders.delete(traderPublicKey);
    } else {
      this.holders.set(traderPublicKey, newBalance);
    }
    this.totalSupply = this.calculateTotalSupply();
  }

  getHolderBalance(traderPublicKey) {
    return this.holders.get(traderPublicKey) || 0;
  }

  getHolderCount() {
    return this.holders.size;
  }

  getTopHolderConcentration(topNHolders = 10) {
    if (this.totalSupply === 0) return 0;

    const topNHoldings = Array.from(this.holders.values())
      .sort((a, b) => b - a)
      .slice(0, topNHolders)
      .reduce((a, b) => a + b, 0);

    return (topNHoldings / this.totalSupply) * 100;
  }

  getVolumeProfile() {
    const recentCandles = this.ohlcvData.secondly.slice(-30);
    if (recentCandles.length < 2) {
      return { acceleration: 0, buyPressure: 0, relativeVolume: 0 };
    }

    // Calculate volume acceleration (rate of change)
    const currentVolume = recentCandles[recentCandles.length - 1].volume;
    const prevVolume = recentCandles[recentCandles.length - 2].volume;
    const acceleration = (currentVolume - prevVolume) / prevVolume;

    // Calculate buy pressure (price movement relative to volume)
    const currentCandle = recentCandles[recentCandles.length - 1];
    const buyPressure = currentCandle.close > currentCandle.open ? 1 : -1;

    // Calculate relative volume
    const averageVolume =
      recentCandles
        .slice(0, -1)
        .reduce((sum, candle) => sum + candle.volume, 0) /
      (recentCandles.length - 1);
    const relativeVolume = currentVolume / (averageVolume || 1);

    return { acceleration, buyPressure, relativeVolume };
  }

  getConsecutivePositivePressureCandles() {
    const recentCandles = this.ohlcvData.secondly.slice(-10); // Look at last 10 candles
    let consecutive = 0;

    for (let i = recentCandles.length - 1; i >= 0; i--) {
      const candle = recentCandles[i];
      if (candle.close > candle.open) {
        consecutive++;
      } else {
        break;
      }
    }

    return consecutive;
  }

  // DISABLE FOR TESTING SIMPLE TOP HOLDER CONCENTRATION CHECK
  // checkSafetyConditions() {
  //   try {
  //     const { safe, reasons } = this.safetyChecker.isTokenSafe(this);
  //     const age = Date.now() - this.createdAt;

  //     // Check if token is dead
  //     const drawdown = this.getDrawdownPercentage();
  //     if (drawdown >= 90 && this.pumpMetrics.firstPumpDetected) {
  //       this.transitionTo(STATES.DEAD, "Drawdown exceeded 90% after pump");
  //       return false;
  //     }

  //     // Only check safety conditions if attempting to enter a position
  //     if (this.state === STATES.READY && !safe) {
  //       this.transitionTo(STATES.UNSAFE, reasons.join(", "));
  //       return false;
  //     }

  //     return true;
  //   } catch (error) {
  //     this.logger.error("Error in safety conditions check", {
  //       mint: this.mint,
  //       error: error.message,
  //     });
  //     return false;
  //   }
  // }

  updateOHLCV() {
    const now = Date.now();
    const volumeDelta = this.volume - this.ohlcvData.lastVolume;
    this.ohlcvData.lastVolume = this.volume;

    // Add secondly candle (no limit)
    const candle = {
      timestamp: now,
      open: this.currentPrice,
      high: this.currentPrice,
      low: this.currentPrice,
      close: this.currentPrice,
      volume: volumeDelta,
    };
    this.ohlcvData.secondly.push(candle);

    // Update 5s candles - always use all available data up to 5s
    const last5Seconds = this.ohlcvData.secondly.slice(
      -Math.min(5, this.ohlcvData.secondly.length)
    );
    const fiveSecondCandle = {
      timestamp: now,
      open: last5Seconds[0]?.open || this.currentPrice,
      high: Math.max(...last5Seconds.map((c) => c.high)),
      low: Math.min(...last5Seconds.map((c) => c.low)),
      close: this.currentPrice,
      volume: last5Seconds.reduce((sum, c) => sum + (c?.volume || 0), 0),
    };

    this.ohlcvData.fiveSeconds.push(fiveSecondCandle);
    if (this.ohlcvData.fiveSeconds.length > 6) {
      this.ohlcvData.fiveSeconds.shift();
    }

    // Update 30s candles - use ALL available secondly data
    const thirtySecondCandle = {
      timestamp: now,
      open: this.ohlcvData.secondly[0]?.open || this.currentPrice,
      high: Math.max(...this.ohlcvData.secondly.map((c) => c.high)),
      low: Math.min(...this.ohlcvData.secondly.map((c) => c.low)),
      close: this.currentPrice,
      volume: this.ohlcvData.secondly.reduce(
        (sum, c) => sum + (c?.volume || 0),
        0
      ),
    };

    this.ohlcvData.thirtySeconds.push(thirtySecondCandle);
    if (this.ohlcvData.thirtySeconds.length > 2) {
      this.ohlcvData.thirtySeconds.shift();
    }

    this.updateIndicators();
    this.updatePumpScore(); // Changed from updateScore to updatePumpScore
  }

  aggregateCandles(candles) {
    if (!candles.length) return null;
    return {
      timestamp: candles[candles.length - 1].timestamp,
      open: candles[0].open,
      high: Math.max(...candles.map((c) => c.high)),
      low: Math.min(...candles.map((c) => c.low)),
      close: candles[candles.length - 1].close,
      volume: candles.reduce((sum, c) => sum + c.volume, 0),
    };
  }

  updateIndicators() {
    const prices = this.ohlcvData.secondly.map((c) => c.close);

    // Update SMAs
    [10, 20, 50].forEach((period) => {
      if (prices.length >= period) {
        const sma = prices.slice(-period).reduce((a, b) => a + b) / period;
        this.indicators.sma.set(period, sma);
      }
    });

    // Update EMAs
    [12, 26].forEach((period) => {
      if (prices.length >= period) {
        const multiplier = 2 / (period + 1);
        const prevEma = this.indicators.ema.get(period) || prices[0];
        const ema = (this.currentPrice - prevEma) * multiplier + prevEma;
        this.indicators.ema.set(period, ema);
      }
    });

    // Update volume profile
    const recentVolume = this.ohlcvData.secondly
      .slice(-30)
      .reduce((sum, c) => sum + c.volume, 0);
    const avgVolume = this.volume / this.tradeCount;
    this.indicators.volumeProfile.set(
      "relativeVolume",
      recentVolume / (avgVolume * 30)
    );
  }

  updateScore() {
    const now = Date.now();
    const timeSinceCreation = now - this.createdAt;

    // Price component
    const priceChange =
      (this.currentPrice - this.initialPrice) / this.initialPrice;
    const recentPriceVolatility = this.calculateVolatility(
      this.ohlcvData.secondly.slice(-30)
    );

    // Volume component
    const relativeVolume =
      this.indicators.volumeProfile.get("relativeVolume") || 1;

    // Time component - weight recent activity more heavily
    const timeWeight = Math.max(
      0,
      1 - timeSinceCreation / AGGREGATION_THRESHOLDS.ONE_HOUR
    );

    // Calculate components
    this.score.priceComponent =
      (priceChange * 0.3 + recentPriceVolatility * 0.7) * 100;
    this.score.volumeComponent = (relativeVolume - 1) * 100;
    this.score.timeComponent = timeWeight * 100;

    // Overall score - weighted sum
    this.score.overall =
      this.score.priceComponent * 0.4 +
      this.score.volumeComponent * 0.4 +
      this.score.timeComponent * 0.2;

    this.score.lastUpdate = now;
  }

  calculateVolatility(candles) {
    if (candles.length < 2) return 0;
    const returns = [];
    for (let i = 1; i < candles.length; i++) {
      returns.push(
        (candles[i].close - candles[i - 1].close) / candles[i - 1].close
      );
    }
    const mean = returns.reduce((a, b) => a + b) / returns.length;
    const variance =
      returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }

  detectPump() {
    // Only run in NEW or RECOVERING states
    if (![STATES.NEW, STATES.RECOVERING].includes(this.state)) return;

    const { acceleration, buyPressure, relativeVolume } =
      this.getVolumeProfile();
    const priceChange =
      ((this.currentPrice - this.initialPrice) / this.initialPrice) * 100;

    // First pump detection
    if (this.state === STATES.NEW) {
      if (priceChange >= PRICE_THRESHOLDS.INITIAL_PUMP && relativeVolume >= 2) {
        this.pumpMetrics.firstPump = {
          detected: true,
          startMarketCap: this.marketCapSol,
          time: Date.now(),
          highestPrice: this.currentPrice,
        };
        this.emit("pumpDetected", {
          type: "first",
          startMarketCap: this.marketCapSol,
          volume: relativeVolume,
        });
        this.transitionTo(STATES.PUMPING, "Initial pump detected");
      }
    }

    // Second pump detection
    if (this.state === STATES.RECOVERING) {
      const priceChangeFromRecovery =
        ((this.currentPrice - this.dipMetrics.recovery.startPrice) /
          this.dipMetrics.recovery.startPrice) *
        100;

      if (
        priceChangeFromRecovery >= PRICE_THRESHOLDS.TARGET_PUMP &&
        relativeVolume >= 2
      ) {
        this.pumpMetrics.secondPump = {
          detected: true,
          startMarketCap: this.marketCapSol,
          time: Date.now(),
        };
        this.emit("pumpDetected", {
          type: "second",
          startMarketCap: this.marketCapSol,
          volume: relativeVolume,
        });
        if (this.shouldRetrySafetyChecks()) {
          if (this.getTopHolderConcentration(10) > 30) {
            this.addSafetyReason("Top holder concentration too high");
            return;
          }
          // Perform final API safety checks
          // this.checkSafetyConditions();
          this.transitionTo(STATES.READY, "Second pump detected");
        }
        // TODO: If enough time has passed and pump hasn't grown too much
        // this.transitionTo(STATES.DEAD, "Token failed to recover safely");
        return;
      }
    }
  }

  detectDip() {
    // Only run in PUMPING state
    if (this.state !== STATES.PUMPING) return;

    const { acceleration, buyPressure, relativeVolume } =
      this.getVolumeProfile();
    const priceChangeFromHigh =
      ((this.currentPrice - this.pumpMetrics.firstPump.highestMarketCap) /
        this.pumpMetrics.firstPump.highestMarketCap) *
      100;

    if (
      priceChangeFromHigh <= -PRICE_THRESHOLDS.DIP_THRESHOLD &&
      relativeVolume >= 2
    ) {
      this.dipMetrics = {
        detected: true,
        price: this.currentPrice,
        time: Date.now(),
        recovery: {
          started: false,
          startPrice: null,
          startTime: null,
          highestPrice: null,
        },
        analytics: {
          uniqueBuyers: new Set(),
          uniqueSellers: new Set(),
          volume: 0,
        },
      };

      this.emit("dipDetected", {
        price: this.currentPrice,
        volume: relativeVolume,
        buyPressure,
      });

      this.transitionTo(STATES.DIPPING, "Dip detected");
    }
  }

  isMarketCapInRange() {
    const marketCapUSD = this.priceManager.solToUsd(this.marketCapSol);
    return (
      marketCapUSD >= 6500 && marketCapUSD <= this.config.MAX_ENTRY_MCAP_USD
    );
  }

  checkStateTransitions() {
    try {
      const now = Date.now();

      // Update metrics for current state
      this.updateStateMetrics();

      // Global checks
      if (!this.isMarketCapInRange()) {
        this.addSafetyReason("Market cap out of range");
        return;
      }

      switch (this.state) {
        case STATES.NEW:
          this.detectPump();
          if (now - this.createdAt > TIME_WINDOWS.INITIAL_PUMP_WINDOW) {
            this.transitionTo(STATES.DEAD, "Initial pump timeout");
          }
          break;

        case STATES.PUMPING:
          // Update ATH
          if (this.marketCapSol > this.pumpMetrics.firstPump.highestMarketCap) {
            this.pumpMetrics.firstPump.highestMarketCap = this.marketCapSol;
          }

          // Check for pump target (100% gain)
          if (
            this.marketCapSol >=
            this.pumpMetrics.firstPump.startMarketCap * 2
          ) {
            this.transitionTo(STATES.PUMPED, "Pump target reached");
          } else if (
            now - this.pumpMetrics.firstPump.time >
            TIME_WINDOWS.MAX_PUMP_WINDOW
          ) {
            this.transitionTo(
              STATES.DEAD,
              "Failed to reach pump target in time"
            );
          }
          break;

        case STATES.PUMPED:
          // Update ATH
          if (this.marketCapSol > this.pumpMetrics.firstPump.highestMarketCap) {
            this.pumpMetrics.firstPump.highestMarketCap = this.marketCapSol;
          }

          this.detectDip();
          break;

        case STATES.DIPPING:
          const { buyPressure } = this.getVolumeProfile();
          if (buyPressure > 0) {
            const consecutivePositivePressure =
              this.getConsecutivePositivePressureCandles();
            if (consecutivePositivePressure >= 3) {
              this.transitionTo(
                STATES.RECOVERING,
                "Positive buy pressure detected"
              );
            }
          }

          if (now - this.dipMetrics.time > TIME_WINDOWS.MAX_DIP_WINDOW) {
            this.transitionTo(STATES.DEAD, "Dip timeout");
          }
          break;

        case STATES.RECOVERING:
          const { buyPressure: currentPressure } = this.getVolumeProfile();
          if (currentPressure < 0) {
            this.transitionTo(STATES.DIPPING, "Buy pressure turned negative");
          } else {
            this.detectPump();
          }

          if (
            now - this.dipMetrics.recovery.startTime >
            TIME_WINDOWS.MAX_RECOVERY_WINDOW
          ) {
            this.transitionTo(STATES.DEAD, "Recovery timeout");
          }
          break;
      }
    } catch (error) {
      this.logger.error("Error in checkStateTransitions:", error);
    }
  }

  checkForRecovery() {
    const recentCandles = this.ohlcvData.secondly.slice(-30);
    if (recentCandles.length < 2) {
      return { isRecovering: false, isStrongRecovery: false };
    }

    // Calculate price change from dip
    const priceChangeFromDip =
      ((this.currentPrice - this.pumpMetrics.dipPrice) /
        this.pumpMetrics.dipPrice) *
      100;

    // Check volume sustainability
    const averageVolume =
      recentCandles
        .slice(0, -1)
        .reduce((sum, candle) => sum + candle.volume, 0) /
      (recentCandles.length - 1);
    const currentVolume = recentCandles[recentCandles.length - 1].volume;
    const volumeMultiple = currentVolume / (averageVolume || 1);

    // Get recovery metrics
    const recoveryMetrics = {
      priceChangeFromDip,
      volumeMultiple,
      dipQuality: this.getDipVolumeQuality(),
      positionMetrics: {
        entryPrice: this.currentPrice,
        targetPrice: this.pumpMetrics.highestPrice,
        stopLoss: this.pumpMetrics.dipPrice * 0.95, // 5% below dip
      },
    };

    // Check if we have a strong recovery (ready for position)
    const isStrongRecovery =
      priceChangeFromDip >= PRICE_THRESHOLDS.STRONG_RECOVERY &&
      volumeMultiple >= PRICE_THRESHOLDS.VOLUME_SUSTAIN;

    // Check if we have a normal recovery
    const isRecovering =
      priceChangeFromDip >= PRICE_THRESHOLDS.RECOVERY_THRESHOLD &&
      volumeMultiple >= PRICE_THRESHOLDS.VOLUME_SUSTAIN;

    return {
      isRecovering,
      isStrongRecovery,
      metrics: recoveryMetrics,
    };
  }

  checkRecoveryProgress() {
    const priceChangeFromDip =
      ((this.currentPrice - this.pumpMetrics.dipPrice) /
        this.pumpMetrics.dipPrice) *
      100;

    // Check volume sustainability
    const recentCandles = this.ohlcvData.secondly.slice(-30);
    const averageVolume =
      recentCandles
        .slice(0, -1)
        .reduce((sum, candle) => sum + candle.volume, 0) /
      (recentCandles.length - 1);
    const currentVolume = recentCandles[recentCandles.length - 1].volume;
    const volumeMultiple = currentVolume / (averageVolume || 1);

    // Strong recovery conditions
    if (
      priceChangeFromDip >= PRICE_THRESHOLDS.STRONG_RECOVERY &&
      volumeMultiple >= PRICE_THRESHOLDS.VOLUME_SUSTAIN
    ) {
      this.transitionTo(STATES.READY, "Strong recovery confirmed");
    }
  }

  checkForSecondPump() {
    const priceChangeFromRecovery =
      ((this.currentPrice - this.pumpMetrics.recoveryStartPrice) /
        this.pumpMetrics.recoveryStartPrice) *
      100;

    // Check volume
    const recentCandles = this.ohlcvData.secondly.slice(-30);
    const averageVolume =
      recentCandles
        .slice(0, -1)
        .reduce((sum, candle) => sum + candle.volume, 0) /
      (recentCandles.length - 1);
    const currentVolume = recentCandles[recentCandles.length - 1].volume;
    const volumeMultiple = currentVolume / (averageVolume || 1);

    if (
      priceChangeFromRecovery >= PRICE_THRESHOLDS.TARGET_PUMP &&
      volumeMultiple >= PRICE_THRESHOLDS.VOLUME_SPIKE
    ) {
      this.pumpMetrics.secondPumpDetected = true;
      this.pumpMetrics.secondPumpTime = Date.now();
      this.transitionTo(STATES.PUMPING, "Second pump detected");
    }
  }

  shouldRetrySafetyChecks() {
    if (!this.safetyReasons.length) return true; // No previous checks, go ahead

    const lastCheck = this.safetyReasons[this.safetyReasons.length - 1].time;
    const timeSinceLastCheck = Date.now() - lastCheck;

    // Only retry if:
    // 1. At least 5 seconds since last check
    // 2. Price hasn't increased more than 20% since second pump started
    if (timeSinceLastCheck < 5000) {
      return false; // Too soon to check again
    }

    const priceIncrease =
      ((this.marketCapSol - this.pumpMetrics.secondPump.startMarketCap) /
        this.pumpMetrics.secondPump.startMarketCap) *
      100;

    return priceIncrease <= 20; // Only continue checking if pump hasn't grown too much
  }

  addSafetyReason(reason) {
    this.isSafe = false;
    this.safetyReasons.push({
      time: Date.now(),
      reason,
    });
  }

  transitionTo(newState, reason = "") {
    const oldState = this.state;

    // Stop state transitions for terminal states
    if (oldState === STATES.DEAD || oldState === STATES.CLOSED) {
      return;
    }

    // Update state
    this.state = newState;

    // If transitioning to READY, check holder concentration
    if (newState === STATES.READY) {
      if (this.getTopHolderConcentration(10) > 30) {
        this.addSafetyReason("Top holder concentration too high");
        if (this.shouldRetrySafetyChecks()) {
          // Will try again later
          return;
        }
        this.transitionTo(STATES.DEAD, "Failed final safety check");
        return;
      }

      // Emit ready signal if safe
      if (this.isSafe) {
        const suggestedSize = this.calculatePositionSize();
        this.emit("readyForPosition", {
          token: this,
          metrics: {
            firstPump: this.pumpMetrics.firstPump,
            dip: this.dipMetrics,
            secondPump: this.pumpMetrics.secondPump,
          },
          suggestedSize,
        });
      }
    }

    // Emit state change event
    this.emit("stateChanged", {
      from: oldState,
      to: this.state,
      token: this,
      reason,
      metrics: {
        firstPump: this.pumpMetrics.firstPump,
        dip: this.dipMetrics,
        secondPump: this.pumpMetrics.secondPump,
      },
    });

    // Log state transition
    this.logger.info(`Token state transition: ${oldState} -> ${this.state}`, {
      mint: this.mint,
      reason,
      metrics: {
        marketCap: this.marketCapSol,
        volume: this.volume,
        safetyReasons: this.safetyReasons,
      },
    });
  }

  calculatePositionSize() {
    // Get base position size from config
    const baseSize = this.config.TRADING.BASE_POSITION_SIZE;

    // Market cap factor (smaller for higher mcap)
    // Convert marketCapSol to USD for comparison
    const marketCapUSD = this.marketCapSol * this.solPrice;
    const mcapFactor = Math.min(
      1,
      this.config.MAX_ENTRY_MCAP_USD / marketCapUSD
    );

    // Volume factor (last 30s volume)
    const recentVolume = this.ohlcvData.secondly
      .slice(-30)
      .reduce((sum, candle) => sum + candle.volume, 0);
    const volumeFactor = Math.min(
      1,
      recentVolume / this.config.TRADING.MIN_VOLUME
    );

    // Calculate suggested size
    let suggestedSize = baseSize * mcapFactor * volumeFactor;

    // Apply min/max limits
    suggestedSize = Math.max(
      this.config.TRADING.MIN_POSITION_SIZE,
      Math.min(this.config.TRADING.MAX_POSITION_SIZE, suggestedSize)
    );

    return suggestedSize;
  }

  updatePumpScore() {
    const components = this.score.components;

    // Calculate volume metrics using our new helper
    const { volumeMultiple } = this.calculateVolumeMetrics();
    components.volume = Math.min(volumeMultiple * 25, 100);

    // Calculate momentum based on price action
    const priceChangeFromStart =
      ((this.currentPrice - this.initialPrice) / this.initialPrice) * 100;
    components.momentum = Math.min(priceChangeFromStart * 2, 100);

    // Recovery score based on dip recovery if applicable
    if (this.pumpMetrics.dipDetected) {
      const priceChangeFromDip =
        ((this.currentPrice - this.pumpMetrics.dipPrice) /
          this.pumpMetrics.dipPrice) *
        100;
      components.recovery = Math.min(priceChangeFromDip * 2, 100);
    } else {
      components.recovery = 0;
    }

    // Safety score from safety checker
    const { safe, score: safetyScore } = this.safetyChecker.isTokenSafe(this);
    components.safety = safe ? safetyScore : 0;

    // Calculate overall score as weighted average
    this.score.overall = (
      components.momentum * 0.3 +
      components.volume * 0.3 +
      components.recovery * 0.2 +
      components.safety * 0.2
    ).toFixed(2);

    this.emit("scoreUpdated", {
      token: this,
      score: this.score,
    });
  }

  getDipVolumeQuality() {
    const uniqueBuyers = this.pumpMetrics.uniqueBuyersDuringDip.size;
    const uniqueSellers = this.pumpMetrics.uniqueSellersDuringDip.size;
    const buyerSellerRatio = uniqueBuyers / (uniqueSellers || 1);
    return Math.min(buyerSellerRatio, 1); // Normalized to 0-1
  }

  calculateVolumeMetrics(recentCandles = this.ohlcvData.secondly.slice(-30)) {
    if (recentCandles.length < 2) {
      return { volumeMultiple: 0, volumeSpike: false };
    }

    const averageVolume =
      recentCandles
        .slice(0, -1)
        .reduce((sum, candle) => sum + candle.volume, 0) /
      (recentCandles.length - 1);
    const currentVolume = recentCandles[recentCandles.length - 1].volume;
    const volumeMultiple = currentVolume / (averageVolume || 1);

    return {
      volumeMultiple,
      volumeSpike: volumeMultiple >= PRICE_THRESHOLDS.VOLUME_SPIKE,
    };
  }

  calculateDipQualityScore() {
    const dipDepth =
      (this.pumpMetrics.firstPumpPrice - this.pumpMetrics.dipPrice) /
      this.pumpMetrics.firstPumpPrice;
    const volumeQuality = this.getDipVolumeQuality();
    return (dipDepth * 0.6 + volumeQuality * 0.4) * 100;
  }

  updateStateMetrics() {
    const now = Date.now();

    switch (this.state) {
      case STATES.PUMPING:
        if (this.marketCapSol > this.pumpMetrics.firstPump.highestMarketCap) {
          this.pumpMetrics.firstPump.highestMarketCap = this.marketCapSol;
        }
        break;

      case STATES.DIPPING:
        this.dipMetrics.duration = now - this.dipMetrics.time;
        break;

      case STATES.RECOVERING:
        if (this.marketCapSol > this.dipMetrics.recovery.highestMarketCap) {
          this.dipMetrics.recovery.highestMarketCap = this.marketCapSol;
        }
        break;
    }
  }

  cleanup() {
    try {
      // Log final OHLCV data
      this.logger.info("Final token metrics", {
        mint: this.mint,
        symbol: this.symbol,
        totalCandles: this.ohlcvData.secondly.length,
        timespan: `${(Date.now() - this.createdAt) / 1000}s`,
        finalPrice: this.currentPrice,
        highestPrice: this.highestPrice,
        totalVolume: this.volume,
      });

      // Clear intervals and listeners
      clearInterval(this.stateCheckInterval);
      //TODO: This feels like it's about to become cruft
      clearInterval(this.safetyCheckInterval);
      clearInterval(this.ohlcvInterval);
      this.removeAllListeners();

      // Clean up position if exists
      if (this.position) {
        this.position.cleanup();
        this.position = null;
      }

      this.logger.debug("Token cleaned up", {
        mint: this.mint,
        symbol: this.symbol,
      });
    } catch (error) {
      this.logger.error("Error during token cleanup", {
        mint: this.mint,
        error: error.message,
      });
    }
  }
}

module.exports = { Token, STATES };
