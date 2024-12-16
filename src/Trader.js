const EventEmitter = require('events');

class Trader extends EventEmitter {
  constructor(publicKey) {
    super();
    this.publicKey = publicKey;
    this.tokenBalances = new Map(); // mint -> balance
    this.trades = new Map(); // mint -> array of trades
    this.firstSeen = Date.now();
  }

  addTrade(tradeData) {
    const { mint, txType, tokenAmount, newTokenBalance, signature } = tradeData;
    
    // Initialize arrays if needed
    if (!this.trades.has(mint)) {
      this.trades.set(mint, []);
    }

    // Add trade to history
    const trade = {
      signature,
      txType,
      amount: tokenAmount,
      timestamp: Date.now(),
      newBalance: newTokenBalance
    };
    this.trades.get(mint).push(trade);

    // Update token balance
    this.tokenBalances.set(mint, newTokenBalance);

    this.emit('tradeAdded', { mint, trade });
  }

  getTokenBalance(mint) {
    return this.tokenBalances.get(mint) || 0;
  }

  getTradeHistory(mint) {
    return this.trades.get(mint) || [];
  }

  getAllTokenBalances() {
    return Object.fromEntries(this.tokenBalances);
  }

  // Get metrics about trader activity
  getMetrics() {
    const totalTokensTraded = Array.from(this.trades.values())
      .reduce((total, trades) => total + trades.length, 0);

    const uniqueTokensTraded = this.trades.size;

    const activeTokens = Array.from(this.tokenBalances.entries())
      .filter(([_, balance]) => balance > 0)
      .length;

    return {
      totalTokensTraded,
      uniqueTokensTraded,
      activeTokens,
      firstSeen: this.firstSeen
    };
  }
}

module.exports = Trader;
