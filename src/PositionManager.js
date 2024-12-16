// PositionManager component
const Wallet = require("./Wallet");
const config = require("./config");
const ExitStrategies = require("./ExitStrategies");
const StatsLogger = require("./StatsLogger");
const TransactionSimulator = require("./TransactionSimulator");

class PositionManager {
  constructor(wallet) {
    this.wallet = wallet;
    this.positions = new Map();
    this.wins = 0;
    this.losses = 0;
    this.exitStrategies = new ExitStrategies(config.EXIT_STRATEGIES);
    this.statsLogger = new StatsLogger();
    this.transactionSimulator = new TransactionSimulator();
  }

  calculatePositionSize(marketCap, volatility = 0) {
    let size = config.POSITION.MIN_POSITION_SIZE_SOL;
    
    // Base size calculation
    const marketCapBasedSize = marketCap * config.POSITION.POSITION_SIZE_MARKET_CAP_RATIO;
    size = Math.min(marketCapBasedSize, config.POSITION.MAX_POSITION_SIZE_SOL);
    size = Math.max(size, config.POSITION.MIN_POSITION_SIZE_SOL);

    // Apply dynamic sizing if enabled
    if (config.POSITION.USE_DYNAMIC_SIZING) {
      // Scale based on volatility
      const volatilityMultiplier = Math.max(0, 1 - (volatility * config.POSITION.VOLATILITY_SCALING_FACTOR));
      size *= volatilityMultiplier;
    }

    return size;
  }

  async openPosition(mint, marketCap, volatility = 0) {
    const positionSize = this.calculatePositionSize(marketCap, volatility);
    
    if (this.wallet.balance >= positionSize) {
      // Simulate transaction delay and price impact
      const delay = await this.transactionSimulator.simulateTransactionDelay();
      const executionPrice = this.transactionSimulator.calculatePriceImpact(
        positionSize,
        marketCap,
        0 // Initial volume, will be updated later
      );

      const position = {
        entryPrice: executionPrice,
        size: positionSize,
        highestPrice: executionPrice,
        lowestPrice: executionPrice,
        remainingSize: 1.0,
        currentPrice: executionPrice,
        entryTime: Date.now(),
        maxDrawdown: 0,
        maxUpside: 0,
        volumeHistory: [],
        candleHistory: [],
        simulatedDelay: delay
      };

      this.positions.set(mint, position);
      this.wallet.updateBalance(-positionSize);

      const stats = {
        type: 'POSITION_OPEN',
        mint,
        entryPrice: position.entryPrice,
        intendedPrice: marketCap,
        priceImpact: ((executionPrice - marketCap) / marketCap) * 100,
        transactionDelay: delay,
        size: position.size,
        entryTime: new Date(position.entryTime).toISOString(),
        marketCap,
        walletBalance: this.wallet.balance
      };

      this.statsLogger.logStats(stats);

      console.log(`
Position Opened:
- Mint: ${mint}
- Intended Price: ${marketCap} SOL
- Execution Price: ${position.entryPrice} SOL (Impact: ${((executionPrice - marketCap) / marketCap * 100).toFixed(2)}%)
- Transaction Delay: ${delay}ms
- Position Size: ${position.size} SOL
- Entry Time: ${new Date(position.entryTime).toISOString()}
- Initial Market Cap: ${marketCap} SOL
- Wallet Balance: ${this.wallet.balance} SOL
      `);

      return true;
    }
    return false;
  }

  async closePosition(mint, exitPrice, portion = 1.0) {
    const position = this.positions.get(mint);
    if (!position) return null;

    exitPrice = exitPrice || position.currentPrice;

    // Simulate transaction delay and price impact for closing
    const sizeToClose = position.size * position.remainingSize * portion;
    const delay = await this.transactionSimulator.simulateTransactionDelay();
    const executionPrice = this.transactionSimulator.calculatePriceImpact(
      sizeToClose,
      exitPrice,
      position.volumeHistory[position.volumeHistory.length - 1]?.volume || 0
    );

    const priceDiff = executionPrice - position.entryPrice;
    const profitLoss = (priceDiff / position.entryPrice) * sizeToClose;
    const holdTime = Date.now() - position.entryTime;
    const profitPercentage = (priceDiff / position.entryPrice) * 100;
    
    this.wallet.updateBalance(sizeToClose + profitLoss);
    this.wallet.recordTrade(profitLoss > 0 ? 1 : -1);

    const stats = {
      type: portion === 1.0 ? 'POSITION_CLOSE' : 'PARTIAL_CLOSE',
      mint,
      entryPrice: position.entryPrice,
      intendedExitPrice: exitPrice,
      executionPrice,
      priceImpact: ((executionPrice - exitPrice) / exitPrice) * 100,
      transactionDelay: delay,
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
- Intended Exit Price: ${exitPrice} SOL
- Execution Price: ${executionPrice} SOL (Impact: ${((executionPrice - exitPrice) / exitPrice * 100).toFixed(2)}%)
- Transaction Delay: ${delay}ms
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
- Intended Exit Price: ${exitPrice} SOL
- Execution Price: ${executionPrice} SOL (Impact: ${((executionPrice - exitPrice) / exitPrice * 100).toFixed(2)}%)
- Transaction Delay: ${delay}ms
- P/L: ${profitLoss.toFixed(4)} SOL (${profitPercentage.toFixed(2)}%)
- Remaining Size: ${(position.remainingSize * 100).toFixed(2)}%
- Wallet Balance: ${this.wallet.balance} SOL
      `);
    }

    this.statsLogger.logStats(stats);

    return {
      profitLoss,
      remainingSize: position.remainingSize,
      executionPrice,
      intendedExitPrice: exitPrice,
      priceImpact: ((executionPrice - exitPrice) / exitPrice) * 100,
      transactionDelay: delay,
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
        volume: volumeData.volume,
        price: currentPrice
      });

      // Keep only recent volume history
      const historyWindow = config.POSITION.PEAK_VOLUME_WINDOW || 300;
      const cutoffTime = Date.now() - (historyWindow * 1000);
      position.volumeHistory = position.volumeHistory.filter(v => v.timestamp >= cutoffTime);
    }

    if (candleData) {
      position.candleHistory.push({
        timestamp: Date.now(),
        open: candleData.open,
        high: candleData.high,
        low: candleData.low,
        close: candleData.close,
        volume: candleData.volume
      });
    }

    return {
      currentPrice,
      entryPrice: position.entryPrice,
      size: position.size,
      remainingSize: position.remainingSize,
      profitLoss: ((currentPrice - position.entryPrice) / position.entryPrice) * 100,
      maxUpside: position.maxUpside,
      maxDrawdown: position.maxDrawdown
    };
  }

  getPosition(mint) {
    return this.positions.get(mint);
  }

  getActivePositions() {
    return Array.from(this.positions.values());
  }
}

module.exports = PositionManager;
