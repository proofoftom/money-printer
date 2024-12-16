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
      exitReason: position.exitReason || 'unknown',
      priceVolatility: this.calculateVolatility(position.candleHistory),
      volumeProfile: this.analyzeVolumeProfile(position.volumeHistory),
      optimalExitPrice: position.highestPrice * 0.95, // Assuming 5% below peak is optimal
      missedProfit: ((position.highestPrice * 0.95) - executionPrice) / executionPrice * 100,
      timeToMaxPrice: this.calculateTimeToMaxPrice(position),
      averageVolume: this.calculateAverageVolume(position.volumeHistory),
      slippageAnalysis: {
        entry: ((position.entryPrice - marketCap) / marketCap) * 100,
        exit: ((exitPrice - executionPrice) / exitPrice) * 100
      },
      marketConditions: {
        trendDirection: this.calculateTrendDirection(position.candleHistory),
        volumeStrength: this.calculateVolumeStrength(position.volumeHistory)
      },
      holderAnalytics: this.analyzeHolders(position.token)
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

  calculateVolatility(candleHistory) {
    if (!candleHistory || candleHistory.length < 2) return 0;
    
    const returns = [];
    for (let i = 1; i < candleHistory.length; i++) {
      const returnVal = (candleHistory[i].close - candleHistory[i-1].close) / candleHistory[i-1].close;
      returns.push(returnVal);
    }
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }

  analyzeVolumeProfile(volumeHistory) {
    if (!volumeHistory || volumeHistory.length === 0) return null;
    
    const volumeData = volumeHistory.map(v => v.volume);
    const maxVolume = Math.max(...volumeData);
    const minVolume = Math.min(...volumeData);
    const avgVolume = volumeData.reduce((a, b) => a + b, 0) / volumeData.length;
    
    return {
      maxVolume,
      minVolume,
      avgVolume,
      volumeStability: (maxVolume - minVolume) / avgVolume
    };
  }

  calculateTimeToMaxPrice(position) {
    if (!position.candleHistory || position.candleHistory.length === 0) return null;
    
    const maxPriceCandle = position.candleHistory.find(c => c.high === position.highestPrice);
    if (!maxPriceCandle) return null;
    
    return Math.round((maxPriceCandle.timestamp - position.entryTime) / 1000); // in seconds
  }

  calculateAverageVolume(volumeHistory) {
    if (!volumeHistory || volumeHistory.length === 0) return 0;
    return volumeHistory.reduce((sum, v) => sum + v.volume, 0) / volumeHistory.length;
  }

  calculateTrendDirection(candleHistory) {
    if (!candleHistory || candleHistory.length < 2) return 'neutral';
    
    const prices = candleHistory.map(c => c.close);
    const firstHalf = prices.slice(0, Math.floor(prices.length / 2));
    const secondHalf = prices.slice(Math.floor(prices.length / 2));
    
    const firstHalfAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    
    if (secondHalfAvg > firstHalfAvg * 1.05) return 'uptrend';
    if (secondHalfAvg < firstHalfAvg * 0.95) return 'downtrend';
    return 'neutral';
  }

  calculateVolumeStrength(volumeHistory) {
    if (!volumeHistory || volumeHistory.length < 2) return 'neutral';
    
    const volumes = volumeHistory.map(v => v.volume);
    const firstHalf = volumes.slice(0, Math.floor(volumes.length / 2));
    const secondHalf = volumes.slice(Math.floor(volumes.length / 2));
    
    const firstHalfAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    
    if (secondHalfAvg > firstHalfAvg * 1.2) return 'increasing';
    if (secondHalfAvg < firstHalfAvg * 0.8) return 'decreasing';
    return 'stable';
  }

  analyzeHolders(token) {
    if (!token || !token.wallets) return null;

    const now = Date.now();
    const holders = Array.from(token.wallets.entries());
    const totalHolders = holders.length;
    
    // Get creator behavior
    const creatorStats = {
      sellPercentage: token.getCreatorSellPercentage(),
      hasExited: token.hasCreatorSoldAll()
    };

    // Analyze top holders
    const topHolders = token.getTopHolders(5);
    const topHolderConcentration = token.getTopHolderConcentration(5);

    // Analyze trading patterns
    const traderStats = token.getTraderStats("5m");
    
    // Calculate holder turnover (percentage of holders who have traded in last 5 minutes)
    const recentlyActiveHolders = holders.filter(([_, wallet]) => 
      wallet.lastActive > now - 5 * 60 * 1000
    ).length;
    
    const holderTurnover = (recentlyActiveHolders / totalHolders) * 100;

    return {
      totalHolders,
      topHolderConcentration,
      holderTurnover,
      creatorBehavior: creatorStats,
      tradingActivity: {
        uniqueTraders: traderStats.uniqueTraders,
        tradeCount: traderStats.totalTrades,
        averageTradeSize: traderStats.averageTradeSize,
        buyToSellRatio: traderStats.buyToSellRatio
      },
      topHolders: topHolders.map(holder => ({
        balance: holder.balance,
        percentageHeld: (holder.balance / token.getTotalTokensHeld()) * 100,
        isCreator: holder.isCreator || false
      }))
    };
  }
}

module.exports = PositionManager;
