// PositionManager component

const Wallet = require("./Wallet");
const config = require("./config");

class PositionManager {
  constructor(wallet) {
    this.wallet = wallet;
    this.positions = new Map();
    this.wins = 0;
    this.losses = 0;
    console.log(
      "PositionManager initialized with wallet balance:",
      this.wallet.balance
    );
  }

  // Add methods for managing positions
  openPosition(mint, marketCap) {
    const positionSize = config.POSITION_SIZE_SOL; // Use config for position size
    if (this.wallet.balance >= positionSize) {
      this.positions.set(mint, { entryPrice: marketCap, size: positionSize });
      this.wallet.updateBalance(-positionSize);
      console.log(
        `Opened position for ${mint} at ${marketCap} with size ${positionSize}`
      );
      return true;
    } else {
      console.error("Insufficient balance to open position");
      return false;
    }
  }

  closePosition(mint, exitPrice) {
    const position = this.positions.get(mint);
    if (position) {
      const profitLoss = (exitPrice - position.entryPrice) * position.size;
      this.wallet.updateBalance(profitLoss + position.size);
      this.wallet.recordTrade(profitLoss);
      this.positions.delete(mint);
      if (profitLoss > 0) {
        this.wins += 1;
      } else if (profitLoss < 0) {
        this.losses += 1;
      }
      console.log(
        `Closed position for ${mint} at ${exitPrice} with PnL ${profitLoss}`
      );
      return profitLoss;
    } else {
      console.error("Position not found");
      return null;
    }
  }
}

module.exports = PositionManager;
