// PositionManager component
const Wallet = require("./Wallet");
const config = require("./config");
const ExitStrategies = require("./ExitStrategies");

class PositionManager {
  constructor(wallet) {
    this.wallet = wallet;
    this.positions = new Map();
    this.wins = 0;
    this.losses = 0;
    this.exitStrategies = new ExitStrategies(config.EXIT_STRATEGIES);
  }

  openPosition(mint, marketCap) {
    const positionSize = config.POSITION.SIZE_SOL;
    if (this.wallet.balance >= positionSize) {
      this.positions.set(mint, {
        entryPrice: marketCap,
        size: positionSize,
        highestPrice: marketCap,
        remainingSize: 1.0, // Track remaining position size for tiered exits
        currentPrice: marketCap
      });
      this.wallet.updateBalance(-positionSize);
      return true;
    }
    return false;
  }

  closePosition(mint, exitPrice, portion = 1.0) {
    const position = this.positions.get(mint);
    if (!position) return null;

    // If no exitPrice provided, use current market price
    exitPrice = exitPrice || position.currentPrice;

    // Calculate profit/loss for the portion being closed
    const sizeToClose = position.size * position.remainingSize * portion;
    const priceDiff = exitPrice - position.entryPrice;
    const profitLoss = (priceDiff / position.entryPrice) * sizeToClose;
    
    // Update wallet
    this.wallet.updateBalance(sizeToClose + profitLoss);
    this.wallet.recordTrade(profitLoss > 0 ? 1 : -1);

    // Update position tracking
    if (portion === 1.0) {
      this.positions.delete(mint);
      if (profitLoss > 0) this.wins++;
      else if (profitLoss < 0) this.losses++;
    } else {
      position.remainingSize -= portion;
    }

    return {
      profitLoss,
      remainingSize: position.remainingSize,
      exitPrice,
      portion
    };
  }

  updatePosition(mint, currentPrice) {
    const position = this.positions.get(mint);
    if (!position) return null;

    // Update position tracking
    position.currentPrice = currentPrice;
    if (currentPrice > position.highestPrice) {
      position.highestPrice = currentPrice;
    }

    // Check exit conditions
    if (this.exitStrategies.shouldStopLoss(position)) {
      return this.closePosition(mint, currentPrice);
    }

    if (this.exitStrategies.shouldTakeProfit(position)) {
      return this.closePosition(mint, currentPrice);
    }

    const tierExit = this.exitStrategies.calculateTierExit(position);
    if (tierExit !== null) {
      return this.closePosition(mint, currentPrice, tierExit);
    }

    return null;
  }

  getPosition(mint) {
    return this.positions.get(mint);
  }
}

module.exports = PositionManager;
