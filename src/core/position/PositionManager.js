// PositionManager component
const EventEmitter = require('events');
const Position = require('./Position');
const config = require('../../utils/config');
const Wallet = require('../../utils/Wallet');
const ExitStrategies = require('./ExitStrategies');
const TransactionSimulator = require('../../utils/TransactionSimulator');
const PositionStateManager = require('./PositionStateManager');
const errorLogger = require('../../monitoring/errorLoggerInstance');

class PositionManager extends EventEmitter {
  constructor(wallet) {
    super();
    this.wallet = wallet;
    this.wins = 0;
    this.losses = 0;
    this.exitStrategies = new ExitStrategies(config.EXIT_STRATEGIES);
    this.transactionSimulator = new TransactionSimulator();
    this.stateManager = new PositionStateManager();

    // Set up position state event handlers
    this.stateManager.on('positionAdded', this.handlePositionAdded.bind(this));
    this.stateManager.on('positionUpdated', this.handlePositionUpdated.bind(this));
    this.stateManager.on('positionClosed', this.handlePositionClosed.bind(this));
    this.stateManager.on('partialExit', this.handlePartialExit.bind(this));
    
    // Recovery strategy event handlers
    this.stateManager.on('recoveryAccumulation', this.handleRecoveryAccumulation.bind(this));
    this.stateManager.on('recoveryExpansion', this.handleRecoveryExpansion.bind(this));
    this.stateManager.on('recoveryDistribution', this.handleRecoveryDistribution.bind(this));

    // Periodic position validation
    this._validateInterval = setInterval(() => this.validatePositions(), 60000); // Every minute
  }

  handlePositionAdded(position) {
    this.emit('positionEntered', position);
  }

  handlePositionUpdated(position) {
    this.emit('positionUpdated', position);
  }

  handlePositionClosed(position) {
    this.emit('positionExited', position);
  }

  handlePartialExit(position) {
    this.emit('partialExit', position);
  }

  handleRecoveryAccumulation({ mint, metrics }) {
    const position = this.getPosition(mint);
    if (!position) return;

    // Increase position size during strong accumulation
    if (metrics.buyPressure > 0.7 && metrics.marketStructure === 'bullish') {
      const additionalSize = this.calculatePositionSize(position.size * metrics.recoveryStrength);
      this.increasePosition(mint, additionalSize);
    }
  }

  handleRecoveryExpansion({ mint, metrics }) {
    const position = this.getPosition(mint);
    if (!position) return;

    // Adjust trailing stop based on recovery strength
    if (metrics.recoveryStrength > 0.4) {
      const trailPercent = Math.min(
        config.EXIT_STRATEGIES.MAX_TRAIL_PERCENT,
        metrics.recoveryStrength * config.EXIT_STRATEGIES.BASE_TRAIL_PERCENT
      );
      this.exitStrategies.updateTrailingStop(position, trailPercent);
    }
  }

  handleRecoveryDistribution({ mint, metrics }) {
    const position = this.getPosition(mint);
    if (!position) return;

    // Exit position if distribution phase shows weakness
    if (metrics.buyPressure < 0.3 || metrics.marketStructure === 'bearish') {
      this.closePosition(mint, position.currentPrice);
    }
  }

  async enterPosition(token, options = {}) {
    const { size = config.POSITION.MAX_SOL } = options;

    // Create and store the new position
    const position = new Position(token, {
      size,
      entryPrice: token.currentPrice,
      timestamp: Date.now()
    });

    this.stateManager.addPosition(position);
    await this.stateManager.saveState();

    this.emit("positionEntered", position);
    return position;
  }

  async exitPosition(position, reason = "manual") {
    const profitLoss = position.calculateProfitLoss();
    
    this.stateManager.closePosition(position.mint);
    await this.stateManager.saveState();

    this.emit("positionExited", { position, profitLoss, reason });
    return { profitLoss, reason };
  }

  async updatePosition(mint, marketCapSol, volumeData) {
    const position = this.getPosition(mint);
    if (!position) return null;

    // Check if position no longer meets criteria
    if (!await this.meetsHoldingCriteria(position, marketCapSol, volumeData)) {
      return this.exitPosition(position, "criteria_not_met");
    }

    // Check recovery conditions
    if (position.isRecoveryPosition && !this.checkRecoveryConditions(position)) {
      return this.exitPosition(position, "recovery_failed");
    }

    return null;
  }

