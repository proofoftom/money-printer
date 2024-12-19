const EventEmitter = require("events");
const ExitStrategies = require("./ExitStrategies");
const Position = require("./Position");

class PositionManager extends EventEmitter {
  constructor(wallet, priceManager, config) {
    super();
    this.wallet = wallet;
    this.priceManager = priceManager;
    this.config = config;
    this.exitStrategies = new ExitStrategies();
    this.positions = new Map();
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
    if (!this.isTrading) {
      console.log(`Trading is paused, skipping position for ${token.symbol}`);
      return false;
    }
    
    if (this.positions.has(token.mint)) {
      console.log(`Position already exists for ${token.symbol}`);
      return false;
    }

    // Calculate position size based on wallet balance and risk parameters
    const size = this.calculatePositionSize(token);
    const currentPrice = token.getCurrentPrice();
    
    console.log(`Opening position for ${token.symbol}:
      Size: ${size.toFixed(4)} SOL
      Current Price: ${currentPrice.toFixed(6)} SOL
      Market Cap: ${token.marketCapSol.toFixed(4)} SOL
    `);

    // Create new position
    const position = new Position(token, this.priceManager, {
      takeProfitLevel: this.config.TAKE_PROFIT_PERCENT,
      stopLossLevel: this.config.STOP_LOSS_PERCENT
    });

    // Open the position
    position.open(currentPrice, size);

    // Store position
    this.positions.set(token.mint, position);
    this.emit("positionOpened", { token, position });
    
    console.log(`Successfully opened position for ${token.symbol}`);
    return true;
  }

  updatePosition(token) {
    const position = this.positions.get(token.mint);
    if (!position) return;

    // Update position price
    position.updatePrice(token.getCurrentPrice());
    
    // Check exit signals
    const exitSignal = this.exitStrategies.checkExitSignals(position);
    if (exitSignal) {
      this.closePosition(token.mint, exitSignal.reason);
      return;
    }

    this.emit("positionUpdated", position);
  }

  closePosition(mint, reason) {
    const position = this.positions.get(mint);
    if (!position) return;

    // Close the position
    position.close(position.currentPrice, reason);

    // Clean up
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
