const EventEmitter = require("events");
const config = require("./config");
const ExitStrategies = require("./ExitStrategies");
const PositionStateManager = require("./PositionStateManager");

class PositionManager extends EventEmitter {
  constructor(wallet, priceManager) {
    super();
    this.wallet = wallet;
    this.priceManager = priceManager;
    this.exitStrategies = new ExitStrategies();
    this.stateManager = new PositionStateManager();
    this.isTrading = true;
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
    // Skip if trading is paused or position already exists
    if (!this.isTrading || this.stateManager.hasPosition(token.mint)) {
      return false;
    }

    // Calculate position size based on wallet balance and risk parameters
    const position = {
      mint: token.mint,
      symbol: token.symbol,
      entryPrice: token.getCurrentPrice(),
      entryTime: Date.now(),
      size: this.calculatePositionSize(token),
      currentPrice: token.getCurrentPrice(),
      token: token
    };

    // Add position to state manager
    this.stateManager.addPosition(position);
    this.emit("positionOpened", { token, position });
    return true;
  }

  updatePosition(token) {
    const position = this.stateManager.getPosition(token.mint);
    if (!position) return;

    // Update current price
    position.currentPrice = token.getCurrentPrice();
    
    // Check exit signals
    const exitSignal = this.exitStrategies.checkExitSignals(position);
    if (exitSignal) {
      this.closePosition(token.mint, exitSignal.reason);
      return;
    }

    // Update position state
    this.stateManager.updatePosition(position);
    this.emit("positionUpdated", position);
  }

  closePosition(mint, reason) {
    const position = this.stateManager.getPosition(mint);
    if (!position) return;

    // Remove position from state manager
    this.stateManager.removePosition(mint);
    this.emit("positionClosed", { position, reason });

    // Return the closed position for reference
    return position;
  }

  getPosition(mint) {
    return this.stateManager.getPosition(mint);
  }

  calculatePositionSize(token) {
    const walletBalance = this.wallet.getBalance();
    const riskAmount = walletBalance * config.RISK_PER_TRADE;
    return Math.min(riskAmount, token.marketCapSol * config.MAX_MCAP_POSITION);
  }

  emergencyCloseAll() {
    const positions = this.stateManager.getAllPositions();
    positions.forEach(position => {
      this.closePosition(position.mint, 'emergency');
    });
    this.pauseTrading();
    this.emit('emergencyStop');
  }
}

module.exports = PositionManager;