  async openPosition(token) {
    const { POSITION, RISK } = config;
    
    try {
      // Risk management checks
      if (this.getDailyLoss() <= -RISK.MAX_DAILY_LOSS) {
        throw new Error('Daily loss limit reached');
      }

      if (this.getTotalExposure() >= RISK.MAX_EXPOSURE) {
        throw new Error('Maximum portfolio exposure reached');
      }

      // Calculate risk/reward
      const potentialLoss = Math.abs(POSITION.EXIT.STOP_LOSS);
      const potentialGain = POSITION.EXIT.PROFIT;
      if (potentialGain / potentialLoss < RISK.MIN_RISK_REWARD) {
        throw new Error('Risk/reward ratio too low');
      }

      // Create and open position
      const positionSize = this.calculatePositionSize(token.marketCap, token.volatility);
      
      if (this.wallet.balance >= positionSize) {
        // Simulate transaction delay and price impact
        const delay = await this.transactionSimulator.simulateTransactionDelay();
        const executionPrice = this.transactionSimulator.calculatePriceImpact(
          positionSize,
          token.marketCap,
          0
        );

        const position = new Position({
          mint: token.mint,
          entryPrice: executionPrice,
          size: positionSize,
          simulatedDelay: delay
        });

        this.stateManager.addPosition(position);
        this.wallet.updateBalance(-positionSize);

        // Set up position event listeners
        position.on('updated', this.handlePositionUpdated.bind(this));
        position.on('partialExit', this.handlePartialExit.bind(this));
        position.on('closed', this.handlePositionClosed.bind(this));

        // Emit trade event for opening position
        this.emit('trade', {
          type: 'BUY',
          mint: token.mint,
          profitLoss: 0,
          symbol: token.symbol,
          size: positionSize,
          price: executionPrice,
          timestamp: Date.now()
        });

        return true;
      }

      return false;
    } catch (error) {
      console.error('Failed to open position:', error);
      return false;
    }
  }

  getTotalExposure() {
    let totalValue = 0;
    for (const position of this.stateManager.getPositions()) {
      if (position.isOpen()) {
        totalValue += position.getCurrentValue();
      }
    }
    return (totalValue / this.wallet.getTotalBalance()) * 100;
  }

  async closePosition(mint, exitPrice, portion = 1.0) {
    const position = this.stateManager.getPosition(mint);
    if (!position) {
      const error = new Error(`Cannot close position: Position not found for ${mint}`);
      errorLogger.logError(error, 'PositionManager.closePosition');
      return false;
    }

    // Use current price from position if no exit price provided
    exitPrice = exitPrice || position.currentPrice;

    // Simulate transaction delay and price impact for closing
    const sizeToClose = position.size * position.remainingSize * portion;
    const delay = await this.transactionSimulator.simulateTransactionDelay();
    const executionPrice = this.transactionSimulator.calculatePriceImpact(
      sizeToClose,
      exitPrice,
      position.volume
    );

    const profitLossAmount = (position.getProfitLoss() / 100) * sizeToClose;
    this.wallet.updateBalance(sizeToClose + profitLossAmount);
    this.wallet.recordTrade(profitLossAmount > 0 ? 1 : -1);

    if (portion === 1.0) {
      if (profitLossAmount > 0) this.wins++;
      else if (profitLossAmount < 0) this.losses++;
      
      position.close(executionPrice);
      const closedPosition = this.stateManager.closePosition(mint);
      if (!closedPosition) {
        const error = new Error(`Failed to close position for ${mint}`);
        errorLogger.logError(error, 'PositionManager.closePosition');
        return false;
      }

      // Emit trade event for closing position
      this.emit('trade', {
        type: 'SELL',
        mint,
        profitLoss: position.getProfitLoss(),
        symbol: position.symbol,
        size: sizeToClose,
        price: executionPrice,
        timestamp: Date.now()
      });

      return true;
    } else {
      position.recordPartialExit(portion, executionPrice);
      
      // Emit trade event for partial exit
      this.emit('trade', {
        type: 'PARTIAL_SELL',
        mint,
        profitLoss: position.getProfitLoss(),
        symbol: position.symbol,
        size: sizeToClose,
        price: executionPrice,
        portion,
        timestamp: Date.now()
      });

      return true;
    }
  }

  async increasePosition(mint, additionalSize) {
    const position = this.getPosition(mint);
    if (!position || this.wallet.balance < additionalSize) return false;

    // Simulate transaction for position increase
    const delay = await this.transactionSimulator.simulateTransactionDelay();
    const executionPrice = this.transactionSimulator.calculatePriceImpact(
      additionalSize,
      position.currentPrice * (position.size + additionalSize),
      position.volume
    );

    // Update position size and cost basis
    const newTotalSize = position.size + additionalSize;
    const newCostBasis = ((position.size * position.entryPrice) + (additionalSize * executionPrice)) / newTotalSize;
    
    position.size = newTotalSize;
    position.entryPrice = newCostBasis;
    this.wallet.updateBalance(-additionalSize);

    // Emit trade event for position increase
    this.emit('trade', {
      type: 'INCREASE',
      mint,
      profitLoss: position.getProfitLoss(),
      symbol: position.symbol,
      size: additionalSize,
      price: executionPrice,
      timestamp: Date.now()
    });

    return true;
  }

  updatePosition(mint, currentPrice, volumeData = null, candleData = null) {
    const position = this.getPosition(mint);
    if (!position) return null;

    position.update(currentPrice, volumeData, candleData);
    return position;
  }

