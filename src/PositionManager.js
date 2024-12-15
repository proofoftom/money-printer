// PositionManager component
const Wallet = require("./Wallet");
const config = require("./config");
const ExitStrategies = require("./ExitStrategies");
const StatsLogger = require("./StatsLogger");

class PositionManager {
  constructor(wallet) {
    this.wallet = wallet;
    this.positions = new Map();
    this.wins = 0;
    this.losses = 0;
    this.exitStrategies = new ExitStrategies(config.EXIT_STRATEGIES);
    this.statsLogger = new StatsLogger();
  }

  openPosition(mint, marketCap) {
    const positionSize = config.POSITION.SIZE;
    if (this.wallet.balance >= positionSize) {
      const position = {
        entryPrice: marketCap,
        size: positionSize,
        highestPrice: marketCap,
        lowestPrice: marketCap,
        remainingSize: 1.0,
        currentPrice: marketCap,
        entryTime: Date.now(),
        maxDrawdown: 0,
        maxUpside: 0,
        volumeHistory: [],
        candleHistory: []
      };

      this.positions.set(mint, position);
      this.wallet.updateBalance(-positionSize);

      const stats = {
        type: 'POSITION_OPEN',
        mint,
        entryPrice: position.entryPrice,
        size: position.size,
        entryTime: new Date(position.entryTime).toISOString(),
        marketCap,
        walletBalance: this.wallet.balance
      };

      this.statsLogger.logStats(stats);

      console.log(`
Position Opened:
- Mint: ${mint}
- Entry Price: ${position.entryPrice} SOL
- Position Size: ${position.size} SOL
- Entry Time: ${new Date(position.entryTime).toISOString()}
- Initial Market Cap: ${marketCap} SOL
- Wallet Balance: ${this.wallet.balance} SOL
      `);

      return true;
    }
    return false;
  }

  closePosition(mint, exitPrice, portion = 1.0) {
    const position = this.positions.get(mint);
    if (!position) return null;

    exitPrice = exitPrice || position.currentPrice;

    const sizeToClose = position.size * position.remainingSize * portion;
    const priceDiff = exitPrice - position.entryPrice;
    const profitLoss = (priceDiff / position.entryPrice) * sizeToClose;
    const holdTime = Date.now() - position.entryTime;
    const profitPercentage = (priceDiff / position.entryPrice) * 100;
    
    this.wallet.updateBalance(sizeToClose + profitLoss);
    this.wallet.recordTrade(profitLoss > 0 ? 1 : -1);

    const stats = {
      type: portion === 1.0 ? 'POSITION_CLOSE' : 'PARTIAL_CLOSE',
      mint,
      entryPrice: position.entryPrice,
      exitPrice,
      holdTimeSeconds: Math.round(holdTime / 1000),
      profitLoss,
      profitLossPercentage: profitPercentage,
      maxUpside: position.maxUpside,
      maxDrawdown: position.maxDrawdown,
      highestPrice: position.highestPrice,
      lowestPrice: position.lowestPrice,
      portionClosed: portion,
      walletBalance: this.wallet.balance,
      volumeHistory: position.volumeHistory,
      candleHistory: position.candleHistory,
      exitReason: position.exitReason || 'unknown'
    };

    if (portion === 1.0) {
      this.positions.delete(mint);
      if (profitLoss > 0) this.wins++;
      else if (profitLoss < 0) this.losses++;
      
      stats.winLossRatio = `${this.wins}/${this.losses}`;

      console.log(`
Position Closed:
- Mint: ${mint}
- Entry Price: ${position.entryPrice} SOL
- Exit Price: ${exitPrice} SOL
- Hold Time: ${Math.round(holdTime / 1000)}s
- P/L: ${profitLoss.toFixed(4)} SOL (${profitPercentage.toFixed(2)}%)
- Max Upside: ${position.maxUpside.toFixed(2)}%
- Max Drawdown: ${position.maxDrawdown.toFixed(2)}%
- Highest Price: ${position.highestPrice} SOL
- Lowest Price: ${position.lowestPrice} SOL
- Win/Loss Ratio: ${this.wins}/${this.losses}
- Wallet Balance: ${this.wallet.balance} SOL
      `);
    } else {
      position.remainingSize -= portion;
      stats.remainingSize = position.remainingSize;

      console.log(`
Partial Position Close:
- Mint: ${mint}
- Portion Closed: ${(portion * 100).toFixed(2)}%
- Exit Price: ${exitPrice} SOL
- P/L: ${profitLoss.toFixed(4)} SOL (${profitPercentage.toFixed(2)}%)
- Remaining Size: ${(position.remainingSize * 100).toFixed(2)}%
- Wallet Balance: ${this.wallet.balance} SOL
      `);
    }

    this.statsLogger.logStats(stats);

    return {
      profitLoss,
      remainingSize: position.remainingSize,
      exitPrice,
      portion,
      holdTime,
      profitPercentage,
      maxUpside: position.maxUpside,
      maxDrawdown: position.maxDrawdown
    };
  }

  updatePosition(mint, currentPrice, volumeData = null, candleData = null) {
    const position = this.positions.get(mint);
    if (!position) return null;

    position.currentPrice = currentPrice;
    
    if (currentPrice > position.highestPrice) {
      position.highestPrice = currentPrice;
      const upside = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
      position.maxUpside = Math.max(position.maxUpside, upside);
    }
    if (currentPrice < position.lowestPrice || !position.lowestPrice) {
      position.lowestPrice = currentPrice;
      const drawdown = ((position.highestPrice - currentPrice) / position.highestPrice) * 100;
      position.maxDrawdown = Math.max(position.maxDrawdown, drawdown);
    }

    if (volumeData) {
      position.volumeHistory.push({
        timestamp: Date.now(),
        volume: volumeData
      });
    }
    if (candleData) {
      position.candleHistory.push({
        timestamp: Date.now(),
        ...candleData
      });
    }

    // Log position update stats
    const stats = {
      type: 'POSITION_UPDATE',
      mint,
      currentPrice,
      highestPrice: position.highestPrice,
      lowestPrice: position.lowestPrice,
      maxUpside: position.maxUpside,
      maxDrawdown: position.maxDrawdown,
      holdTimeSeconds: Math.round((Date.now() - position.entryTime) / 1000),
      unrealizedPL: ((currentPrice - position.entryPrice) / position.entryPrice) * position.size * position.remainingSize,
      unrealizedPLPercentage: ((currentPrice - position.entryPrice) / position.entryPrice) * 100
    };

    if (volumeData) stats.volumeData = volumeData;
    if (candleData) stats.candleData = candleData;

    this.statsLogger.logStats(stats);

    // Check all exit strategies
    const exitResult = this.exitStrategies.shouldExit(position, currentPrice, volumeData?.volume || 0);
    
    if (exitResult.shouldExit) {
      return this.closePosition(mint, currentPrice, exitResult.portion || 1.0);
    }

    return null;
  }

  getPosition(mint) {
    return this.positions.get(mint);
  }
}

module.exports = PositionManager;
