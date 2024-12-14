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
    this.initialBuy = tokenData.initialBuy || 0;
    this.creatorInitialHoldings = tokenData.initialBuy || 0;

    // Market data
    this.vTokensInBondingCurve = tokenData.vTokensInBondingCurve || 0;
    this.vSolInBondingCurve = tokenData.vSolInBondingCurve || 0;
    this.marketCapSol = tokenData.marketCapSol || 0;

    // State tracking
    this.state = "new";
    this.highestMarketCap = this.marketCapSol;
    this.drawdownLow = this.marketCapSol;
    this.lastUpdate = Date.now();

    // Creation metadata
    this.createdAt = Date.now();
    this.signature = tokenData.signature;
    this.bondingCurveKey = tokenData.bondingCurveKey;

    // Holder tracking
    this.holders = new Map();

    // Initialize creator's holdings
    if (tokenData.traderPublicKey) {
      if (tokenData.newTokenBalance !== undefined) {
        this.updateHolder(tokenData.traderPublicKey, tokenData.newTokenBalance);
      } else if (tokenData.initialBuy && typeof tokenData.initialBuy === 'number') {
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

  getTopHolders(count = 10) {
    const holders = Array.from(this.holders.entries())
      .map(([publicKey, balance]) => ({ publicKey, balance }))
      .sort((a, b) => b.balance - a.balance);

    return holders.slice(0, count);
  }

  getTopHolderConcentration(count = 10) {
    const totalSupply = this.getTotalTokensHeld();
    if (totalSupply === 0) return 0;

    const topHolders = this.getTopHolders(count);
    const topHoldersTotal = topHolders.reduce((sum, holder) => sum + holder.balance, 0);

    return Math.round((topHoldersTotal / totalSupply) * 100);
  }

  hasCreatorSoldAll() {
    return this.getCreatorHoldings() === 0;
  }

  getCreatorHoldings() {
    return this.holders.get(this.creator) || 0;
  }

  getCreatorSellPercentage() {
    if (!this.creatorInitialHoldings) return 0;
    const currentHoldings = this.getCreatorHoldings();
    return Math.round(((this.creatorInitialHoldings - currentHoldings) / this.creatorInitialHoldings) * 100);
  }

  update(data) {
    // Update holder data if available
    if (data.traderPublicKey && data.newTokenBalance !== undefined) {
      this.updateHolder(data.traderPublicKey, data.newTokenBalance);
    }

    // Update market data
    if (data.marketCapSol !== undefined) {
      this.marketCapSol = data.marketCapSol;
      if (this.marketCapSol > this.highestMarketCap) {
        this.highestMarketCap = this.marketCapSol;
      }
      if (this.marketCapSol < this.drawdownLow) {
        this.drawdownLow = this.marketCapSol;
      }
    }

    if (data.vTokensInBondingCurve !== undefined) {
      this.vTokensInBondingCurve = data.vTokensInBondingCurve;
    }

    if (data.vSolInBondingCurve !== undefined) {
      this.vSolInBondingCurve = data.vSolInBondingCurve;
    }

    this.lastUpdate = Date.now();
    this.emit('updated', this);
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
    if (this.highestMarketCap === 0) return 0;
    return ((this.highestMarketCap - this.marketCapSol) / this.highestMarketCap) * 100;
  }

  getRecoveryPercentage() {
    if (this.state !== "drawdown" || this.drawdownLow === 0) return 0;
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
