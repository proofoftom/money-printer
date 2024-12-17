const EventEmitter = require('events');
const config = require('../../utils/config');

class Trader extends EventEmitter {
  constructor(publicKey, isCreator = false) {
    super();
    this.publicKey = publicKey;
    this.isCreator = isCreator;
    this.firstSeen = Date.now();
    this.lastActive = Date.now();
    
    // Track balances per token
    this.tokenBalances = new Map(); // mint -> { balance, initialBalance }
    
    // Trading history with time windows
    this.tradeHistory = {
      all: [],
      '1m': [],
      '5m': [],
      '30m': []
    };

    // Reputation and scoring
    this.reputation = {
      score: 100, // Base score
      washTradingIncidents: 0,
      rugPullInvolvements: 0,
      successfulPumps: 0,
      failedPumps: 0,
      averageHoldTime: 0,
      totalTrades: 0,
      profitableTrades: 0
    };

    // Relationship tracking
    this.commonTraders = new Map(); // publicKey -> frequency of trading together
    
    // Pattern detection state
    this.patterns = {
      washTrading: {
        suspiciousTransactions: [],
        lastWarning: null
      },
      pumpAndDump: {
        participations: [],
        coordinationScore: 0
      },
      tradingBehavior: {
        buyToSellRatio: 1,
        averageTradeSize: 0,
        tradeFrequency: 0
      },
      recovery: {
        successfulRecoveries: 0,
        failedRecoveries: 0,
        avgRecoveryGain: 0,
        recoveryTrades: [],
        lastRecoveryTrade: null,
        recoveryStyle: {
          earlyAccumulator: 0,    // Score for buying during accumulation
          trendFollower: 0,       // Score for buying during expansion
          breakoutTrader: 0       // Score for buying at recovery confirmation
        }
      }
    };

    // Recovery-specific metrics
    this.recoveryMetrics = {
      totalRecoveryTrades: 0,
      profitableRecoveries: 0,
      averageRecoveryHoldTime: 0,
      bestRecoveryGain: 0,
      accumulationAccuracy: 0,    // Success rate of accumulation phase entries
      expansionAccuracy: 0,       // Success rate of expansion phase entries
      averageRecoverySize: 0,     // Average position size in recoveries
      recoveryWinRate: 0          // Overall recovery trade success rate
    };
  }

  recordTrade(trade, token) {
    // Ensure token is properly initialized
    if (!token || typeof token !== 'object') {
      console.warn('Invalid token object provided to recordTrade');
      return;
    }

    const {
      mint,
      amount,
      price,
      type, // 'buy' or 'sell'
      timestamp = Date.now(),
      otherParty // public key of counter-party
    } = trade;

    const tradeData = {
      mint,
      amount,
      price,
      type,
      timestamp,
      otherParty
    };

    // Update last active
    this.lastActive = timestamp;

    // Update token balance
    this.updateTokenBalance(mint, amount, type);

    // Update trading history
    this.tradeHistory.all.push(tradeData);
    this.updateTimeWindowedHistory(tradeData);
    this.updateTradingPatterns(tradeData);

    // Check for wash trading
    if (this.detectWashTrading(tradeData)) {
      this.reputation.washTradingIncidents++;
      this.reputation.score = Math.max(0, this.reputation.score - 5);
      this.emit('washTradingDetected', { trader: this, trade: tradeData });
    }

    // Update relationships
    if (otherParty) {
      this.updateTraderRelationship(otherParty);
    }

    // Analyze recovery patterns if token has a valid state and is in recovery-related state
    if (token.state && (token.state === 'drawdown' || token.state === 'recovery')) {
      this.analyzeRecoveryPattern(tradeData, token);
    }
    
    // Update recovery metrics for completed trades
    if (trade.type === 'SELL' || trade.type === 'PARTIAL_SELL') {
      this.updateRecoveryMetrics(tradeData, token, trade.profitLoss);
    }

    // Emit trade event
    this.emit('trade', { trader: this, trade: tradeData });
  }

