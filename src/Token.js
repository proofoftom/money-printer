const { EventEmitter } = require("events");

const STATES = {
  NEW: "NEW",           // Just created, monitoring for initial pump
  PUMPING: "PUMPING",   // In first pump phase
  DIPPING: "DIPPING",   // In first dip phase
  RECOVERING: "RECOVERING", // Recovering from first dip
  READY: "READY",       // Ready for position (during recovery)
  PUMPED: "PUMPED",     // Second pump detected
  UNSAFE: "UNSAFE",     // Failed safety checks
  DEAD: "DEAD",         // Exceeded max recovery time or 90% drawdown
};

// Time windows for state transitions
const TIME_WINDOWS = {
  INITIAL_PUMP_WINDOW: 30 * 1000,    // 30 seconds to detect initial pump
  MAX_DIP_WINDOW: 2 * 60 * 1000,     // 2 minutes to start recovering
  MAX_RECOVERY_WINDOW: 5 * 60 * 1000, // 5 minutes to complete recovery
};

// Price thresholds for state transitions
const PRICE_THRESHOLDS = {
  INITIAL_PUMP: 20,     // 20% price increase for initial pump
  DIP_THRESHOLD: -15,   // 15% drop from peak for dip
  RECOVERY_TARGET: 10,  // 10% recovery from dip
  VOLUME_SPIKE: 200,    // 200% of average volume
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

    // Initialize with additional tracking for pump detection
    this.pumpMetrics = {
      firstPumpDetected: false,
      firstPumpPrice: null,
      firstPumpTime: null,
      dipDetected: false,
      dipPrice: null,
      dipTime: null,
      recoveryStarted: false,
      recoveryStartPrice: null,
      recoveryStartTime: null,
      uniqueBuyersDuringDip: new Set(),
      uniqueSellersDuringDip: new Set(),
      volumeDuringDip: 0,
      secondPumpDetected: false,
      secondPumpTime: null,
    };

    // Initialize pump state tracking
    this.pumpState = {
      inCooldown: false,
      cooldownEnd: null,
      firstDipDetected: false,
      firstDipTime: null,
      firstDipPrice: null,
      recoveryHigh: null
    };

    // Enhanced scoring system
    this.score = {
      overall: 0,
      components: {
        momentum: 0,       // Price momentum score
        volume: 0,         // Volume profile score
        safety: 0,         // Safety checks score
        dipQuality: 0,     // Quality of the dip (depth, volume, unique traders)
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
          this.logger.warn("Failed final safety check before opening position", {
            mint: this.mint,
            reasons
          });
          return;
        }

        // Create and open position
        this.position = new Position(this, this.priceManager, {
          takeProfitLevel: config.TAKE_PROFIT_PERCENT,
          stopLossLevel: config.STOP_LOSS_PERCENT,
          trailingStopLevel: config.TRAILING_STOP_PERCENT
        });

        const success = this.position.open(this.currentPrice, suggestedSize);
        if (success) {
          this.logger.info("Opened position", {
            mint: this.mint,
            price: this.currentPrice,
            size: suggestedSize,
            metrics
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
              pnl: positionState.realizedPnLSol
            });
            
            // Clean up position and transition state
            this.position = null;
            this.transitionTo(STATES.PUMPED, `Position closed: ${positionState.closeReason}`);
          });
        }
      } catch (error) {
        this.logger.error("Error opening position", {
          mint: this.mint,
          error: error.message
        });
      }
    });

    // Start more frequent checks in first few minutes
    this.stateCheckInterval = setInterval(
      () => this.checkStateTransitions(),
      1000 // Check every second initially
    );

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

  checkSafetyConditions() {
    try {
      const { safe, reasons } = this.safetyChecker.isTokenSafe(this);
      const age = Date.now() - this.createdAt;

      if (!safe) {
        this.transitionTo(STATES.UNSAFE, reasons.join(', '));
        return false;
      }

      // Check if token is dead
      const drawdown = this.getDrawdownPercentage();
      if (drawdown >= 90) {
        this.transitionTo(STATES.DEAD, 'Drawdown exceeded 90%');
        return false;
      }

      // Check age for NEW state
      if (this.state === STATES.NEW) {
        if (age >= this.config.MIN_TOKEN_AGE_SECONDS * 1000) {
          this.transitionTo(STATES.READY, 'Token is safe and old enough');
        }
      }

      return true;
    } catch (error) {
      this.logger.error('Error in safety conditions check', {
        mint: this.mint,
        error: error.message
      });
      return false;
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

  checkStateTransitions() {
    try {
      const now = Date.now();
      const { safe } = this.safetyChecker.isTokenSafe(this);
      
      if (!safe) {
        this.transitionTo(STATES.UNSAFE);
        return;
      }

      switch (this.state) {
        case STATES.NEW:
          this.checkForInitialPump();
          break;
        
        case STATES.PUMPING:
          this.checkForDip();
          break;
        
        case STATES.DIPPING:
          this.checkForRecovery();
          // Check if we've exceeded max dip window
          if (now - this.pumpMetrics.dipTime > TIME_WINDOWS.MAX_DIP_WINDOW) {
            this.transitionTo(STATES.DEAD, "Exceeded maximum dip window");
          }
          break;
        
        case STATES.RECOVERING:
          this.checkRecoveryProgress();
          // Check if we've exceeded max recovery window
          if (now - this.pumpMetrics.recoveryStartTime > TIME_WINDOWS.MAX_RECOVERY_WINDOW) {
            this.transitionTo(STATES.DEAD, "Exceeded maximum recovery window");
          }
          break;

        case STATES.READY:
          this.checkForSecondPump();
          break;
      }

      // Update scoring
      this.updatePumpScore();
      
    } catch (error) {
      this.logger.error("Error in state transition check", {
        mint: this.mint,
        error: error.message,
      });
    }
  }

  checkForInitialPump() {
    const priceChange = ((this.currentPrice - this.initialPrice) / this.initialPrice) * 100;
    const volumeSpike = this.getRecentVolumeSpike();
    
    if (priceChange >= PRICE_THRESHOLDS.INITIAL_PUMP && volumeSpike >= PRICE_THRESHOLDS.VOLUME_SPIKE) {
      this.pumpMetrics.firstPumpDetected = true;
      this.pumpMetrics.firstPumpPrice = this.currentPrice;
      this.pumpMetrics.firstPumpTime = Date.now();
      this.transitionTo(STATES.PUMPING);
    }
  }

  checkForDip() {
    const priceChange = ((this.currentPrice - this.pumpMetrics.firstPumpPrice) / this.pumpMetrics.firstPumpPrice) * 100;
    
    if (priceChange <= PRICE_THRESHOLDS.DIP_THRESHOLD) {
      this.pumpMetrics.dipDetected = true;
      this.pumpMetrics.dipPrice = this.currentPrice;
      this.pumpMetrics.dipTime = Date.now();
      this.transitionTo(STATES.DIPPING);
    }
  }

  checkForRecovery() {
    const priceChange = ((this.currentPrice - this.pumpMetrics.dipPrice) / this.pumpMetrics.dipPrice) * 100;
    const volumeQuality = this.getDipVolumeQuality();
    
    if (priceChange >= PRICE_THRESHOLDS.RECOVERY_TARGET && volumeQuality >= 0.7) {
      this.pumpMetrics.recoveryStarted = true;
      this.pumpMetrics.recoveryStartPrice = this.currentPrice;
      this.pumpMetrics.recoveryStartTime = Date.now();
      
      // Check if recovery is strong enough to go directly to READY
      const recoveryStrength = this.getRecoveryStrength();
      if (recoveryStrength >= 0.8) {
        this.transitionTo(STATES.READY, 'Strong recovery detected');
      } else {
        this.transitionTo(STATES.RECOVERING, 'Recovery started');
      }
    }
  }

  checkRecoveryProgress() {
    const recoveryStrength = this.getRecoveryStrength();
    if (recoveryStrength >= 0.8) {
      // Check safety conditions before transitioning to READY
      const { safe, reasons } = this.safetyChecker.isTokenSafe(this);
      if (safe) {
        this.transitionTo(STATES.READY, "Recovery complete, safety checks passed");
      } else {
        this.transitionTo(STATES.UNSAFE, `Recovery complete but failed safety checks: ${reasons.join(", ")}`);
      }
    }
  }

  checkForSecondPump() {
    const priceChange = ((this.currentPrice - this.pumpMetrics.recoveryStartPrice) / this.pumpMetrics.recoveryStartPrice) * 100;
    const volumeSpike = this.getRecentVolumeSpike();
    
    if (priceChange >= PRICE_THRESHOLDS.INITIAL_PUMP && volumeSpike >= PRICE_THRESHOLDS.VOLUME_SPIKE) {
      this.pumpMetrics.secondPumpDetected = true;
      this.pumpMetrics.secondPumpTime = Date.now();
      this.transitionTo(STATES.PUMPED);
    }
  }

  transitionTo(newState, reason = '') {
    const oldState = this.state;
    
    // Stop state transitions for terminal states
    if (newState === STATES.PUMPED || newState === STATES.DEAD || newState === STATES.UNSAFE) {
      clearInterval(this.stateCheckInterval);
    }

    // Update state
    this.state = newState;
    
    // If transitioning to READY, do final safety check and emit readyForPosition
    if (newState === STATES.READY) {
      const { safe, reasons } = this.safetyChecker.isTokenSafe(this);
      if (safe) {
        const metrics = {
          recoveryStrength: this.getRecoveryStrength(),
          volumeQuality: this.getDipVolumeQuality(),
          buyerSellerRatio: this.pumpMetrics.uniqueBuyersDuringDip.size / 
                           (this.pumpMetrics.uniqueSellersDuringDip.size || 1),
          timeSinceDip: Date.now() - this.pumpMetrics.dipTime,
        };
        
        const suggestedSize = this.calculatePositionSize();
        this.emit('readyForPosition', { token: this, metrics, suggestedSize });
      } else {
        // If safety check fails, transition to UNSAFE
        this.state = STATES.UNSAFE;
        reason = `Failed final safety check: ${reasons.join(", ")}`;
      }
    }

    // Log state transition
    this.logger.info(`Token state transition: ${oldState} -> ${this.state}`, {
      mint: this.mint,
      reason,
      metrics: {
        price: this.currentPrice,
        volume: this.volume,
        score: this.score.overall,
      }
    });

    // Emit state change event
    this.emit('stateChanged', {
      from: oldState,
      to: this.state,
      token: this,
      reason,
      metrics: this.pumpMetrics,
      score: this.score,
    });
  }

  calculatePositionSize() {
    // Calculate position size based on market cap and risk settings
    const maxPositionSol = this.marketCapSol * this.config.MAX_MCAP_POSITION;
    const riskBasedSize = this.marketCapSol * (this.config.RISK_PER_TRADE || 0.1);
    
    // Adjust size based on recovery strength and score
    const confidenceMultiplier = (this.score.overall / 100) * this.getRecoveryStrength();
    const suggestedSize = Math.min(maxPositionSol, riskBasedSize) * confidenceMultiplier;
    
    // Ensure size is within min/max bounds
    const minPositionSol = this.marketCapSol * this.config.MIN_MCAP_POSITION;
    return Math.max(minPositionSol, Math.min(suggestedSize, maxPositionSol));
  }

  updatePumpScore() {
    const components = this.score.components;
    
    // Update momentum score
    components.momentum = this.calculateMomentumScore();
    
    // Update volume score
    components.volume = this.calculateVolumeScore();
    
    // Update dip quality score
    if (this.state === STATES.DIPPING || this.state === STATES.RECOVERING) {
      components.dipQuality = this.calculateDipQualityScore();
    }
    
    // Update recovery strength score
    if (this.state === STATES.RECOVERING || this.state === STATES.READY) {
      components.recoveryStrength = this.calculateRecoveryScore();
    }
    
    // Calculate overall score (weighted average)
    this.score.overall = (
      components.momentum * 0.3 +
      components.volume * 0.2 +
      components.safety * 0.2 +
      components.dipQuality * 0.15 +
      components.recoveryStrength * 0.15
    );
    
    this.score.lastUpdate = Date.now();
  }

  // Helper methods for metrics
  getRecentVolumeSpike() {
    const recentVolume = this.volume - (this.pumpMetrics.volumeDuringDip || 0);
    const timeWindow = 30000; // 30 seconds
    const volumePerSecond = recentVolume / (timeWindow / 1000);
    const averageVolume = this.volume / ((Date.now() - this.createdAt) / 1000);
    return (volumePerSecond / averageVolume) * 100;
  }

  getDipVolumeQuality() {
    const uniqueBuyers = this.pumpMetrics.uniqueBuyersDuringDip.size;
    const uniqueSellers = this.pumpMetrics.uniqueSellersDuringDip.size;
    const buyerSellerRatio = uniqueBuyers / (uniqueSellers || 1);
    return Math.min(buyerSellerRatio, 1); // Normalized to 0-1
  }

  getRecoveryStrength() {
    if (!this.pumpMetrics.recoveryStarted) return 0;
    
    const priceRecovery = ((this.currentPrice - this.pumpMetrics.dipPrice) / this.pumpMetrics.dipPrice) * 100;
    const volumeQuality = this.getDipVolumeQuality();
    const timeFactor = 1 - (Date.now() - this.pumpMetrics.recoveryStartTime) / TIME_WINDOWS.MAX_RECOVERY_WINDOW;
    
    return (priceRecovery * 0.4 + volumeQuality * 0.4 + timeFactor * 0.2) / 100;
  }

  calculateMomentumScore() {
    const priceChange = (this.currentPrice - this.initialPrice) / this.initialPrice;
    return priceChange * 100;
  }

  calculateVolumeScore() {
    const recentVolume = this.ohlcvData.secondly.slice(-30).reduce((sum, c) => sum + c.volume, 0);
    const avgVolume = this.volume / this.tradeCount;
    return (recentVolume / (avgVolume * 30)) * 100;
  }

  calculateDipQualityScore() {
    const dipDepth = (this.pumpMetrics.firstPumpPrice - this.pumpMetrics.dipPrice) / this.pumpMetrics.firstPumpPrice;
    const volumeQuality = this.getDipVolumeQuality();
    return (dipDepth * 0.6 + volumeQuality * 0.4) * 100;
  }

  calculateRecoveryScore() {
    const recoveryStrength = this.getRecoveryStrength();
    return recoveryStrength * 100;
  }

  cleanup() {
    try {
      // Clear all intervals
      clearInterval(this.stateCheckInterval);
      clearInterval(this.safetyCheckInterval);
      clearInterval(this.ohlcvInterval);

      // Remove all event listeners
      this.removeAllListeners();

      // Close position if it exists
      if (this.position) {
        this.position.cleanup();
        this.position = null;
      }

      this.logger.debug('Token cleaned up', {
        mint: this.mint,
        symbol: this.symbol
      });
    } catch (error) {
      this.logger.error('Error during token cleanup', {
        mint: this.mint,
        error: error.message
      });
    }
  }
}

module.exports = { Token, STATES };
