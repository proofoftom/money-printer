const EventEmitter = require("events");

class Token extends EventEmitter {
  constructor(tokenData) {
    super();
    // Token identification
    this.mint = tokenData.mint;
    this.name = tokenData.name;
    this.symbol = tokenData.symbol;
    this.uri = tokenData.uri;

    // Creator information
    this.creator = tokenData.traderPublicKey;
    this.initialBuy = tokenData.initialBuy;

    // Market data
    this.vTokensInBondingCurve = tokenData.vTokensInBondingCurve;
    this.vSolInBondingCurve = tokenData.vSolInBondingCurve;
    this.marketCapSol = tokenData.marketCapSol;
    
    // State tracking
    this.state = "new";
    this.highestMarketCap = tokenData.marketCapSol;
    this.drawdownLow = tokenData.marketCapSol;
    this.lastUpdate = Date.now();

    // Creation metadata
    this.createdAt = Date.now();
    this.signature = tokenData.signature;
    this.bondingCurveKey = tokenData.bondingCurveKey;
  }

  update(tradeData) {
    // Update market data
    this.vTokensInBondingCurve = tradeData.vTokensInBondingCurve;
    this.vSolInBondingCurve = tradeData.vSolInBondingCurve;
    this.marketCapSol = tradeData.marketCapSol;
    
    // Update tracking metrics
    if (this.marketCapSol > this.highestMarketCap) {
      this.highestMarketCap = this.marketCapSol;
    }
    
    // Update drawdown low if in drawdown state
    if (this.state === "drawdown" && this.marketCapSol < this.drawdownLow) {
      this.drawdownLow = this.marketCapSol;
    }
    
    this.lastUpdate = Date.now();
    this.emit("updated", this);
  }

  setState(newState) {
    const oldState = this.state;
    this.state = newState;
    
    // Reset tracking metrics based on state transition
    if (newState === "drawdown") {
      this.drawdownLow = this.marketCapSol;
    }
    
    this.emit("stateChanged", { token: this, from: oldState, to: newState });
  }

  getDrawdownPercentage() {
    return ((this.highestMarketCap - this.marketCapSol) / this.highestMarketCap) * 100;
  }

  getRecoveryPercentage() {
    if (this.state !== "drawdown") return 0;
    return ((this.marketCapSol - this.drawdownLow) / this.drawdownLow) * 100;
  }

  isHeatingUp(threshold) {
    return this.marketCapSol >= threshold;
  }

  isFirstPump(threshold) {
    return this.marketCapSol >= threshold;
  }

  isDead(threshold) {
    return this.marketCapSol <= threshold;
  }
}

module.exports = Token;
