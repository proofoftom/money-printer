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
  constructor(wallet, priceManager, traderManager) {
    super();
    this.wallet = wallet;
    this.priceManager = priceManager;
    this.traderManager = traderManager;
    this.positions = new Map();
    this.closedPositions = [];
    this.maxPositions = config.POSITION.MAX_POSITIONS || 3;
    this.totalProfit = 0;
    this.winRate = 0;
    this.avgHoldTime = 0;
    this.avgProfitPerTrade = 0;
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
    
    // Set up price update handler
    if (this.priceManager) {
      this.priceManager.on('priceUpdate', this.handlePriceUpdate.bind(this));
    }

    // Recovery strategy event handlers
    this.stateManager.on('recoveryAccumulation', this.handleRecoveryAccumulation.bind(this));
    this.stateManager.on('recoveryExpansion', this.handleRecoveryExpansion.bind(this));
    this.stateManager.on('recoveryDistribution', this.handleRecoveryDistribution.bind(this));

    // Periodic position validation
    this._validateInterval = setInterval(() => this.validatePositions(), 60000); // Every minute

    // Set max listeners
    this.setMaxListeners(20);
  }

  handlePositionAdded(position) {
    this.positions.set(position.mint, position);
    this.updateStats();
  }

  handlePositionUpdated(position) {
    // Just update internal state
    this.positions.set(position.mint, position);
    this.updateStats();
  }

  handlePositionClosed(position) {
    this.positions.delete(position.mint);
    this.closedPositions.push(position);
    this.updateStats();
    
    // Update wallet without re-emitting
    if (this.wallet) {
      this.wallet.recordTrade(position.profitLoss);
    }
  }

  handlePartialExit(data) {
    const { position, amount, price } = data;
    position.remainingSize -= amount;
    this.updateStats();
  }

  handleRecoveryAccumulation(position) {
    // Internal handling only
    position.recoveryPhase = 'accumulation';
  }

  handleRecoveryExpansion(position) {
    // Internal handling only
    position.recoveryPhase = 'expansion';
  }

  handleRecoveryDistribution(position) {
    // Internal handling only
    position.recoveryPhase = 'distribution';
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

    return position;
  }

  async exitPosition(position, reason = "manual") {
    const profitLoss = position.calculateProfitLoss();
    
    this.stateManager.closePosition(position.mint);
    await this.stateManager.saveState();

    return { profitLoss, reason };
  }

  async updatePosition(mint, price, volumeData = null, marketCapSol = null) {
    const position = this.positions.get(mint);
    if (!position) return null;

    position.update(price, volumeData, marketCapSol);
    return position;
  }

  async openPosition(token, size) {
    try {
      if (this.positions.size >= this.maxPositions) {
        console.warn('Maximum number of positions reached');
        return null;
      }

      const position = new Position({
        mint: token.mint,
        entryPrice: token.currentPrice,
        size,
        symbol: token.symbol,
        traderManager: this.traderManager,
        traderPublicKey: this.wallet.publicKey
      });

      // Set up position event handlers
      this.setupPositionEventHandlers(position);

      // Add to active positions
      this.positions.set(token.mint, position);

      // Open the position
      const success = await position.open();
      if (!success) {
        this.positions.delete(token.mint);
        return null;
      }

      return position;
    } catch (error) {
      console.error('Error opening position:', error);
      return null;
    }
  }

  setupPositionEventHandlers(position) {
    position.on('closed', (data) => {
      const { reason, profitLoss, exitPrice, holdTime } = data;
      
      // Update statistics
      this.updateStats(position, profitLoss, holdTime);
      
      // Move to closed positions
      this.positions.delete(position.mint);
      this.closedPositions.push({
        mint: position.mint,
        symbol: position.symbol,
        entryPrice: position.entryPrice,
        exitPrice,
        profitLoss,
        holdTime,
        size: position.size,
        closedAt: Date.now(),
        reason
      });
    });

    position.on('partialExit', (data) => {
      const { amount, price } = data;
      position.remainingSize -= amount;
      this.updateStats();
    });
  }

  updateStats(position, profitLoss, holdTime) {
    // Update total profit
    this.totalProfit += profitLoss;

    // Update win rate
    const totalTrades = this.closedPositions.length + 1;
    const winningTrades = this.closedPositions.filter(p => p.profitLoss > 0).length + (profitLoss > 0 ? 1 : 0);
    this.winRate = (winningTrades / totalTrades) * 100;

    // Update average hold time
    const totalHoldTime = this.closedPositions.reduce((sum, p) => sum + p.holdTime, 0) + holdTime;
    this.avgHoldTime = totalHoldTime / totalTrades;

    // Update average profit per trade
    const totalProfit = this.closedPositions.reduce((sum, p) => sum + p.profitLoss, 0) + profitLoss;
    this.avgProfitPerTrade = totalProfit / totalTrades;
  }

  async closePosition(mint, exitPrice = null, portion = 1.0) {
    const position = this.positions.get(mint);
    if (!position) return false;

    const success = await position.close();
    if (success) {
      this.positions.delete(mint);
      return true;
    }
    return false;
  }

  async validatePositions() {
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

  increasePosition(mint, additionalSize) {
    const position = this.getPosition(mint);
    if (!position) return;

    const currentSize = position.size;
    const maxIncrease = currentSize * config.POSITION.MAX_INCREASE_MULTIPLIER;
    const safeSize = Math.min(additionalSize, maxIncrease);

    position.increaseSize(safeSize);
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

  handlePriceUpdate({ newPrice, oldPrice, percentChange }) {
    // Update all position valuations
    for (const position of this.positions.values()) {
      const oldValue = position.currentValue;
      position.currentValue = this.priceManager.solToUSD(position.size * position.currentPrice);
      
      // Check if price change triggers any exit conditions
      if (Math.abs(percentChange) > config.POSITION.PRICE_IMPACT_THRESHOLD) {
        this.evaluateExitConditions(position, {
          priceChangePercent: percentChange,
          valueChange: (position.currentValue - oldValue) / oldValue
        });
      }
    }
  }

  evaluateExitConditions(position, metrics) {
    const { priceChangePercent, valueChange } = metrics;
    
    // Check stop loss
    if (valueChange <= -config.POSITION.STOP_LOSS_THRESHOLD) {
      this.closePosition(position.mint, position.currentPrice, 'stop_loss');
      return;
    }
    
    // Check trailing stop
    if (position.highValue && valueChange <= -(position.highValue - position.currentValue) / position.highValue) {
      this.closePosition(position.mint, position.currentPrice, 'trailing_stop');
      return;
    }
    
    // Check take profit
    if (valueChange >= config.POSITION.TAKE_PROFIT_THRESHOLD) {
      this.closePosition(position.mint, position.currentPrice, 'take_profit');
      return;
    }
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
