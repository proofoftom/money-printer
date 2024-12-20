const EventEmitter = require("events");
const ExitStrategies = require("./ExitStrategies");
const Position = require("./Position");
const winston = require('winston');

class PositionManager extends EventEmitter {
  constructor(wallet, priceManager, config) {
    super();
    this.wallet = wallet;
    this.priceManager = priceManager;
    this.config = config;
    this.exitStrategies = new ExitStrategies();
    this.positions = new Map();
    this.isTrading = true;

    // Initialize logger
    this.logger = winston.createLogger({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({ 
          filename: 'logs/positions.log',
          level: 'info'
        })
      ]
    });
  }

  pauseTrading() {
    this.isTrading = false;
    this.emit('tradingPaused');
  }

  resumeTrading() {
    this.isTrading = true;
    this.emit('tradingResumed');
  }

  isTradingEnabled() {
    return this.isTrading;
  }

  openPosition(token) {
    if (!this.isTrading) {
      this.logger.info('Trading paused, skipping position', {
        action: 'skip_position',
        symbol: token.symbol,
        mint: token.mint
      });
      return false;
    }
    
    if (this.positions.has(token.mint)) {
      this.logger.info('Position already exists', {
        action: 'skip_position',
        symbol: token.symbol,
        mint: token.mint
      });
      return false;
    }

    const size = this.calculatePositionSize(token);
    const currentPrice = token.getCurrentPrice();
    
    this.logger.info('Opening position', {
      action: 'open_position',
      symbol: token.symbol,
      mint: token.mint,
      metrics: {
        timeFromCreation: Date.now() - token.createdAt,
        currentPrice: currentPrice,
        positionSize: size,
        marketCapSol: token.marketCapSol,
        priceVelocity: token.getPriceVelocity(),
        volume: token.getVolumeSinceCreation(),
        tradeCount: token.getTradeCount()
      }
    });

    const position = new Position(token, this.priceManager, {
      takeProfitLevel: this.config.TAKE_PROFIT_PERCENT,
      stopLossLevel: this.config.STOP_LOSS_PERCENT
    });

    position.on('updated', (state) => {
      this.logger.debug('Position updated', {
        action: 'position_update',
        symbol: token.symbol,
        mint: token.mint,
        metrics: {
          currentPrice: state.currentPrice,
          priceVelocity: state.priceVelocity,
          unrealizedPnL: state.unrealizedPnLSol,
          roiPercentage: state.roiPercentage,
          volume: state.volumeSinceCreation,
          tradeCount: state.tradeCountSinceCreation
        }
      });
    });

    position.open(currentPrice, size);
    this.positions.set(token.mint, position);

    this.emit("positionOpened", { token, position });
    
    console.log(`Successfully opened position for ${token.symbol}`);
    return true;
  }

  updatePosition(token) {
    const position = this.positions.get(token.mint);
    if (!position) return;

    position.updatePrice(token.getCurrentPrice());
    
    const exitSignal = this.exitStrategies.checkExitSignals(position);
    if (exitSignal) {
      this.logger.info('Exit signal triggered', {
        action: 'exit_signal',
        symbol: token.symbol,
        mint: token.mint,
        reason: exitSignal.reason,
        metrics: {
          currentPrice: position.currentPrice,
          entryPrice: position.entryPrice,
          roiPercentage: position.roiPercentage,
          timeHeld: Date.now() - position.openedAt
        }
      });
      this.closePosition(token.mint, exitSignal.reason);
    }

    this.emit("positionUpdated", position);
  }

  closePosition(mint, reason) {
    const position = this.positions.get(mint);
    if (!position) return;

    const finalState = position.getState();
    this.logger.info('Closing position', {
      action: 'close_position',
      symbol: position.symbol,
      mint: position.mint,
      reason: reason,
      metrics: {
        timeToEntry: finalState.timeToEntry,
        timeHeld: Date.now() - position.openedAt,
        entryPrice: position.entryPrice,
        exitPrice: position.currentPrice,
        initialPumpPeak: finalState.initialPumpPeak,
        timeToPumpPeak: finalState.timeToPumpPeak,
        finalPriceVelocity: finalState.priceVelocity,
        totalVolume: finalState.volumeSinceCreation,
        totalTrades: finalState.tradeCountSinceCreation,
        executionSlippage: finalState.executionSlippage,
        realizedPnL: finalState.realizedPnLSol,
        roiPercentage: finalState.roiPercentage
      }
    });

    position.close(position.currentPrice, reason);
    this.positions.delete(mint);
    this.emit("positionClosed", { position, reason });

    // Return the closed position for reference
    return position;
  }

  getPosition(mint) {
    return this.positions.get(mint);
  }

  calculatePositionSize(token) {
    const walletBalance = this.wallet.getBalance();
    const riskAmount = walletBalance * this.config.RISK_PER_TRADE;
    return Math.min(riskAmount, token.marketCapSol * this.config.MAX_MCAP_POSITION);
  }

  emergencyCloseAll() {
    for (const [mint] of this.positions) {
      this.closePosition(mint, 'emergency');
    }
    this.pauseTrading();
    this.emit('emergencyStop');
  }

  getAllPositions() {
    return Array.from(this.positions.values());
  }
}

module.exports = PositionManager;
