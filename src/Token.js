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
    this.creatorInitialHoldings = tokenData.initialBuy || 0;

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

    // Holder tracking
    this.holders = new Map();
    if (tokenData.traderPublicKey) {
      // If newTokenBalance is provided, use that
      if (tokenData.newTokenBalance !== undefined) {
        this.updateHolder(tokenData.traderPublicKey, tokenData.newTokenBalance);
      }
      // Otherwise use initialBuy amount
      else if (tokenData.initialBuy) {
        this.updateHolder(tokenData.traderPublicKey, tokenData.initialBuy);
      }
    }
  }

  updateHolder(publicKey, balance) {
    if (balance > 0) {
      this.holders.set(publicKey, balance);
    } else {
      this.holders.delete(publicKey);
    }
  }

  getHolderCount() {
    return this.holders.size;
  }

  getTotalTokensHeld() {
    return Array.from(this.holders.values()).reduce((sum, balance) => sum + balance, 0);
  }

  update(tradeData) {
    // Update market data
    this.vTokensInBondingCurve = tradeData.vTokensInBondingCurve;
    this.vSolInBondingCurve = tradeData.vSolInBondingCurve;
    this.marketCapSol = tradeData.marketCapSol;
    
    // Update holder data if available
    if (tradeData.traderPublicKey && tradeData.newTokenBalance !== undefined) {
      this.updateHolder(tradeData.traderPublicKey, tradeData.newTokenBalance);
    }
    
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

  getCreatorHoldings() {
    return this.holders.get(this.creator) || 0;
  }

  getCreatorSellPercentage() {
    if (!this.creatorInitialHoldings) return 0;
    const currentHoldings = this.getCreatorHoldings();
    return ((this.creatorInitialHoldings - currentHoldings) / this.creatorInitialHoldings) * 100;
  }

  hasCreatorSoldAll() {
    return this.getCreatorHoldings() === 0;
  }
}

module.exports = Token;