  updateTokenBalance(mint, amount, type) {
    let balance = this.tokenBalances.get(mint) || { balance: 0, initialBalance: 0 };
    
    if (type === 'buy') {
      balance.balance += amount;
      if (!this.tokenBalances.has(mint)) {
        balance.initialBalance = amount;
      }
    } else if (type === 'sell') {
      balance.balance -= amount;
    }

    this.tokenBalances.set(mint, balance);
  }

  updateTimeWindowedHistory(trade) {
    const now = Date.now();
    const windows = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '30m': 30 * 60 * 1000
    };

    // Update each time window
    for (const [window, duration] of Object.entries(windows)) {
      // Remove old trades
      this.tradeHistory[window] = this.tradeHistory[window]
        .filter(t => now - t.timestamp < duration);
      
      // Add new trade
      this.tradeHistory[window].push(trade);
    }
  }

  updateTradingPatterns(trade) {
    const patterns = this.patterns.tradingBehavior;
    const recentTrades = this.tradeHistory['5m'];
    
    // Update buy/sell ratio
    const buys = recentTrades.filter(t => t.type === 'buy').length;
    const sells = recentTrades.filter(t => t.type === 'sell').length;
    patterns.buyToSellRatio = sells > 0 ? buys / sells : buys;

    // Update average trade size
    patterns.averageTradeSize = recentTrades.reduce((sum, t) => sum + t.amount, 0) / recentTrades.length;

    // Update trade frequency (trades per minute)
    patterns.tradeFrequency = recentTrades.length / 5; // 5-minute window
  }

  detectWashTrading(trade) {
    const recentTrades = this.tradeHistory['1m'];
    const suspiciousPatterns = recentTrades.filter(t => 
      t.otherParty === trade.otherParty && 
      t.type !== trade.type &&
      Math.abs(t.amount - trade.amount) / trade.amount < 0.1 // Within 10% of each other
    );

    if (suspiciousPatterns.length > 0) {
      this.patterns.washTrading.suspiciousTransactions.push({
        trade,
        relatedTrades: suspiciousPatterns,
        timestamp: Date.now()
      });
      return true;
    }
    return false;
  }

  updateTraderRelationship(otherPartyKey) {
    const frequency = this.commonTraders.get(otherPartyKey) || 0;
    this.commonTraders.set(otherPartyKey, frequency + 1);

    // Emit event if frequency crosses threshold
    if ((frequency + 1) >= config.TRADER.RELATIONSHIP_THRESHOLD) {
      this.emit('frequentTraderRelationship', {
        trader: this,
        otherParty: otherPartyKey,
        frequency: frequency + 1
      });
    }
  }

  analyzeRecoveryPattern(trade, token) {
    if (!token.recoveryMetrics) return;
    
    const {
      recoveryPhase,
      recoveryStrength,
      accumulationScore,
      marketStructure
    } = token.recoveryMetrics;
    
    // Track recovery trade
    this.patterns.recovery.recoveryTrades.push({
      mint: token.mint,
      phase: recoveryPhase,
      strength: recoveryStrength,
      price: trade.price,
      size: trade.size,
      timestamp: Date.now()
    });
    
    // Update recovery style scores
    if (trade.type === 'BUY') {
      switch (recoveryPhase) {
        case 'accumulation':
          this.patterns.recovery.recoveryStyle.earlyAccumulator += 
            accumulationScore > 0.7 ? 1 : 0;
          break;
          
        case 'expansion':
          this.patterns.recovery.recoveryStyle.trendFollower +=
            marketStructure === 'bullish' ? 1 : 0;
          break;
          
        case 'distribution':
          // Penalize buying in distribution
          this.patterns.recovery.recoveryStyle.breakoutTrader -= 0.5;
          break;
      }
    }
    
    this.patterns.recovery.lastRecoveryTrade = {
      phase: recoveryPhase,
      strength: recoveryStrength,
      timestamp: Date.now()
    };
  }

  updateRecoveryMetrics(trade, token, profitLoss) {
    if (!token.recoveryMetrics) return;
    
    this.recoveryMetrics.totalRecoveryTrades++;
    
    if (profitLoss > 0) {
      this.recoveryMetrics.profitableRecoveries++;
      this.patterns.recovery.successfulRecoveries++;
      
      // Update best gain
      if (profitLoss > this.recoveryMetrics.bestRecoveryGain) {
        this.recoveryMetrics.bestRecoveryGain = profitLoss;
      }
    } else {
      this.patterns.recovery.failedRecoveries++;
    }
    
    // Update averages
    this.recoveryMetrics.recoveryWinRate = 
      this.recoveryMetrics.profitableRecoveries / this.recoveryMetrics.totalRecoveryTrades;
    
    this.recoveryMetrics.averageRecoverySize = 
      (this.recoveryMetrics.averageRecoverySize * (this.recoveryMetrics.totalRecoveryTrades - 1) + trade.size) / 
      this.recoveryMetrics.totalRecoveryTrades;
    
    // Update phase-specific accuracy
    if (token.recoveryMetrics.recoveryPhase === 'accumulation') {
      this.recoveryMetrics.accumulationAccuracy = 
        (this.patterns.recovery.recoveryStyle.earlyAccumulator / this.recoveryMetrics.totalRecoveryTrades) * 100;
    } else if (token.recoveryMetrics.recoveryPhase === 'expansion') {
      this.recoveryMetrics.expansionAccuracy = 
        (this.patterns.recovery.recoveryStyle.trendFollower / this.recoveryMetrics.totalRecoveryTrades) * 100;
    }
    
    // Update average recovery gain
    this.patterns.recovery.avgRecoveryGain = 
      (this.patterns.recovery.avgRecoveryGain * (this.recoveryMetrics.totalRecoveryTrades - 1) + profitLoss) / 
      this.recoveryMetrics.totalRecoveryTrades;
  }

  getTradeStats(timeWindow = '5m') {
    const trades = this.tradeHistory[timeWindow];
    const totalTrades = trades.length;
    
    if (totalTrades === 0) return null;

    return {
      totalTrades,
      buyCount: trades.filter(t => t.type === 'buy').length,
      sellCount: trades.filter(t => t.type === 'sell').length,
      averageTradeSize: trades.reduce((sum, t) => sum + t.amount, 0) / totalTrades,
      uniqueTokens: new Set(trades.map(t => t.mint)).size,
      patterns: this.patterns.tradingBehavior
    };
  }

  getReputationScore() {
    return {
      overall: this.reputation.score,
      details: {
        ...this.reputation,
        riskLevel: this.calculateRiskLevel()
      }
    };
  }

  calculateRiskLevel() {
    if (this.reputation.score < 30) return 'HIGH_RISK';
    if (this.reputation.score < 70) return 'MEDIUM_RISK';
    return 'LOW_RISK';
  }

  getTradesForToken(mint, cutoffTime) {
    return this.tradeHistory.all.filter(trade => 
      trade.mint === mint && (!cutoffTime || trade.timestamp > cutoffTime)
    );
  }

  getTradesInTimeWindow(mint, timeWindow) {
    const now = Date.now();
    const cutoff = now - timeWindow;
    return this.getTradesForToken(mint, cutoff);
  }

  getTokenBalance(mint) {
    const balance = this.tokenBalances.get(mint);
    return balance ? balance.balance : 0;
  }

  getInitialTokenBalance(mint) {
    const balance = this.tokenBalances.get(mint);
    return balance ? balance.initialBalance : 0;
  }

  toJSON() {
    return {
      publicKey: this.publicKey,
      isCreator: this.isCreator,
      firstSeen: this.firstSeen,
      lastActive: this.lastActive,
      tokenBalances: Array.from(this.tokenBalances.entries()),
      reputation: this.reputation,
      patterns: this.patterns,
      relationships: Array.from(this.commonTraders.entries())
    };
  }
}

module.exports = Trader;
