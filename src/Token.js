const { EventEmitter } = require("events");

const STATES = {
  NEW: "NEW",
  READY: "READY",
  UNSAFE: "UNSAFE",
  DEAD: "DEAD",
};

class Token extends EventEmitter {
  constructor(tokenData, { priceManager, safetyChecker, logger, config }) {
    super();
    this.mint = tokenData.mint;
    this.name = tokenData.name;
    this.symbol = tokenData.symbol;
    this.createdAt = Date.now();
    this.minted = tokenData.minted;
    this.traderPublicKey = tokenData.traderPublicKey;
    this.bondingCurveKey = tokenData.bondingCurveKey;
    this.vTokensInBondingCurve = tokenData.vTokensInBondingCurve;
    this.vSolInBondingCurve = tokenData.vSolInBondingCurve;
    this.marketCapSol = tokenData.marketCapSol;
    this.totalSupplyOutsideCurve = 0;
    this.holders = new Map();

    // Price tracking
    this.currentPrice = this.calculateTokenPrice();
    this.initialPrice = this.currentPrice;
    this.highestPrice = this.currentPrice;
    this.highestPriceTime = Date.now();
    this.highestMarketCap = this.marketCapSol;
    this.priceHistory = [];

    // Trade tracking
    this.volume = 0;
    this.tradeCount = 0;
    this.lastTradeType = null;
    this.lastTradeAmount = null;
    this.lastTradeTime = null;

    // Dependencies
    this.priceManager = priceManager;
    this.safetyChecker = safetyChecker;
    this.logger = logger;
    this.config = config;

    // State
    this.state = STATES.NEW;

    // Start safety checks
    this.safetyCheckInterval = setInterval(
      () => this.checkSafetyConditions(),
      this.config.SAFETY_CHECK_INTERVAL
    );
  }

  calculateTokenPrice() {
    if (this.vTokensInBondingCurve === 0) return 0;
    return this.vSolInBondingCurve / this.vTokensInBondingCurve;
  }

  update(tradeData) {
    // Update trade metrics
    this.lastTradeType = tradeData.txType;
    this.lastTradeAmount = tradeData.tokenAmount;
    this.lastTradeTime = Date.now();
    this.volume += tradeData.tokenAmount;
    this.tradeCount++;

    // Update market metrics
    this.vTokensInBondingCurve = tradeData.vTokensInBondingCurve;
    this.vSolInBondingCurve = tradeData.vSolInBondingCurve;
    this.marketCapSol = tradeData.marketCapSol;

    // Update price metrics
    this.currentPrice = this.calculateTokenPrice();
    if (this.currentPrice > this.highestPrice) {
      this.highestPrice = this.currentPrice;
      this.highestPriceTime = Date.now();
    }
    if (this.marketCapSol > this.highestMarketCap) {
      this.highestMarketCap = this.marketCapSol;
    }

    // Add to price history
    this.priceHistory.push({
      price: this.currentPrice,
      marketCapSol: this.marketCapSol,
      timestamp: Date.now(),
    });

    this.emit("updated", this);
  }

  checkSafetyConditions() {
    const { safe, reasons } = this.safetyChecker.isTokenSafe(this);
    const previousState = this.state;

    if (safe && this.state === STATES.NEW) {
      this.state = STATES.READY;
    } else if (!safe && this.state !== STATES.DEAD) {
      this.state = STATES.UNSAFE;
    }

    // Check for dead state based on drawdown
    if (this.getDrawdownPercentage() >= 90) {
      this.state = STATES.DEAD;
    }

    if (this.state !== previousState) {
      this.emit("stateChanged", {
        from: previousState,
        to: this.state,
        token: this,
      });

      if (this.state === STATES.READY) {
        this.emit("readyForPosition", { token: this });
      }
    }
  }

  getDrawdownPercentage() {
    if (this.highestMarketCap === 0) return 0;
    return (
      ((this.highestMarketCap - this.marketCapSol) / this.highestMarketCap) *
      100
    );
  }

  cleanup() {
    if (this.safetyCheckInterval) {
      clearInterval(this.safetyCheckInterval);
    }
  }
}

module.exports = { Token, STATES };
