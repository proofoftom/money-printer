const EventEmitter = require("events");
const Position = require("./Position");

class PositionManager extends EventEmitter {
  constructor({ wallet, priceManager, logger, config, analytics }) {
    super();
    this.wallet = wallet;
    this.priceManager = priceManager;
    this.logger = logger;
    this.config = config;
    this.analytics = analytics;
    this.position = null;
    this._tradingEnabled = true;
  }

  isTradingEnabled() {
    return this._tradingEnabled;
  }

  pauseTrading() {
    this._tradingEnabled = false;
    this.logger?.info("Trading paused");
  }

  resumeTrading() {
    this._tradingEnabled = true;
    this.logger?.info("Trading resumed");
  }

  calculatePositionSize(token) {
    const walletBalance = this.wallet.getBalance();
    const maxRiskAmount = walletBalance * this.config.RISK_PER_TRADE;
    const maxMcapAmount = token.marketCapSol * this.config.MAX_MCAP_POSITION;
    return Math.min(maxRiskAmount, maxMcapAmount);
  }

  openPosition(token) {
    if (!this.isTradingEnabled()) {
      this.logger?.info("Trading is disabled, cannot open position");
      return null;
    }

    if (this.position && this.position.state !== Position.STATES.CLOSED) {
      this.logger?.info(`Active position exists for ${this.position.symbol}`);
      return null;
    }

    try {
      const position = new Position(token, this.priceManager, this.wallet, {
        takeProfitLevel: this.config.TAKE_PROFIT_PERCENT,
        stopLossLevel: this.config.STOP_LOSS_PERCENT
      });

      const size = this.calculatePositionSize(token);
      position.size = size;
      
      // Open the position
      const success = position.open();
      if (!success) {
        return null;
      }

      this.position = position;
      this.emit("positionOpened", { position, token });
      return position;
    } catch (error) {
      this.logger?.error("Failed to open position:", error);
      if (this.analytics) {
        this.analytics.trackError('trading');
      }
      return null;
    }
  }

  closePosition(reason = "manual") {
    if (!this.position || this.position.state === Position.STATES.CLOSED) {
      return false;
    }

    try {
      const success = this.position.close(reason);
      if (success) {
        this.emit("positionClosed", { position: this.position, reason });
        if (this.analytics) {
          this.analytics.trackTrade(this.position);
        }
      }
      return success;
    } catch (error) {
      this.logger?.error("Failed to close position:", error);
      if (this.analytics) {
        this.analytics.trackError('trading');
      }
      return false;
    }
  }

  closeAllPositions(reason = "emergency") {
    if (!this.position) {
      return true;
    }
    return this.closePosition(reason);
  }

  updatePositions() {
    if (!this.position || this.position.state === Position.STATES.CLOSED) {
      return;
    }

    try {
      this.position.update();
    } catch (error) {
      this.logger?.error("Failed to update position:", error);
    }
  }
}

module.exports = PositionManager;
