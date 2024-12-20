const EventEmitter = require("events");
const STATES = require('./constants/STATES');
const Position = require("./Position");

class PositionManager extends EventEmitter {
  constructor(priceManager, wallet, config = {}) {
    super();

    this.priceManager = priceManager;
    this.wallet = wallet;
    this.positions = new Map();
    this.tokens = new Map(); // Initialize tokens Map for queue management
    this.tradingEnabled = true;

    // Default config
    this.config = {
      RISK_PER_TRADE: 0.01, // 1% of wallet per trade
      MAX_MCAP_POSITION: 0.001, // 0.1% of market cap
      STOP_LOSS_LEVEL: 0.1, // 10% stop loss
      TAKE_PROFIT_LEVEL: 0.5, // 50% take profit
      TRAILING_STOP_LEVEL: 0.2, // 20% trailing stop
      MAX_POSITIONS: 5, // Maximum number of concurrent positions
      SIGNIFICANT_PRICE_MOVEMENT_THRESHOLD: 50, // 50% move
      UNSAFE_COOLDOWN_PERIOD: 300000, // 5 minutes
      ...config,
    };

    this.logger = console;

  }

  isTradingEnabled() {
    return this.tradingEnabled;
  }

  pauseTrading() {
    this.tradingEnabled = false;
    this.emit("tradingPaused");
  }

  resumeTrading() {
    this.tradingEnabled = true;
    this.emit("tradingResumed");
  }

  calculatePositionSize(token) {
    const walletBalance = this.wallet.getBalance();
    const maxRiskAmount = walletBalance * this.config.RISK_PER_TRADE;
    const maxMcapAmount = token.marketCapSol * this.config.MAX_MCAP_POSITION;
    return Math.min(maxRiskAmount, maxMcapAmount);
  }

  async openPosition(token) {
    try {
      // Check if we're at max positions
      if (this.positions.size >= this.config.MAX_POSITIONS) {
        token.setState(STATES.SAFE_QUEUE, "Maximum positions reached");
        return false;
      }

      // If token is in SAFE_QUEUE and doesn't require safety check, proceed
      if (token.state === STATES.SAFE_QUEUE && !token.requiresSafetyCheck()) {
        const position = new Position(token);
        await position.open();
        this.positions.set(token.mint, position);
        token.setState(STATES.ACTIVE, "Position opened from queue");
        this.monitorPosition(position);
        this.emit('positionOpened', { 
          mint: token.mint,
          position,
          attempts: token.attempts
        });
        return position;
      }

      // Otherwise perform safety check
      const safetyResult = await token.checkSafetyConditions();
      if (!safetyResult.safe) {
        token.setState(STATES.UNSAFE, safetyResult.reasons.join(", "));
        return false;
      }

      // Queue if at max positions
      if (this.positions.size >= this.config.MAX_POSITIONS) {
        token.setState(STATES.SAFE_QUEUE, "Maximum positions reached");
        return false;
      }

      // Open position
      const position = new Position(token);
      await position.open();
      this.positions.set(token.mint, position);
      token.setState(STATES.ACTIVE, "Position opened");
      this.monitorPosition(position);
      this.emit('positionOpened', { 
        mint: token.mint,
        position,
        attempts: token.attempts
      });
      return position;
    } catch (error) {
      this.logger.error("Error opening position", { error, token });
      return false;
    }
  }

  async closePosition(token, reason = '') {
    const position = this.positions.get(token.mint);
    if (!position) return false;

    try {
      const success = await position.close();
      if (success) {
        // Record outcome in token
        token.recordPositionOutcome(position);
        
        // Clean up
        this.positions.delete(token.mint);
        token.setState(STATES.UNSAFE, 'Position closed: ' + reason);
        token.unsafePumpCooldown = Date.now(); // Start cooldown after position closes
        
        // Process any queued tokens
        this.processQueuedTokens();
        
        this.emit('positionClosed', {
          mint: token.mint,
          position,
          reason,
          outcomes: token.outcomes // Include all outcomes for analysis
        });

        return true;
      }

      return false;
    } catch (error) {
      this.logger.error('Failed to close position', {
        mint: token.mint,
        error: error.message
      });
      return false;
    }
  }

  async processQueuedTokens() {
    if (this.positions.size >= this.config.MAX_POSITIONS) return;

    const queuedTokens = Array.from(this.tokens.values())
      .filter(token => token.state === STATES.SAFE_QUEUE)
      .sort((a, b) => {
        // Prioritize tokens with fewer failed attempts
        const aFailures = a.attempts?.filter(attempt => !attempt.result?.safe).length || 0;
        const bFailures = b.attempts?.filter(attempt => !attempt.result?.safe).length || 0;
        return aFailures - bFailures;
      });

    for (const token of queuedTokens) {
      if (this.positions.size >= this.config.MAX_POSITIONS) break;

      // Skip if token requires safety check
      if (token.requiresSafetyCheck && token.requiresSafetyCheck()) continue;

      const position = new Position(token);
      try {
        await position.open();
        this.positions.set(token.mint, position);
        token.setState(STATES.ACTIVE, "Position opened from queue");
        this.monitorPosition(position);
        this.emit('positionOpened', { 
          mint: token.mint,
          position,
          attempts: token.attempts
        });
      } catch (error) {
        this.logger.error("Failed to open position for queued token", {
          mint: token.mint,
          error
        });
      }
    }
  }

  async closePosition(token) {
    const position = this.positions.get(token.mint);
    if (!position) return false;

    try {
      await position.close();
      this.positions.delete(token.mint);
      
      // Set cooldown
      token.unsafePumpCooldown = Date.now() + (this.config.UNSAFE_COOLDOWN_PERIOD || 300000);
      token.setState(STATES.UNSAFE, "Position closed");

      this.emit('positionClosed', {
        mint: token.mint,
        position,
        reason: 'manual_close'
      });

      return true;
    } catch (error) {
      this.logger.error("Failed to close position", {
        mint: token.mint,
        error
      });
      return false;
    }
  }

  monitorPosition(position) {
    const checkPriceMovement = () => {
      const currentPrice = position.token.getCurrentPrice();
      const priceChange = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

      if (Math.abs(priceChange) >= this.config.SIGNIFICANT_PRICE_MOVEMENT_THRESHOLD) {
        this.emit('significantPriceMovement', {
          mint: position.token.mint,
          position,
          priceChange,
          currentPrice,
          entryPrice: position.entryPrice
        });
      }
    };

    // Monitor price movements
    position.priceCheckInterval = setInterval(checkPriceMovement, 5000);

    // Clean up on position close
    position.once('closed', () => {
      if (position.priceCheckInterval) {
        clearInterval(position.priceCheckInterval);
      }
    });
  }

  getPosition(mint) {
    return this.positions.get(mint);
  }

  getAllPositions() {
    return Array.from(this.positions.values());
  }

  async updatePosition(token) {
    const position = this.positions.get(token.mint);
    if (!position) return;

    const currentPrice = token.getCurrentPrice();
    position.updatePrice(currentPrice);
  }

  async updatePositions() {
    for (const [mint, position] of this.positions) {
      try {
        await this.updatePosition(position.token);
      } catch (error) {
        this.logger.error("Failed to update position", {
          mint,
          error: error.message,
        });
      }
    }
  }

  async emergencyCloseAll() {
    const promises = [];
    for (const [mint, position] of this.positions.entries()) {
      promises.push(position.close(position.currentPrice, "emergency"));
    }
    await Promise.all(promises);
    this.positions.clear();
    this.emit("emergencyStop");
  }
}

module.exports = PositionManager;
