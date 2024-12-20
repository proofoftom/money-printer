const EventEmitter = require('events');
const STATES = require('./constants/STATES');
const { AGGREGATION_THRESHOLDS, TIMEFRAMES } = require('./constants/TIME');

class Token extends EventEmitter {
  constructor(tokenData, { priceManager, safetyChecker, logger, config } = {}) {
    super();

    // Clear any existing intervals
    if (this.safetyCheckInterval) clearInterval(this.safetyCheckInterval);
    if (this.ohlcvInterval) clearInterval(this.ohlcvInterval);

    // Validate required token data
    if (!tokenData || !tokenData.mint) {
      throw new Error('Token data must include mint address');
    }

    this.mint = tokenData.mint;
    this.priceManager = priceManager;
    this.safetyChecker = safetyChecker;
    this.logger = logger || console;
    
    // Default configuration
    this.config = {
      PUMP_DETECTION_THRESHOLD: 20,
      DIP_DETECTION_THRESHOLD: 15,
      RECOVERY_THRESHOLD: 10,
      PUMP_VOLUME_MULTIPLIER: 2,
      CYCLE_COOLDOWN_PERIOD: 60000,
      SIGNAL_COOLDOWN_PERIOD: 30000,
      SAFETY_CHECK_TTL: 15000,      // 15 seconds for normal safety checks
      UNSAFE_CHECK_TTL: 10000,      // 10 seconds for unsafe tokens
      UNSAFE_PUMP_COOLDOWN: 30000,
      MAX_RECOVERY_THRESHOLD: 30,
      MISSED_OPPORTUNITY_TRACKING_PERIOD: 3600000,
      SIGNIFICANT_GAIN_THRESHOLD: 100,
      ...config
    };

    // Initialize tracking arrays
    this.attempts = [];
    this.outcomes = [];
    this.missedOpportunities = [];
    this.failurePatterns = new Map();
    this.activeTracking = new Map();
    
    // State management
    this.state = STATES.NEW;
    this.stateHistory = [];
    this.lastStateChange = Date.now();
    
    // Safety check tracking
    this.lastSafetyCheck = null;
    this.consecutiveFailures = 0;
    this.unsafePumpCooldown = 0;

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
    this.config = {
      PUMP_DETECTION_THRESHOLD: 20, // 20% price increase
      DIP_DETECTION_THRESHOLD: 15,  // 15% price decrease
      RECOVERY_THRESHOLD: 10,       // 10% recovery from dip
      PUMP_VOLUME_MULTIPLIER: 2,    // 2x normal volume
      CYCLE_COOLDOWN_PERIOD: 60000, // 1 minute cooldown between cycles
      SIGNAL_COOLDOWN_PERIOD: 30000, // 30 second cooldown between trading signals
      SAFETY_CHECK_TTL: 5000,       // 5 seconds before requiring new safety check
      UNSAFE_CHECK_TTL: 10000,      // 10 seconds for unsafe tokens
      UNSAFE_PUMP_COOLDOWN: 30000,  // 30 seconds cooldown for unsafe token pumps
      MAX_RECOVERY_THRESHOLD: 30,    // 30% max recovery before considering unsafe
      MISSED_OPPORTUNITY_TRACKING_PERIOD: 3600000, // 1 hour
      SIGNIFICANT_GAIN_THRESHOLD: 100, // 100% gain for significant miss
      ...config
    };

    // Attempt tracking
    this.attempts = [];
    this.outcomes = [];
    this.missedOpportunities = [];
    this.failurePatterns = new Map(); // Track patterns in safety check failures
    
    // Active tracking
    this.activeTracking = new Map(); // Track price movements after failures
    this.lastTrackingCleanup = Date.now();
    
    // Cooldown management
    this.unsafePumpCooldown = 0;
    this.consecutiveFailures = 0;

    // State management
    this.state = STATES.NEW;
    this.stateHistory = [];
    this.lastStateTransition = Date.now();
    this.isMature = false; // Flag for tokens that completed multiple cycles

    // Safety check tracking
    this.lastSafetyCheck = {
      timestamp: 0,
      state: null,
      result: null
    };

    // Cycle tracking
    this.pumpCycle = 0;
    this.pumpHistory = [];
    this.cycleQualityScores = [];

    // Cooldown management
    this.cooldowns = {
      cycle: 0,      // Cooldown for new pump cycles
      signal: 0,     // Cooldown for trading signals
      recovery: 0    // Cooldown for recovery confirmation
    };

    // Start monitoring if not in test environment
    if (process.env.NODE_ENV !== 'test') {
      this.startMonitoring();
    }

    this.logger.info("Token initialized", {
      mint: this.mint,
      symbol: this.symbol,
      price: this.currentPrice,
      marketCapSol: this.marketCapSol,
    });
  }

