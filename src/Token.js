const EventEmitter = require("events");
const { TokenStateManager, STATES } = require("./TokenStateManager");

class Token extends EventEmitter {
  constructor(tokenData, { priceManager, safetyChecker }) {
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

    // Trade tracking
    this.lastTradeType = null;
    this.lastTradeAmount = null;
    this.lastTradeTime = null;
    this.tokenBalance = null;
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
    if (data.vTokensInBondingCurve !== undefined) {
      this.vTokensInBondingCurve = data.vTokensInBondingCurve;
    }
    if (data.vSolInBondingCurve !== undefined) {
      this.vSolInBondingCurve = data.vSolInBondingCurve;
    }
    if (data.marketCapSol !== undefined) {
      this.marketCapSol = data.marketCapSol;
    }
    if (data.newTokenBalance !== undefined) {
      this.tokenBalance = data.newTokenBalance;
    }

    // Track trade type
    if (data.type === 'buy' || data.type === 'sell') {
      this.lastTradeType = data.type;
      this.lastTradeAmount = data.tokenAmount;
      this.lastTradeTime = Date.now();
    }

    // Update highest market cap
    if (this.marketCapSol > this.highestMarketCap) {
      this.highestMarketCap = this.marketCapSol;
    }

    // Update current price
    const newPrice = this.calculateTokenPrice();
    if (newPrice !== this.currentPrice) {
      const oldPrice = this.currentPrice;
      this.currentPrice = newPrice;
      this.emit('priceChanged', {
        token: this,
        oldPrice,
        newPrice,
        tradeType: this.lastTradeType
      });
    }

    // Check state transitions
    this.checkState();

    // Emit update event
    this.emit('updated', {
      token: this,
      tradeType: data.type,
      tradeAmount: data.tokenAmount
    });
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
