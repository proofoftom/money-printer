// PositionManager component
const EventEmitter = require("events");
const Wallet = require("./Wallet");
const config = require("./config");
const ExitStrategies = require("./ExitStrategies");
const TransactionSimulator = require("./TransactionSimulator");
const PositionStateManager = require("./PositionStateManager");

class PositionManager extends EventEmitter {
  constructor(wallet) {
    super();
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

  async openPosition(mint, token, marketCap) {
    // Get entry point confidence from token state manager
    const entryPoint = token.stateManager.getBestEntry();
    if (!entryPoint || entryPoint.confidence < config.POSITION.MIN_ENTRY_CONFIDENCE) {
      console.log(`Skipping position: Low entry confidence (${entryPoint?.confidence || 0})`);
      return false;
    }

    // Calculate position size based on entry confidence and token state
    const baseSize = this.calculatePositionSize(marketCap);
    const confidenceMultiplier = this.calculateConfidenceMultiplier(entryPoint.confidence);
    const stateMultiplier = this.calculateStateMultiplier(token.stateManager.state);
    const positionSize = baseSize * confidenceMultiplier * stateMultiplier;
    
    if (this.wallet.balance >= positionSize) {
      // Simulate transaction with new metrics
      const delay = await this.transactionSimulator.simulateTransactionDelay();
      const executionPrice = this.transactionSimulator.calculatePriceImpact(
        positionSize,
        marketCap,
        token.metrics.earlyTrading?.volumeAcceleration || 0
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
        entryState: token.stateManager.state,
        entryConfidence: entryPoint.confidence,
        metrics: {
          volumeProfile: { ...token.metrics.earlyTrading?.volumeProfile },
          buyPressure: { ...token.metrics.earlyTrading?.buyPressure },
          creatorActivity: { ...token.metrics.earlyTrading?.creatorActivity },
          tradingPatterns: {
            rapidTraders: new Set([...token.metrics.earlyTrading?.tradingPatterns.rapidTraders || []]),
            alternatingTraders: new Set([...token.metrics.earlyTrading?.tradingPatterns.alternatingTraders || []])
          }
        },
        priceHistory: [executionPrice],
        volumeHistory: [],
        candleHistory: [],
        simulatedDelay: delay,
        profitHistory: [0]
      };

      this.stateManager.addPosition(position);
      this.wallet.updateBalance(-positionSize);

      // Emit trade event with enhanced metrics
      this.emit('trade', {
        type: 'BUY',
        mint,
        profitLoss: 0,
        symbol: position.symbol || mint.slice(0, 8),
        timestamp: Date.now(),
        metrics: {
          entryState: position.entryState,
          confidence: position.entryConfidence,
          volumeAcceleration: token.metrics.earlyTrading?.volumeAcceleration,
          buyPressure: token.metrics.earlyTrading?.buyPressure.current
        }
      });

      return true;
    }
    return false;
  }

  calculateConfidenceMultiplier(confidence) {
    // Scale position size based on entry confidence
    // 0-40: 0.5x, 41-60: 0.75x, 61-80: 1x, 81-90: 1.25x, 91-100: 1.5x
    if (confidence >= 91) return 1.5;
    if (confidence >= 81) return 1.25;
    if (confidence >= 61) return 1.0;
    if (confidence >= 41) return 0.75;
    return 0.5;
  }

  calculateStateMultiplier(state) {
    // Adjust position size based on token state
    switch (state) {
      case 'ACCUMULATION':
        return 0.75; // Early entry, higher risk
      case 'LAUNCHING':
        return 1.25; // Strong momentum building
      case 'PUMPING':
        return 1.0;  // Standard entry
      default:
        return 0.5;  // Unknown state, reduce size
    }
  }

  async updatePosition(mint, currentPrice, token) {
    const position = this.stateManager.getPosition(mint);
    if (!position) return;

    // Update position with new token metrics
    position.currentPrice = currentPrice;
    position.priceHistory.push(currentPrice);
    
    // Update metrics
    if (token.metrics.earlyTrading) {
      position.metrics = {
        volumeProfile: { ...token.metrics.earlyTrading.volumeProfile },
        buyPressure: { ...token.metrics.earlyTrading.buyPressure },
        creatorActivity: { ...token.metrics.earlyTrading.creatorActivity },
        tradingPatterns: {
          rapidTraders: new Set([...token.metrics.earlyTrading.tradingPatterns.rapidTraders]),
          alternatingTraders: new Set([...token.metrics.earlyTrading.tradingPatterns.alternatingTraders])
        }
      };
    }

    // Calculate P/L
    const pl = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    position.profitHistory.push(pl);

    // Update max values
    position.maxUpside = Math.max(position.maxUpside, pl);
    position.maxDrawdown = Math.min(position.maxDrawdown, pl);

    // Check for exit conditions based on new metrics
    const shouldExit = await this.checkExitConditions(position, token);
    if (shouldExit) {
      await this.closePosition(mint, currentPrice);
      return;
    }

    // Check for partial exit conditions
    const partialExitSize = this.calculatePartialExitSize(position, token);
    if (partialExitSize > 0) {
      await this.closePosition(mint, currentPrice, partialExitSize);
    }

    this.stateManager.updatePosition(position);
  }

  calculatePartialExitSize(position, token) {
    const { metrics } = token;
    
    // Exit 25% if creator starts selling
    if (metrics.earlyTrading?.creatorActivity.sellCount > 0 && position.remainingSize > 0.5) {
      return 0.25;
    }

    // Exit 50% if suspicious trading patterns increase significantly
    if (metrics.earlyTrading?.tradingPatterns.rapidTraders.size > 
        position.metrics.tradingPatterns.rapidTraders.size * 2) {
      return 0.5;
    }

    // Exit 25% if buy pressure decreases significantly
    if (metrics.earlyTrading?.buyPressure.current < 
        position.metrics.buyPressure.current * 0.7) {
      return 0.25;
    }

    return 0;
  }

  async checkExitConditions(position, token) {
    const { metrics } = token;
    
    // Immediate exit conditions
    if (
      // Creator dumping
      metrics.earlyTrading?.creatorActivity.sellVolume > position.size * 0.5 ||
      // Severe decline in buy pressure
      metrics.earlyTrading?.buyPressure.current < position.metrics.buyPressure.current * 0.5 ||
      // Massive increase in suspicious trading
      metrics.earlyTrading?.tradingPatterns.rapidTraders.size > position.metrics.tradingPatterns.rapidTraders.size * 3
    ) {
      return true;
    }

    // State-based exit conditions
    switch (position.entryState) {
      case 'ACCUMULATION':
        // Exit if accumulation phase fails
        if (metrics.earlyTrading?.buyPressure.current < config.SAFETY.MIN_BUY_PRESSURE) {
          return true;
        }
        break;
      
      case 'LAUNCHING':
        // Exit if launch momentum fails
        if (metrics.earlyTrading?.volumeAcceleration < config.SAFETY.MIN_VOLUME_ACCELERATION) {
          return true;
        }
        break;
      
      case 'PUMPING':
        // Exit if pump momentum dies
        if (metrics.earlyTrading?.buyPressure.current < position.metrics.buyPressure.current * 0.6) {
          return true;
        }
        break;
    }

    return false;
  }

  async closePosition(mint, exitPrice, portion = 1.0) {
    const position = this.stateManager.getPosition(mint);
    if (!position) {
      console.error(`Cannot close position: Position not found for ${mint}`);
      return null;
    }

    // Use current price from position if no exit price provided
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
    const profitLoss = (priceDiff / position.entryPrice) * 100;
    const profitLossAmount = (priceDiff / position.entryPrice) * sizeToClose;
    
    this.wallet.updateBalance(sizeToClose + profitLossAmount);
    this.wallet.recordTrade(profitLoss > 0 ? 1 : -1);

    // Emit trade event with complete information
    this.emit('trade', {
      type: portion === 1.0 ? 'CLOSE' : 'PARTIAL',
      mint,
      profitLoss,
      symbol: position.symbol || mint.slice(0, 8),
      timestamp: Date.now()
    });

    if (portion === 1.0) {
      if (profitLoss > 0) this.wins++;
      else if (profitLoss < 0) this.losses++;
      
      const closedPosition = this.stateManager.closePosition(mint);
      if (!closedPosition) {
        console.error(`Failed to close position for ${mint}`);
        return null;
      }
      return closedPosition;
    } else {
      const updatedPosition = this.stateManager.recordPartialExit(mint, {
        portion,
        remainingSize: position.remainingSize - portion,
        exitPrice: executionPrice,
        profitLoss
      });
      if (!updatedPosition) {
        console.error(`Failed to record partial exit for ${mint}`);
        return null;
      }
      return updatedPosition;
    }
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
