const EventEmitter = require('events');

class Token extends EventEmitter {
  constructor(tokenData) {
    super();
    this.mint = tokenData.mint;
    this.name = tokenData.name;
    this.symbol = tokenData.symbol;
    this.uri = tokenData.uri;
    this.traderPublicKey = tokenData.traderPublicKey;
    this.initialBuy = tokenData.initialBuy;
    this.vTokensInBondingCurve = tokenData.vTokensInBondingCurve;
    this.vSolInBondingCurve = tokenData.vSolInBondingCurve;
    this.marketCapSol = tokenData.marketCapSol;
    this.signature = tokenData.signature;
    this.bondingCurveKey = tokenData.bondingCurveKey;
    
    this.state = 'new';
    this.highestMarketCap = this.marketCapSol;
    this.drawdownLow = null;
    this.holders = new Map();
    this.creatorInitialHoldings = 0;
    
    // Initialize creator as holder if initial balance provided
    if (tokenData.newTokenBalance) {
      this.holders.set(tokenData.traderPublicKey, tokenData.newTokenBalance);
      this.creatorInitialHoldings = tokenData.newTokenBalance;
    } else if (tokenData.initialBuy) {
      this.holders.set(tokenData.traderPublicKey, tokenData.initialBuy);
      this.creatorInitialHoldings = tokenData.initialBuy;
    }
  }

  setState(newState) {
    const oldState = this.state;
    this.state = newState;
    if (newState === 'drawdown') {
      this.drawdownLow = this.marketCapSol;
    }
    this.emit('stateChanged', { token: this, from: oldState, to: newState });
  }

  update(data) {
    if (data.marketCapSol) {
      if (data.marketCapSol > this.highestMarketCap) {
        this.highestMarketCap = data.marketCapSol;
      }
      if (this.state === 'drawdown' && data.marketCapSol < this.drawdownLow) {
        this.drawdownLow = data.marketCapSol;
      }
      this.marketCapSol = data.marketCapSol;
    }
    
    if (data.vTokensInBondingCurve) {
      this.vTokensInBondingCurve = data.vTokensInBondingCurve;
    }
    
    if (data.vSolInBondingCurve) {
      this.vSolInBondingCurve = data.vSolInBondingCurve;
    }

    if (data.traderPublicKey && typeof data.newTokenBalance !== 'undefined') {
      if (data.newTokenBalance > 0) {
        this.holders.set(data.traderPublicKey, data.newTokenBalance);
      } else {
        this.holders.delete(data.traderPublicKey);
      }
    }
  }

  getDrawdownPercentage() {
    if (!this.highestMarketCap || !this.marketCapSol) return 0;
    return ((this.highestMarketCap - this.marketCapSol) / this.highestMarketCap) * 100;
  }

  getRecoveryPercentage() {
    if (this.state !== 'drawdown' || !this.drawdownLow || !this.marketCapSol) return 0;
    return ((this.marketCapSol - this.drawdownLow) / this.drawdownLow) * 100;
  }

  getHolderCount() {
    return this.holders.size;
  }

  getTotalTokensHeld() {
    return Array.from(this.holders.values()).reduce((sum, balance) => sum + balance, 0);
  }

  getCreatorHoldings() {
    return this.holders.get(this.traderPublicKey) || 0;
  }

  hasCreatorSoldAll() {
    return this.getCreatorHoldings() === 0;
  }

  getCreatorSellPercentage() {
    if (!this.creatorInitialHoldings) return 0;
    const currentCreatorHoldings = this.getCreatorHoldings();
    return ((this.creatorInitialHoldings - currentCreatorHoldings) / this.creatorInitialHoldings) * 100;
  }

  getTopHolders(count = 5) {
    return Array.from(this.holders.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, count)
      .map(([address, balance]) => ({ address, balance }));
  }

  getTopHolderConcentration(topN = 10) {
    const totalSupply = this.getTotalTokensHeld();
    if (totalSupply === 0) return 0;

    const topHolders = this.getTopHolders(topN);
    const topHoldersBalance = topHolders.reduce((sum, { balance }) => sum + balance, 0);
    return (topHoldersBalance / totalSupply) * 100;
  }

  isHeatingUp(threshold) {
    return this.marketCapSol > threshold;
  }

  isFirstPump(threshold) {
    return this.marketCapSol > threshold;
  }

  isDead(threshold) {
    return this.marketCapSol < threshold;
  }
}

module.exports = Token;
