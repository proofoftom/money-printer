const EventEmitter = require('events');
const Position = require('./Position');

class PositionManager extends EventEmitter {
  constructor(priceManager, wallet, config = {}) {
    super();
    
    this.priceManager = priceManager;
    this.wallet = wallet;
    this.positions = new Map();
    this.tradingEnabled = true;
    
    // Default config
    this.config = {
      RISK_PER_TRADE: 0.01, // 1% of wallet per trade
      MAX_MCAP_POSITION: 0.001, // 0.1% of market cap
      STOP_LOSS_LEVEL: 0.1, // 10% stop loss
      TAKE_PROFIT_LEVEL: 0.5, // 50% take profit
      TRAILING_STOP_LEVEL: 0.2, // 20% trailing stop
      ...config
    };
    
    this.logger = {
      info: console.log,
      warn: console.warn,
      error: console.error
    };
  }

  isTradingEnabled() {
    return this.tradingEnabled;
  }

  pauseTrading() {
    this.tradingEnabled = false;
    this.emit('tradingPaused');
  }

  resumeTrading() {
    this.tradingEnabled = true;
    this.emit('tradingResumed');
  }

  calculatePositionSize(token) {
    const walletBalance = this.wallet.getBalance();
    const maxRiskAmount = walletBalance * this.config.RISK_PER_TRADE;
    const maxMcapAmount = token.marketCapSol * this.config.MAX_MCAP_POSITION;
    return Math.min(maxRiskAmount, maxMcapAmount);
  }

  async openPosition(token, positionSize) {
    try {
      if (!this.tradingEnabled) {
        this.logger.info("Trading is disabled, cannot open position");
        return null;
      }

      if (this.positions.has(token.mint)) {
        throw new Error('Position already exists for this token');
      }

      const size = positionSize || this.calculatePositionSize(token);
      if (!this.wallet.canAffordTrade(size)) {
        this.logger.warn("Insufficient funds for position");
        return null;
      }

      const position = new Position(token, this.priceManager, this.wallet, {
        ...this.config,
        token  // Pass token reference for OHLCV data
      });
      
      // Open the position
      await position.open(token.getCurrentPrice(), size);
      
      this.positions.set(token.mint, position);
      this.emit("positionOpened", { position, token });
      
      // Subscribe to position updates
      position.on('updated', (state) => {
        this.emit('positionUpdated', { mint: token.mint, state });
      });
      
      position.on('closed', (state) => {
        this.positions.delete(token.mint);
        this.emit('positionClosed', { mint: token.mint, state });
      });
      
      return position;
    } catch (error) {
      this.logger.error("Failed to open position", {
        symbol: token.symbol,
        error: error.message,
      });
      throw error;
    }
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
        this.logger.error('Failed to update position', {
          mint,
          error: error.message
        });
      }
    }
  }

  async emergencyCloseAll() {
    const promises = [];
    for (const [mint, position] of this.positions.entries()) {
      promises.push(position.close(position.currentPrice, 'emergency'));
    }
    await Promise.all(promises);
    this.positions.clear();
    this.emit('emergencyStop');
  }
}

module.exports = PositionManager;
