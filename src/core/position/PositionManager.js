// PositionManager component
const EventEmitter = require('events');
const Position = require('./Position');
const config = require('../../utils/config');
const Wallet = require('../../utils/Wallet');
const ExitStrategies = require('./ExitStrategies');
const TransactionSimulator = require('../../utils/TransactionSimulator');
const PositionStateManager = require('./PositionStateManager');

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

    // Periodic position validation
    setInterval(() => this.validatePositions(), 60000); // Every minute
  }

  handlePositionAdded(position) {
    console.log(`
New Position Added:
- Mint: ${position.mint}
- Entry Price: ${position.entryPrice} SOL
- Size: ${position.size} SOL
- Entry Time: ${new Date(position.entryTime).toISOString()}
    `);
  }

  handlePositionUpdated(position) {
    console.log(`
Position Updated:
- Mint: ${position.mint}
- Current Price: ${position.currentPrice} SOL
- P/L: ${position.getProfitLoss().toFixed(2)}%
- Max Upside: ${position.maxUpside.toFixed(2)}%
- Max Drawdown: ${position.maxDrawdown.toFixed(2)}%
    `);
  }

  handlePositionClosed(position) {
    console.log(`
Position Closed:
- Mint: ${position.mint}
- Final P/L: ${position.getProfitLoss().toFixed(2)}%
- Hold Time: ${Math.round((position.closedAt - position.entryTime) / 1000)}s
    `);
  }

  handlePartialExit(position) {
    console.log(`
Partial Exit:
- Mint: ${position.mint}
- Remaining Size: ${(position.remainingSize * 100).toFixed(2)}%
- Partial Exits: ${position.partialExits.length}
    `);
  }

  async openPosition(mint, marketCap, volatility = 0) {
    const positionSize = this.calculatePositionSize(marketCap, volatility);
    
    if (this.wallet.balance >= positionSize) {
      // Simulate transaction delay and price impact
      const delay = await this.transactionSimulator.simulateTransactionDelay();
      const executionPrice = this.transactionSimulator.calculatePriceImpact(
        positionSize,
        marketCap,
        0
      );

      const position = new Position({
        mint,
        entryPrice: executionPrice,
        size: positionSize
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
        mint,
        profitLoss: 0,
        symbol: position.symbol,
        timestamp: Date.now()
      });

      return true;
    }
    return false;
  }

  async closePosition(mint, exitPrice, portion = 1.0) {
    const position = this.stateManager.getPosition(mint);
    if (!position) {
      console.error(`Cannot close position: Position not found for ${mint}`);
      return null;
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
        console.error(`Failed to close position for ${mint}`);
        return null;
      }
      return closedPosition;
    } else {
      position.recordPartialExit(portion, executionPrice);
      return position;
    }
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

  validatePositions() {
    const invalidPositions = this.stateManager.validatePositions();
    
    if (invalidPositions.length > 0) {
      console.warn(`Found ${invalidPositions.length} invalid positions:`);
      
      for (const { mint, reason, position } of invalidPositions) {
        console.warn(`- ${mint}: ${reason}`);
        
        // Auto-close stale positions
        if (reason === 'stale') {
          console.warn(`Auto-closing stale position for ${mint}`);
          this.closePosition(mint, position.currentPrice);
        }
      }
    }
  }
}

module.exports = PositionManager;
