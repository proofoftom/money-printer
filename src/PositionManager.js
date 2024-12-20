const EventEmitter = require('events');

class PositionManager extends EventEmitter {
  constructor({ wallet, priceManager, logger, config }) {
    super();
    this.wallet = wallet;
    this.priceManager = priceManager;
    this.logger = logger;
    this.config = config;
    this.positions = new Map();
    this.tradingEnabled = true;
  }

  openPosition(token) {
    if (!this.tradingEnabled) {
      this.logger.info('Trading is disabled, cannot open position');
      return null;
    }

    if (this.positions.has(token.mint)) {
      this.logger.info(`Position already exists for ${token.symbol}`);
      return null;
    }

    try {
      const walletBalance = this.wallet.getBalance();
      const maxRiskAmount = walletBalance * this.config.RISK_PER_TRADE;
      const maxMcapAmount = token.marketCapSol * this.config.MAX_MCAP_POSITION;
      const positionSize = Math.min(maxRiskAmount, maxMcapAmount);

      if (!this.wallet.canAffordTrade(positionSize)) {
        this.logger.warn('Insufficient funds for position');
        return null;
      }

      const position = {
        mint: token.mint,
        symbol: token.symbol,
        size: positionSize,
        entryPrice: token.currentPrice,
        currentPrice: token.currentPrice,
        openTime: Date.now()
      };

      this.positions.set(token.mint, position);
      this.emit('positionOpened', { position, token });

      return position;
    } catch (error) {
      this.logger.error('Failed to open position:', error);
      return null;
    }
  }

  closePosition(mint, reason = '') {
    const position = this.positions.get(mint);
    if (!position) return false;

    try {
      this.positions.delete(mint);
      this.emit('positionClosed', { position, reason });
      this.logger.info(`Closed position for ${position.symbol}: ${reason}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to close position:', error);
      return false;
    }
  }

  updatePositions() {
    for (const [mint, position] of this.positions) {
      // Get the token from the position itself since we store it there
      const token = position;
      if (!token) continue;

      const priceChange = (token.currentPrice - position.entryPrice) / position.entryPrice * 100;

      // Check stop loss
      if (priceChange <= -this.config.STOP_LOSS_PERCENT) {
        this.closePosition(mint, 'Stop loss triggered');
        continue;
      }

      // Check take profit
      if (priceChange >= this.config.TAKE_PROFIT_PERCENT) {
        this.closePosition(mint, 'Take profit triggered');
        continue;
      }

      // Update trailing stop if enabled
      if (this.config.TRAILING_STOP_PERCENT && priceChange > 0) {
        const trailingStopPrice = token.currentPrice * (1 - this.config.TRAILING_STOP_PERCENT / 100);
        if (token.currentPrice <= trailingStopPrice) {
          this.closePosition(mint, 'Trailing stop triggered');
        }
      }
    }
  }

  async emergencyCloseAll() {
    this.tradingEnabled = false;
    const closedPositions = [];

    for (const [mint] of this.positions) {
      if (this.closePosition(mint, 'Emergency close')) {
        closedPositions.push(mint);
      }
    }

    this.emit('emergencyClose', { closedPositions });
    return closedPositions;
  }

  getActivePositions() {
    return Array.from(this.positions.values());
  }

  getPosition(tokenMint) {
    return this.positions.get(tokenMint);
  }
}

module.exports = PositionManager;
