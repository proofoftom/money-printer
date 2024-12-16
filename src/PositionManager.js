// PositionManager component
const EventEmitter = require("events");
const Wallet = require("./Wallet");
const config = require("./config");
const ExitStrategies = require("./ExitStrategies");
const TransactionSimulator = require("./TransactionSimulator");
const PositionStateManager = require("./PositionStateManager");
const Position = require("./Position");

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
    const pl = position.getProfitLoss().percentage;
    console.log(`
Position Updated:
- Mint: ${position.mint}
- Current Price: ${position.currentPrice} SOL
- P/L: ${pl.toFixed(2)}%
- Max Upside: ${position.maxUpside.toFixed(2)}%
- Max Drawdown: ${position.maxDrawdown.toFixed(2)}%
    `);
  }

  handlePositionClosed(position) {
    const pl = position.getProfitLoss().percentage;
    console.log(`
Position Closed:
- Mint: ${position.mint}
- Final P/L: ${pl.toFixed(2)}%
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
        size: positionSize,
        simulatedDelay: delay
      });

      this.stateManager.addPosition(position);
      this.wallet.updateBalance(-positionSize);

      // Emit trade event for opening position
      this.emit('trade', {
        type: 'BUY',
        mint,
        profitLoss: 0,
        symbol: position.symbol || mint.slice(0, 8),
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
      position.volumeHistory[position.volumeHistory.length - 1]?.volume || 0
    );

    position.updatePrice(executionPrice);
    const { percentage: profitLoss, amount: profitLossAmount } = position.getProfitLoss();
    
    this.wallet.updateBalance(sizeToClose + profitLossAmount);
    this.wallet.recordTrade(profitLoss > 0 ? 1 : -1);

    // Emit trade event with complete information
    this.emit('trade', {
      type: portion === 1.0 ? 'CLOSE' : 'PARTIAL',
      mint,
      profitLoss,
      symbol: position.symbol || mint.slice(0, 8),
      timestamp: Date.now()
    });

    if (portion === 1.0) {
      if (profitLoss > 0) this.wins++;
      else if (profitLoss < 0) this.losses++;
      
      position.close();
      return this.stateManager.closePosition(mint);
    } else {
      position.recordPartialExit({
        portion,
        remainingSize: position.remainingSize - portion,
        exitPrice: executionPrice,
        profitLoss
      });
      return this.stateManager.updatePosition(mint, position);
    }
  }

  updatePosition(mint, currentPrice, volumeData = null, candleData = null) {
    const position = this.stateManager.getPosition(mint);
    if (!position) return null;

    position.update({
      currentPrice,
      volumeData,
      candleData
    });

    return this.stateManager.updatePosition(mint, position);
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
    const positions = this.getActivePositions();
    positions.forEach(position => {
      if (position.isStale()) {
        console.warn(`Position ${position.mint} is stale, closing...`);
        this.closePosition(position.mint);
      }
    });
  }
}

module.exports = PositionManager;
