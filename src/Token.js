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
    this.highestMarketCapSol = this.marketCapSol;
    this.drawdownLowSol = this.marketCapSol;
    this.lastUpdate = Date.now();

    // Creation metadata
    this.createdAt = Date.now();
    this.signature = tokenData.signature;
    this.bondingCurveKey = tokenData.bondingCurveKey;

    // Trading data
    this.trades = [];
    this.totalVolumeSol = 0;
    this.uniqueBuyers = new Set();
    this.uniqueSellers = new Set();

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

  update(data) {
    // Update holder data if available
    if (data.traderPublicKey && data.newTokenBalance !== undefined) {
      this.updateHolder(data.traderPublicKey, data.newTokenBalance);
    }

    // Update market data
    if (data.marketCapSol !== undefined) {
      this.marketCapSol = data.marketCapSol;
      if (this.marketCapSol > this.highestMarketCapSol) {
        this.highestMarketCapSol = this.marketCapSol;
      }
      if (this.marketCapSol < this.drawdownLowSol) {
        this.drawdownLowSol = this.marketCapSol;
      }
    }

    if (data.vTokensInBondingCurve !== undefined) {
      this.vTokensInBondingCurve = data.vTokensInBondingCurve;
    }

    if (data.vSolInBondingCurve !== undefined) {
      this.vSolInBondingCurve = data.vSolInBondingCurve;
    }

    // Update trading data
    if (data.txType === 'buy') {
      this.uniqueBuyers.add(data.traderPublicKey);
    } else if (data.txType === 'sell') {
      this.uniqueSellers.add(data.traderPublicKey);
    }

    if (data.solAmount) {
      this.totalVolumeSol += data.solAmount;
      this.trades.push({
        type: data.txType,
        solAmount: data.solAmount,
        timestamp: Date.now()
      });
    }

    this.lastUpdate = Date.now();
    this.emit('updated', this);
  }

  updateHolder(address, balance) {
    if (balance === 0) {
      this.holders.delete(address);
    } else {
      this.holders.set(address, balance);
    }
  }

  getHolderCount() {
    return this.holders.size;
  }

  getTopHolderConcentration(topN = 10) {
    const sortedHolders = Array.from(this.holders.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN);

    const totalSupply = Array.from(this.holders.values()).reduce((a, b) => a + b, 0);
    const topHoldersBalance = sortedHolders.reduce((sum, [_, balance]) => sum + balance, 0);

    return (topHoldersBalance / totalSupply) * 100;
  }

  getCreatorHoldings() {
    return this.holders.get(this.creator) || 0;
  }

  hasCreatorSoldAll() {
    return this.getCreatorHoldings() === 0;
  }

  getDrawdownPercentage() {
    if (this.highestMarketCapSol === 0) return 0;
    return ((this.highestMarketCapSol - this.marketCapSol) / this.highestMarketCapSol) * 100;
  }

  getRecoveryPercentage() {
    if (this.state !== "drawdown" || this.drawdownLowSol === 0) return 0;
    return ((this.marketCapSol - this.drawdownLowSol) / this.drawdownLowSol) * 100;
  }

  getAverageTradeSize() {
    if (this.trades.length === 0) return 0;
    return this.totalVolumeSol / this.trades.length;
  }

  getBuySellRatio() {
    const buyCount = this.trades.filter(t => t.type === 'buy').length;
    return buyCount / this.trades.length;
  }

  setState(newState) {
    const oldState = this.state;
    this.state = newState;

    // Reset tracking metrics based on state transition
    if (newState === "drawdown") {
      this.drawdownLowSol = this.marketCapSol;
    }

    this.emit("stateChanged", { token: this, from: oldState, to: newState });
  }
}

module.exports = Token;
