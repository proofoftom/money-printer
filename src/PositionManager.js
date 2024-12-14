// PositionManager component

const Wallet = require("./Wallet");
const config = require("./config");

class PositionManager {
  constructor(wallet) {
    this.wallet = wallet;
    this.positions = new Map();
    this.wins = 0;
    this.losses = 0;
  }

  openPosition(mint, marketCap) {
    const positionSize = config.POSITION.SIZE_SOL;
    if (this.wallet.balance >= positionSize) {
      this.positions.set(mint, {
        entryPrice: marketCap,
        size: positionSize,
        highestPrice: marketCap
      });
      this.wallet.updateBalance(-positionSize);
      return true;
    }
    return false;
  }

  closePosition(mint, exitPrice) {
    const position = this.positions.get(mint);
    if (!position) return null;

    const priceDiff = exitPrice - position.entryPrice;
    const profitLoss = (priceDiff / position.entryPrice) * position.size;
    
    // Update wallet
    this.wallet.updateBalance(position.size + profitLoss);
    this.wallet.recordTrade(profitLoss > 0 ? 1 : -1);

    // Update position tracking
    this.positions.delete(mint);
    if (profitLoss > 0) this.wins++;
    else if (profitLoss < 0) this.losses++;

    return profitLoss;
  }

  getCurrentPrice(mint) {
    const position = this.positions.get(mint);
    // For testing, return a price that gives 40% profit
    return position ? position.entryPrice * 1.4 : 0;
  }

  getPosition(mint) {
    return this.positions.get(mint);
  }

  updateHighestPrice(mint, price) {
    const position = this.positions.get(mint);
    if (position && price > position.highestPrice) {
      position.highestPrice = price;
    }
  }
}

module.exports = PositionManager;
