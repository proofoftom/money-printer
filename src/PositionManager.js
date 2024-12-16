// PositionManager component
const Wallet = require("./Wallet");
const config = require("./config");
const ExitStrategies = require("./ExitStrategies");
const TransactionSimulator = require("./TransactionSimulator");
const PositionStateManager = require("./PositionStateManager");

class PositionManager {
  constructor(wallet) {
    this.wallet = wallet;
    this.wins = 0;
    this.losses = 0;
    this.exitStrategies = new ExitStrategies(config.EXIT_STRATEGIES);
    this.transactionSimulator = new TransactionSimulator();
    this.stateManager = new PositionStateManager();

    // Set up position state event handlers
    this.stateManager.on('positionAdded', this.handlePositionAdded.bind(this));
    this.stateManager.on('positionUpdated', this.handlePositionUpdated.bind(this));
    this.stateManager.on('positionClosed', this.handlePositionClosed.bind(this));
    this.stateManager.on('partialExit', this.handlePartialExit.bind(this));

    // Periodic position validation
    setInterval(() => this.validatePositions(), 60000); // Every minute
  }

  handlePositionAdded(position) {
    console.log(`
New Position Added:
- Mint: ${position.mint}
- Entry Price: ${position.entryPrice} SOL
- Size: ${position.size} SOL
- Entry Time: ${new Date(position.entryTime).toISOString()}
    `);
  }

  handlePositionUpdated(position) {
    const pl = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
    console.log(`
Position Updated:
- Mint: ${position.mint}
- Current Price: ${position.currentPrice} SOL
- P/L: ${pl.toFixed(2)}%
- Max Upside: ${position.maxUpside.toFixed(2)}%
- Max Drawdown: ${position.maxDrawdown.toFixed(2)}%
    `);
  }

  handlePositionClosed(position) {
    const pl = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
    console.log(`
Position Closed:
- Mint: ${position.mint}
- Final P/L: ${pl.toFixed(2)}%
- Hold Time: ${Math.round((position.closedAt - position.entryTime) / 1000)}s
    `);
  }

  handlePartialExit(position) {
    console.log(`
Partial Exit:
- Mint: ${position.mint}
- Remaining Size: ${(position.remainingSize * 100).toFixed(2)}%
- Partial Exits: ${position.partialExits.length}
    `);
  }

  async openPosition(mint, marketCap, volatility = 0) {
    const positionSize = this.calculatePositionSize(marketCap, volatility);
    
    if (this.wallet.balance >= positionSize) {
      // Simulate transaction delay and price impact
      const delay = await this.transactionSimulator.simulateTransactionDelay();
      const executionPrice = this.transactionSimulator.calculatePriceImpact(
        positionSize,
        marketCap,
        0
      );

      const position = {
        mint,
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
        simulatedDelay: delay,
        priceHistory: [executionPrice],
        volume: 0,
        volume1m: 0,
        volume5m: 0,
        volume30m: 0,
        profitHistory: [0],
        highPrice: executionPrice
      };

      this.stateManager.addPosition(position);
      this.wallet.updateBalance(-positionSize);

      return true;
    }
    return false;
  }

  async closePosition(mint, exitPrice, portion = 1.0) {
    const position = this.stateManager.getPosition(mint);
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
    
    this.wallet.updateBalance(sizeToClose + profitLoss);
    this.wallet.recordTrade(profitLoss > 0 ? 1 : -1);

    if (portion === 1.0) {
      if (profitLoss > 0) this.wins++;
      else if (profitLoss < 0) this.losses++;
      
      return this.stateManager.closePosition(mint);
    } else {
      return this.stateManager.recordPartialExit(mint, {
        portion,
        remainingSize: position.remainingSize - portion,
        exitPrice: executionPrice,
        profitLoss
      });
    }
  }

  updatePosition(mint, currentPrice, volumeData = null, candleData = null) {
    // Get existing position data
    const position = this.getPosition(mint);
    if (!position) return null;

    // Update price history (keep last 10 minutes of data)
    const priceHistory = position.priceHistory || [];
    priceHistory.push(currentPrice);
    if (priceHistory.length > 60) { // 60 data points at ~10s intervals = 10 minutes
      priceHistory.shift();
    }

    // Update volume history (keep last 5 minutes of data)
    const volumeHistory = position.volumeHistory || [];
    if (volumeData) {
      volumeHistory.push({
        timestamp: Date.now(),
        volume: volumeData.volume || 0,
        volume1m: volumeData.volume1m || 0,
        volume5m: volumeData.volume5m || 0,
        volume30m: volumeData.volume30m || 0
      });
      if (volumeHistory.length > 30) { // 30 data points = 5 minutes
        volumeHistory.shift();
      }
    }

    // Update profit history
    const profitHistory = position.profitHistory || [];
    const currentProfit = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    profitHistory.push(currentProfit);
    if (profitHistory.length > 30) {
      profitHistory.shift();
    }

    // Update high price if needed
    const highPrice = Math.max(position.highPrice || position.entryPrice, currentPrice);

    // Get latest volume from volumeData or keep existing
    const volume = volumeData?.volume || position.volume || 0;
    const volume1m = volumeData?.volume1m || position.volume1m || 0;
    const volume5m = volumeData?.volume5m || position.volume5m || 0;
    const volume30m = volumeData?.volume30m || position.volume30m || 0;

    return this.stateManager.updatePosition(mint, {
      currentPrice,
      priceHistory,
      volumeHistory,
      profitHistory,
      highPrice,
      volume,
      volume1m,
      volume5m,
      volume30m,
      candleHistory: candleData ? [...(position.candleHistory || []), candleData] : undefined
    });
  }

  getPosition(mint) {
    return this.stateManager.getPosition(mint);
  }

  getActivePositions() {
    return this.stateManager.getActivePositions();
  }

  getPositionStats() {
    const stats = this.stateManager.getPositionStats();
    return {
      ...stats,
      wins: this.wins,
      losses: this.losses,
      winRate: this.wins / (this.wins + this.losses) || 0
    };
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

  validatePositions() {
    const invalidPositions = this.stateManager.validatePositions();
    
    if (invalidPositions.length > 0) {
      console.warn(`Found ${invalidPositions.length} invalid positions:`);
      
      for (const { mint, reason, position } of invalidPositions) {
        console.warn(`- ${mint}: ${reason}`);
        
        // Auto-close stale positions
        if (reason === 'stale') {
          console.warn(`Auto-closing stale position for ${mint}`);
          this.closePosition(mint, position.currentPrice);
        }
      }
    }
  }
}

module.exports = PositionManager;