  getPosition(mint) {
    return this.stateManager.getPosition(mint);
  }

  getPositions() {
    return this.stateManager.getAllPositions();
  }

  getTotalValue() {
    return this.getPositions().reduce((total, position) => {
      return total + (position.currentPrice * position.size);
    }, 0);
  }

  getTotalProfitLoss() {
    const positions = this.getPositions();
    if (positions.length === 0) return 0;
    
    return positions.reduce((total, position) => {
      return total + position.getProfitLoss();
    }, 0) / positions.length; // Average PnL across all positions
  }

  calculatePositionSize(baseSize) {
    // Implement dynamic position sizing based on wallet balance and risk
    const walletBalance = this.wallet.getBalance();
    const maxRiskPerTrade = config.RISK.MAX_RISK_PER_TRADE;
    const riskAdjustedSize = Math.min(baseSize, walletBalance * maxRiskPerTrade);
    
    return riskAdjustedSize;
  }

  increasePosition(mint, additionalSize) {
    const position = this.getPosition(mint);
    if (!position) return;

    const currentSize = position.size;
    const maxIncrease = currentSize * config.POSITION.MAX_INCREASE_MULTIPLIER;
    const safeSize = Math.min(additionalSize, maxIncrease);

    position.increaseSize(safeSize);
    this.emit('positionIncreased', { mint, additionalSize: safeSize });
  }

  validatePositions() {
    const positions = this.getPositions();
    positions.forEach(position => {
      try {
        // Check if position meets current safety criteria
        if (!this.meetsCurrentCriteria(position)) {
          this.considerExit(position);
        }

        // Validate position state and recovery metrics
        if (position.recoveryMetrics) {
          this.validateRecoveryMetrics(position);
        }
      } catch (error) {
        errorLogger.logError(error, 'Position Validation', { position });
      }
    });
  }

  meetsCurrentCriteria(position) {
    // Implement position validation logic
    const minVolume = config.SAFETY.MIN_VOLUME;
    const minLiquidity = config.SAFETY.MIN_LIQUIDITY;
    
    return (
      position.volume24h >= minVolume &&
      position.liquidity >= minLiquidity &&
      !position.isStale()
    );
  }

  validateRecoveryMetrics(position) {
    const metrics = position.recoveryMetrics;
    if (!metrics) return;

    // Check for deteriorating recovery conditions
    if (metrics.recoveryStrength < config.RECOVERY.MIN_STRENGTH ||
        metrics.marketStructure === 'bearish') {
      this.considerExit(position);
    }
  }

  considerExit(position) {
    const exitType = this.exitStrategies.determineExitType(position);
    if (exitType) {
      this.executeExit(position, exitType);
    }
  }

  executeExit(position, exitType) {
    try {
      const exitPrice = position.currentPrice;
      const profitLoss = position.getProfitLoss();
      
      position.close(exitType);
      this.wallet.updateBalance(position.size * exitPrice);
      
      this.emit('positionClosed', {
        token: { mint: position.mint },
        reason: exitType,
        profitLoss
      });
      
      // Update win/loss counter
      if (profitLoss > 0) {
        this.wins++;
      } else {
        this.losses++;
      }
    } catch (error) {
      errorLogger.logError(error, 'Position Exit', { position, exitType });
    }
  }

  getActivePositions() {
    return this.stateManager.getActivePositions();
  }

  getPositionStats() {
    const stats = this.stateManager.getPositionStats();
    return {
      ...stats,
      wins: this.wins,
      losses: this.losses,
      winRate: this.wins / (this.wins + this.losses) || 0
    };
  }

  calculatePositionSize(marketCap, volatility = 0) {
    let size = config.POSITION.MIN_POSITION_SIZE_SOL;
    
    // Base size calculation
    const marketCapBasedSize = marketCap * config.POSITION.POSITION_SIZE_MARKET_CAP_RATIO;
    size = Math.min(marketCapBasedSize, config.POSITION.MAX_POSITION_SIZE_SOL);
    size = Math.max(size, config.POSITION.MIN_POSITION_SIZE_SOL);

    // Apply dynamic sizing if enabled
    if (config.POSITION.USE_DYNAMIC_SIZING) {
      // Scale based on volatility
      const volatilityMultiplier = Math.max(0, 1 - (volatility * config.POSITION.VOLATILITY_SCALING_FACTOR));
      size *= volatilityMultiplier;
    }

    return size;
  }

  cleanup() {
    // Clear all intervals
    if (this._validateInterval) {
      clearInterval(this._validateInterval);
    }

    // Remove all event listeners
    this.removeAllListeners();
    
    // Clear state manager
    if (this.stateManager) {
      this.stateManager.cleanup();
    }
    
    // Reset metrics
    this.wins = 0;
    this.losses = 0;
  }
}

module.exports = PositionManager;