  startMonitoring() {
    // Clear any existing intervals
    if (this.safetyCheckInterval) clearInterval(this.safetyCheckInterval);
    if (this.ohlcvInterval) clearInterval(this.ohlcvInterval);

    // Start safety check interval
    this.safetyCheckInterval = setInterval(() => {
      this.checkSafetyConditions();
    }, this.config.SAFETY_CHECK_TTL || 15000);

    // Start OHLCV update interval
    this.ohlcvInterval = setInterval(() => {
      this.updateOHLCV();
    }, 1000);
  }

  stopMonitoring() {
    if (this.safetyCheckInterval) clearInterval(this.safetyCheckInterval);
    if (this.ohlcvInterval) clearInterval(this.ohlcvInterval);
  }

  calculateTokenPrice() {
    if (!this.vTokensInBondingCurve || !this.vSolInBondingCurve) {
      return 0;
    }
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

      // Store old values for comparison
      const oldPrice = this.currentPrice;

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

      // Handle state transitions based on token lifecycle
      try {
        if (this.detectPump()) {
          this.setState(STATES.PUMPING, 'Pump detected');
        } else if (this.detectDip()) {
          this.setState(STATES.DIPPING, 'Dip detected');
        } else if (this.detectRecovery()) {
          // Determine if token should go to READY or MATURE state
          const shouldBeMature = this.pumpCycle > 1 || 
                               Date.now() - this.createdAt > 30 * 60 * 1000; // 30 minutes old
          this.setState(shouldBeMature ? STATES.ACTIVE : STATES.SAFE_QUEUE, 'Recovery confirmed');
        }
      } catch (stateError) {
        this.logger.warn('State transition error', {
          error: stateError.message,
          currentState: this.state,
          mint: this.mint
        });
      }

      // Emit trade event with WebSocket-compatible structure
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
        priceChange: ((this.currentPrice - oldPrice) / oldPrice) * 100,
        marketCapSol: this.marketCapSol,
        state: this.state,
        cycle: this.pumpCycle
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

  requiresSafetyCheck() {
    if (!this.lastSafetyCheck) return true;

    const now = Date.now();
    const ttl = this.state === STATES.UNSAFE ? 
      this.config.UNSAFE_CHECK_TTL : 
      this.config.SAFETY_CHECK_TTL;

    // If in SAFE_QUEUE and last check was safe, respect TTL
    if (this.state === STATES.SAFE_QUEUE && 
        this.lastSafetyCheck.result?.safe && 
        now - this.lastSafetyCheck.timestamp < ttl) {
      return false;
    }

    // Otherwise check TTL
    return now - this.lastSafetyCheck.timestamp >= ttl;
  }

  async checkSafetyConditions() {
    // Skip check if in SAFE_QUEUE with valid TTL
    if (this.state === STATES.SAFE_QUEUE && !this.requiresSafetyCheck()) {
      return this.lastSafetyCheck.result;
    }

    try {
      const now = Date.now();
      
      // Check unsafe pump cooldown
      if (this.state === STATES.UNSAFE && now - this.unsafePumpCooldown < this.config.UNSAFE_PUMP_COOLDOWN) {
        return { safe: false, reasons: ['Unsafe pump cooldown active'] };
      }

      // Only perform check if needed
      if (!this.requiresSafetyCheck()) {
        return this.lastSafetyCheck.result;
      }

      // Record attempt
      const attempt = {
        timestamp: now,
        state: this.state,
        price: this.currentPrice,
        volume: this.volume,
        cycle: this.pumpCycle,
        metrics: {
          volumeProfile: this.indicators.volumeProfile.get('relativeVolume'),
          priceChange24h: this.getPriceChange24h()
        }
      };

      // Perform safety check
      const result = await this.safetyChecker.checkToken(this);
      attempt.result = result;

      if (!result.safe) {
        this.consecutiveFailures++;
        attempt.failureReason = result.reasons.join(', ');
        
        // Start tracking this failure
        this.trackFailedAttempt(attempt);
        
        // Update failure patterns
        this.updateFailurePatterns(result.reasons);
        
        // Adjust cooldown based on patterns
        this.adjustCooldownPeriods();
      } else {
        this.consecutiveFailures = 0;
      }

      this.attempts.push(attempt);

      // Update last check info
      this.lastSafetyCheck = {
        timestamp: now,
        state: this.state,
        result
      };

      // Update state based on result
      if (result.safe && this.state !== STATES.SAFE_QUEUE && this.state !== STATES.ACTIVE) {
        this.setState(STATES.SAFE_QUEUE, 'Passed safety check');
      }
      else if (!result.safe && this.state !== STATES.UNSAFE) {
        this.setState(STATES.UNSAFE, result.reasons.join(', '));
      }

      // Emit attempt event
      this.emit('attemptRecorded', { attempt });

      return result;
    } catch (error) {
      this.logger.error('Safety check failed', {
        mint: this.mint,
        error: error.message
      });
      return { safe: false, reasons: ['Safety check error: ' + error.message] };
    }
  }

  trackFailedAttempt(attempt) {
    const trackingId = `${attempt.timestamp}-${this.mint}`;
    const tracking = {
      attempt,
      startPrice: this.currentPrice,
      maxPrice: this.currentPrice,
      maxGainPercent: 0,
      timeToMaxGain: 0,
      lastUpdate: Date.now()
    };
    
    this.activeTracking.set(trackingId, tracking);
    
    // Schedule cleanup
    setTimeout(() => {
      this.finalizeTracking(trackingId);
    }, this.config.MISSED_OPPORTUNITY_TRACKING_PERIOD);
  }

  updatePriceTracking() {
    const now = Date.now();
    
    for (const [id, tracking] of this.activeTracking.entries()) {
      const gainPercent = ((this.currentPrice - tracking.attempt.price) / tracking.attempt.price) * 100;
      
      if (this.currentPrice > tracking.maxPrice) {
        tracking.maxPrice = this.currentPrice;
        tracking.maxGainPercent = gainPercent;
        tracking.timeToMaxGain = now - tracking.attempt.timestamp;
        
        // Check for significant gain
        if (gainPercent >= this.config.SIGNIFICANT_GAIN_THRESHOLD && !tracking.significantGainReported) {
          tracking.significantGainReported = true;
          this.emit('significantMissedOpportunity', {
            mint: this.mint,
            attempt: tracking.attempt,
            gainPercent,
            timeToGain: tracking.timeToMaxGain
          });
        }
      }
      
      tracking.lastUpdate = now;
    }
  }

  finalizeTracking(trackingId) {
    const tracking = this.activeTracking.get(trackingId);
    if (!tracking) return;
    
    this.activeTracking.delete(trackingId);
    
    if (tracking.maxGainPercent >= this.config.SIGNIFICANT_GAIN_THRESHOLD) {
      const opportunity = {
        ...tracking,
        finalPrice: this.currentPrice,
        totalTrackedTime: Date.now() - tracking.attempt.timestamp
      };
      
      this.missedOpportunities.push(opportunity);
      this.emit('missedOpportunityRecorded', { opportunity });
      
      // Write to analysis log
      this.writeToAnalysisLog(opportunity);
    }
  }

  updateFailurePatterns(reasons) {
    for (const reason of reasons) {
      const pattern = this.failurePatterns.get(reason) || { count: 0, lastOccurrence: 0 };
      pattern.count++;
      pattern.lastOccurrence = Date.now();
      this.failurePatterns.set(reason, pattern);
    }
  }

  adjustCooldownPeriods() {
    // Increase cooldown based on consecutive failures
    if (this.consecutiveFailures > 3) {
      this.config.UNSAFE_PUMP_COOLDOWN *= 1.5;
      this.config.SAFETY_CHECK_TTL *= 1.2;
    }
    
    // Adjust based on failure patterns
    for (const [reason, pattern] of this.failurePatterns.entries()) {
      if (pattern.count > 5 && Date.now() - pattern.lastOccurrence < 3600000) {
        // If we see the same failure reason frequently, increase cooldowns
        this.config.UNSAFE_PUMP_COOLDOWN *= 1.2;
        this.config.SAFETY_CHECK_TTL *= 1.1;
      }
    }
  }

  recordPositionOutcome(position) {
    const outcome = {
      timestamp: Date.now(),
      entryPrice: position.entryPrice,
      exitPrice: position.exitPrice,
      entryTime: position.entryTime,
      exitTime: position.exitTime,
      attempts: this.attempts.slice(), // Copy of attempts leading to this position
      pnl: position.realizedPnl,
      cycle: this.pumpCycle
    };
    
    this.outcomes.push(outcome);
    this.emit('outcomeRecorded', { outcome });
    
    // Write to analysis log
    this.writeToAnalysisLog(outcome, 'successful_trades');
  }

  async writeToAnalysisLog(data, type = 'missed_opportunities') {
    try {
      const logEntry = {
        timestamp: Date.now(),
        mint: this.mint,
        type,
        data
      };
      
      // Emit event for external logging
      this.emit('analysisLogEntry', logEntry);
    } catch (error) {
      this.logger.error('Failed to write to analysis log', {
        mint: this.mint,
        error: error.message
      });
    }
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
      volume: this.vTokensInBondingCurve
    };

    // Determine appropriate timeframe
    if (timeSinceCreation < AGGREGATION_THRESHOLDS.FIVE_MIN) {
      this.ohlcvData.secondly.push(candle);
    } else if (timeSinceCreation < AGGREGATION_THRESHOLDS.THIRTY_MIN) {
      if (now % TIMEFRAMES.FIVE_SECONDS === 0) {
        this.ohlcvData.fiveSeconds.push(candle);
      }
    } else {
      if (now % TIMEFRAMES.THIRTY_SECONDS === 0) {
        this.ohlcvData.thirtySeconds.push(candle);
      }
    }

    this.updateIndicators();
    this.updateScore();
    this.detectPumpAndDip();
    this.updatePriceTracking();
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

  detectPump() {
    if (this.state !== STATES.NEW && this.state !== STATES.ACTIVE) {
      this.logger.debug('Pump detection skipped - invalid state', { state: this.state });
      return false;
    }

    if (this.isCoolingDown('cycle')) {
      this.logger.debug('Pump detection skipped - in cycle cooldown');
      return false;
    }

    const recentCandles = this.ohlcvData.secondly.slice(-30);
    if (recentCandles.length < 2) {
      this.logger.debug('Pump detection skipped - insufficient candle data');
      return false;
    }

    const priceChange = (this.currentPrice - recentCandles[0].close) / recentCandles[0].close;
    const volumeSpike = this.indicators.volumeProfile.get('relativeVolume') > 2;

    const isPumping = priceChange > this.config.PUMP_DETECTION_THRESHOLD && volumeSpike;

    if (isPumping && !this.isCoolingDown('signal')) {
      this.logger.info('Pump detected', {
        mint: this.mint,
        priceChange,
        relativeVolume: this.indicators.volumeProfile.get('relativeVolume'),
        cycle: this.pumpCycle + 1
      });

      // Set cooldowns
      this.setCooldown('signal');
      
      // Emit trading signal for potential entry
      this.emit('tradingSignal', {
        type: 'pump_detected',
        price: this.currentPrice,
        timestamp: Date.now(),
        priceChange,
        relativeVolume: this.indicators.volumeProfile.get('relativeVolume'),
        score: this.score.overall,
        metrics: {
          volumeSpike,
          candleCount: recentCandles.length
        }
      });
    }

    return isPumping;
  }

  detectDip() {
    if (this.state !== STATES.PUMPING) {
      this.logger.debug('Dip detection skipped - not in pumping state', { state: this.state });
      return false;
    }

    if (this.isCoolingDown('signal')) {
      this.logger.debug('Dip detection skipped - in signal cooldown');
      return false;
    }

    const recentCandles = this.ohlcvData.secondly.slice(-30);
    if (recentCandles.length < 2) {
      this.logger.debug('Dip detection skipped - insufficient candle data');
      return false;
    }

    const priceChange = (this.currentPrice - this.highestPrice) / this.highestPrice;
    const volumeSpike = this.indicators.volumeProfile.get('relativeVolume') > 2;

    const isDipping = priceChange < -this.config.DIP_DETECTION_THRESHOLD && volumeSpike;

    if (isDipping) {
      this.logger.info('Dip detected', {
        mint: this.mint,
        priceChange,
        relativeVolume: this.indicators.volumeProfile.get('relativeVolume'),
        cycle: this.pumpCycle
      });

      // Store dip info for recovery tracking
      this.dipPrice = this.currentPrice;
      this.dipTime = Date.now();
      
      // Set cooldown for recovery detection
      this.setCooldown('recovery', 15000); // 15 second cooldown before allowing recovery
    }

    return isDipping;
  }

  async detectRecovery() {
    if (!this.dipPrice || this.state !== STATES.DIPPING) {
      return false;
    }

    const recoveryPercent = ((this.currentPrice - this.dipPrice) / this.dipPrice) * 100;
    
    if (recoveryPercent >= this.config.RECOVERY_THRESHOLD) {
      // If in UNSAFE state, check if recovery is too high
      if (this.state === STATES.UNSAFE && recoveryPercent > this.config.MAX_RECOVERY_THRESHOLD) {
        this.logger.info('Recovery exceeded maximum threshold', {
          mint: this.mint,
          recoveryPercent,
          maxThreshold: this.config.MAX_RECOVERY_THRESHOLD
        });
        return false;
      }

      // Emit trading signal
      this.emit('tradingSignal', {
        type: 'recovery_confirmed',
        price: this.currentPrice,
        metrics: {
          recoveryPercent,
          volumeSpike: this.hasVolumePump(),
          candleCount: this.getCandlesSinceDip(),
          recoveryHigh: this.getRecoveryHigh()
        }
      });

      // Try to open position immediately
      this.emit('recoveryDetected', {
        token: this,
        recoveryPercent,
        price: this.currentPrice
      });

      return true;
    }

    return false;
  }

  isCoolingDown(type) {
    return Date.now() < (this.cooldowns[type] || 0);
  }

  setCooldown(type, duration) {
    this.cooldowns[type] = Date.now() + (duration || this.config.SIGNAL_COOLDOWN_PERIOD);
  }

  setState(newState, reason = '') {
    if (newState === this.state) return;

    const oldState = this.state;
    this.state = newState;
    
    // Record state transition
    this.stateHistory.push({
      from: oldState,
      to: newState,
      timestamp: Date.now(),
      price: this.currentPrice,
      marketCap: this.marketCapSol,
      reason
    });

    // Update cycle info if entering PUMPING state
    if (newState === STATES.PUMPING) {
      this.pumpCycle++;
      this.pumpHistory.push({
        cycle: this.pumpCycle,
        startTime: Date.now(),
        startPrice: this.currentPrice,
        highestPrice: this.currentPrice
      });
    }

    // Calculate cycle quality when reaching READY or MATURE state
    if (newState === STATES.ACTIVE) {
      const currentCycle = this.pumpHistory[this.pumpHistory.length - 1];
      if (currentCycle) {
        const cycleQuality = this.calculateCycleQuality(currentCycle);
        this.cycleQualityScores.push({
          cycle: this.pumpCycle,
          score: cycleQuality,
          timestamp: Date.now()
        });
      }
    }

    // Emit state change event with all relevant metrics
    this.emit('stateChanged', {
      token: this.mint,
      oldState,
      newState,
      timestamp: Date.now(),
      reason,
      metrics: {
        price: this.currentPrice,
        marketCap: this.marketCapSol,
        volume: this.volume,
        relativeVolume: this.indicators.volumeProfile.get('relativeVolume'),
        score: this.score.overall,
        cycle: this.pumpCycle,
        cycleQuality: this.cycleQualityScores[this.cycleQualityScores.length - 1]?.score
      }
    });

    this.logger.info('Token state changed', {
      mint: this.mint,
      from: oldState,
      to: newState,
      reason,
      cycle: this.pumpCycle
    });
  }

  calculateCycleQuality(cycle) {
    const weights = this.config.CYCLE_QUALITY_WEIGHTS;
    let score = 0;

    // Price action score (0-100)
    const priceReturn = ((this.currentPrice - cycle.startPrice) / cycle.startPrice) * 100;
    const priceScore = Math.min(100, Math.max(0, priceReturn));
    score += priceScore * weights.priceAction;

    // Volume score (0-100)
    const volumeIncrease = (this.volume / (cycle.startVolume || 1));
    const volumeScore = Math.min(100, (volumeIncrease / this.config.PUMP_VOLUME_MULTIPLIER) * 100);
    score += volumeScore * weights.volume;

    // Holder score (0-100)
    const holderGrowth = this.getHolderCount() - (cycle.startHolders || 0);
    const holderScore = Math.min(100, Math.max(0, holderGrowth));
    score += holderScore * weights.holders;

    // Time score (0-100) - Prefer faster cycles
    const cycleTime = Date.now() - cycle.startTime;
    const timeScore = Math.max(0, 100 - (cycleTime / (15 * 60 * 1000)) * 100); // 15 min reference
    score += timeScore * weights.time;

    return Math.round(score);
  }

  completeCycle() {
    this.pumpCycle++;
    if (this.pumpCycle > 1) {
      this.isMature = true;
    }
    
    // Calculate and store cycle quality
    const cycleQuality = this.calculateCycleQuality();
    this.cycleQualityScores.push({
      cycle: this.pumpCycle,
      score: cycleQuality,
      timestamp: Date.now()
    });
  }

  cleanup() {
    try {
      if (this.safetyCheckInterval) clearInterval(this.safetyCheckInterval);
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

  getCurrentPrice() {
    return this.calculateTokenPrice();
  }
}

module.exports = Token;
