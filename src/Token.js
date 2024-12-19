const EventEmitter = require("events");
const { TokenStateManager, STATES } = require("./TokenStateManager");

class Token extends EventEmitter {
  constructor(tokenData, priceManager, safetyChecker) {
    super();
    // Essential token properties
    this.mint = tokenData.mint;
    this.name = tokenData.name;
    this.symbol = tokenData.symbol;
    this.minted = tokenData.minted || Date.now();
    this.traderPublicKey = tokenData.traderPublicKey;
    this.vTokensInBondingCurve = tokenData.vTokensInBondingCurve;
    this.vSolInBondingCurve = tokenData.vSolInBondingCurve;
    this.marketCapSol = tokenData.marketCapSol;
    this.bondingCurveKey = tokenData.bondingCurveKey;
    
    // Core dependencies
    this.priceManager = priceManager;
    this.safetyChecker = safetyChecker;

    // State management
    this.stateManager = new TokenStateManager();
    this.highestMarketCap = this.marketCapSol;

    // Price tracking
    this.currentPrice = this.calculateTokenPrice();
    this.initialPrice = this.currentPrice;
  }

  calculateTokenPrice() {
    if (!this.vTokensInBondingCurve || this.vTokensInBondingCurve === 0) {
      return 0;
    }
    return this.vSolInBondingCurve / this.vTokensInBondingCurve;
  }

  getCurrentPrice() {
    return this.calculateTokenPrice();
  }

  getDrawdownPercentage() {
    if (this.highestMarketCap === 0) return 0;
    return ((this.highestMarketCap - this.marketCapSol) / this.highestMarketCap) * 100;
  }

  update(data) {
    // Update core token data
    this.vTokensInBondingCurve = data.vTokensInBondingCurve;
    this.vSolInBondingCurve = data.vSolInBondingCurve;
    this.marketCapSol = data.marketCapSol;

    // Update highest market cap
    if (this.marketCapSol > this.highestMarketCap) {
      this.highestMarketCap = this.marketCapSol;
    }

    // Update current price
    this.currentPrice = this.calculateTokenPrice();

    // Check state transitions
    this.checkState();
  }

  checkState() {
    const currentState = this.stateManager.getCurrentState();
    
    // Check for dead state (20% drawdown from peak)
    if (this.getDrawdownPercentage() >= 20 && currentState !== STATES.DEAD) {
      this.stateManager.transitionTo(STATES.DEAD);
      this.emit("stateChanged", {
        token: this,
        from: currentState,
        to: STATES.DEAD
      });
      return;
    }

    // Check for ready state
    if (this.safetyChecker.isTokenSafe(this) && currentState === STATES.NEW) {
      this.stateManager.transitionTo(STATES.READY);
      this.emit("stateChanged", {
        token: this,
        from: currentState,
        to: STATES.READY
      });
      this.emit("readyForPosition", { token: this });
    }
  }
}

module.exports = Token;
