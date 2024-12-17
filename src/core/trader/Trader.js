const EventEmitter = require("events");
const config = require("../../utils/config");

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
      "1m": [],
      "5m": [],
      "30m": [],
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
      profitableTrades: 0,
    };

    // Relationship tracking
    this.commonTraders = new Map(); // publicKey -> frequency of trading together

    // Pattern detection state
    this.patterns = {
      washTrading: {
        suspiciousTransactions: [],
        lastWarning: null,
      },
      pumpAndDump: {
        participations: [],
        coordinationScore: 0,
      },
      tradingBehavior: {
        buyToSellRatio: 1,
        averageTradeSize: 0,
        tradeFrequency: 0,
      },
      recovery: {
        successfulRecoveries: 0,
        failedRecoveries: 0,
        avgRecoveryGain: 0,
        recoveryTrades: [],
        lastRecoveryTrade: null,
        recoveryStyle: {
          earlyAccumulator: 0, // Score for buying during accumulation
          trendFollower: 0, // Score for buying during expansion
          breakoutTrader: 0, // Score for buying at recovery confirmation
        },
      },
    };

    // Recovery-specific metrics
    this.recoveryMetrics = {
      totalRecoveryTrades: 0,
      profitableRecoveries: 0,
      averageRecoveryHoldTime: 0,
      bestRecoveryGain: 0,
      accumulationAccuracy: 0, // Success rate of accumulation phase entries
      expansionAccuracy: 0, // Success rate of expansion phase entries
      averageRecoverySize: 0, // Average position size in recoveries
      recoveryWinRate: 0, // Overall recovery trade success rate
    };
  }

  // Method to subscribe to token's trade events
  // subscribeToToken(token) {
  //   if (!token) return;

  // token.on('trade', ({ token, trade, metrics }) => {
  //   if (trade.traderPublicKey === this.publicKey) {
  //     this.handleTrade(trade, token, metrics);
  //   }
  // });

  //   token.on('tradeError', ({ token, error, trade }) => {
  //     if (trade.traderPublicKey === this.publicKey) {
  //       console.error(`Trade error for trader ${this.publicKey}:`, error);
  //     }
  //   });
  // }

  handleTrade(trade, token, metrics) {
    // Update last active
    this.lastActive = trade.timestamp;

    // Update token balance
    this.updateTokenBalance(trade.mint, trade.amount, trade.type);

    // Update trading history
    this.tradeHistory.all.push(trade);
    this.updateTimeWindowedHistory(trade);
    this.updateTradingPatterns(trade);

    // Check for wash trading
    if (this.detectWashTrading(trade)) {
      this.reputation.washTradingIncidents++;
      this.reputation.score = Math.max(0, this.reputation.score - 5);
      this.emit("washTradingDetected", { trader: this, trade });
    }

    // Update relationships
    if (trade.otherParty) {
      this.updateTraderRelationship(trade.otherParty);
    }

    // Analyze recovery patterns if token is in recovery state
    if (metrics.recovery && metrics.recovery.phase !== "none") {
      this.analyzeRecoveryPattern(trade, token);

      // Update recovery metrics for completed trades
      if (trade.type === "sell") {
        this.updateRecoveryMetrics(trade, token, trade.pnl);
      }
    }

    // Update reputation metrics
    this.reputation.totalTrades++;
    if (trade.type === "sell" && trade.pnl > 0) {
      this.reputation.profitableTrades++;
    }

    // Emit trader update event
    this.emit("traderUpdated", {
      trader: this,
      trade,
      metrics: {
        profitableTrades: this.reputation.profitableTrades,
        totalTrades: this.reputation.totalTrades,
        winRate:
          this.reputation.totalTrades > 0
            ? (this.reputation.profitableTrades / this.reputation.totalTrades) *
              100
            : 0,
        recoveryMetrics: this.recoveryMetrics,
      },
    });
  }

  recordTrade({ mint, type, amount, price, timestamp, newBalance }) {
    try {
      // Validate trade data
      if (!this.validateTradeData({ mint, type, amount, price, timestamp, newBalance })) {
        console.error('Invalid trade data:', { mint, type, amount, price, timestamp, newBalance });
        return false;
      }

      // Create trade object
      const trade = {
        mint,
        type: type.toUpperCase(),
        amount,
        price,
        timestamp: timestamp || Date.now(),
        balance: newBalance
      };

      // Add trade to history
      this.tradeHistory.all.push(trade);

      // Update time-windowed histories
      this.updateTimeWindowedHistory(trade);

      // Update token balance
      this.updateTokenBalance(mint, newBalance);

      // Update trading patterns
      this.updateTradingBehavior(trade);

      // Emit trade event
      this.emit('trade', { trader: this, trade });

      return true;
    } catch (error) {
      console.error('Error recording trade:', error);
      return false;
    }
  }

  validateTradeData(trade) {
    if (!trade || typeof trade !== 'object') return false;

    // Check required fields exist
    if (!trade.mint || !trade.type || !trade.amount || !trade.price) {
      return false;
    }

    // Validate price
    if (typeof trade.price !== 'number' || trade.price <= 0) {
      return false;
    }

    // Validate amount
    if (typeof trade.amount !== 'number' || trade.amount <= 0) {
      return false;
    }

    // Validate type
    const validTypes = ['BUY', 'SELL', 'buy', 'sell'];
    if (!validTypes.includes(trade.type)) {
      return false;
    }

    return true;
  }

  updateTokenBalance(mint, newBalance, timestamp = Date.now()) {
    const existingBalance = this.tokenBalances.get(mint);

    if (!existingBalance) {
      this.tokenBalances.set(mint, {
        balance: newBalance,
        initialBalance: newBalance,
        firstSeen: timestamp,
        lastUpdated: timestamp,
      });
    } else {
      this.tokenBalances.set(mint, {
        ...existingBalance,
        balance: newBalance,
        lastUpdated: timestamp,
      });
    }
  }

  updateTradingBehavior(trade) {
    const { type, amount, price } = trade;
    const behavior = this.patterns.tradingBehavior;

    // Update buy/sell ratio
    if (type === "BUY") {
      behavior.buyCount = (behavior.buyCount || 0) + 1;
    } else if (type === "SELL") {
      behavior.sellCount = (behavior.sellCount || 0) + 1;
    }
    behavior.buyToSellRatio = behavior.buyCount / (behavior.sellCount || 1);

    // Update average trade size
    behavior.totalTradeSize = (behavior.totalTradeSize || 0) + amount;
    behavior.totalTrades = (behavior.totalTrades || 0) + 1;
    behavior.averageTradeSize = behavior.totalTradeSize / behavior.totalTrades;

    // Update trade frequency
    const now = Date.now();
    behavior.lastTradeTime = behavior.currentTradeTime || now;
    behavior.currentTradeTime = now;

    if (behavior.lastTradeTime) {
      const timeDiff = behavior.currentTradeTime - behavior.lastTradeTime;
      behavior.tradeFrequency = behavior.totalTrades / (timeDiff / (60 * 1000)); // trades per minute
    }

    // Update reputation
    this.updateReputation(trade);
  }

  updateReputation(trade) {
    const rep = this.reputation;
    rep.totalTrades++;

    // Update average hold time if this is a sell
    if (trade.type === "SELL") {
      const tokenHistory = this.tradeHistory.all
        .filter((t) => t.mint === trade.mint)
        .sort((a, b) => a.timestamp - b.timestamp);

      if (tokenHistory.length > 1) {
        const buyTime = tokenHistory[0].timestamp;
        const holdTime = trade.timestamp - buyTime;
        rep.averageHoldTime =
          (rep.averageHoldTime * (rep.totalTrades - 1) + holdTime) /
          rep.totalTrades;
      }
    }

    // Emit reputation update
    this.emit("reputationUpdated", {
      trader: this,
      reputation: rep,
    });
  }

  updateTimeWindowedHistory(trade) {
    const now = Date.now();
    const windows = {
      "1m": 60 * 1000,
      "5m": 5 * 60 * 1000,
      "30m": 30 * 60 * 1000,
    };

    // Update each time window
    for (const [window, duration] of Object.entries(windows)) {
      // Remove old trades
      this.tradeHistory[window] = this.tradeHistory[window].filter(
        (t) => now - t.timestamp < duration
      );

      // Add new trade
      this.tradeHistory[window].push(trade);
    }
  }

  updateTradingPatterns(trade) {
    const patterns = this.patterns.tradingBehavior;
    const recentTrades = this.tradeHistory["5m"];

    // Update buy/sell ratio
    const buys = recentTrades.filter((t) => t.type === "buy").length;
    const sells = recentTrades.filter((t) => t.type === "sell").length;
    patterns.buyToSellRatio = sells > 0 ? buys / sells : buys;

    // Update average trade size
    patterns.averageTradeSize =
      recentTrades.reduce((sum, t) => sum + t.amount, 0) / recentTrades.length;

    // Update trade frequency (trades per minute)
    patterns.tradeFrequency = recentTrades.length / 5; // 5-minute window
  }

  detectWashTrading(trade) {
    const recentTrades = this.tradeHistory["1m"];
    const suspiciousPatterns = recentTrades.filter(
      (t) =>
        t.otherParty === trade.otherParty &&
        t.type !== trade.type &&
        Math.abs(t.amount - trade.amount) / trade.amount < 0.1 // Within 10% of each other
    );

    if (suspiciousPatterns.length > 0) {
      this.patterns.washTrading.suspiciousTransactions.push({
        trade,
        relatedTrades: suspiciousPatterns,
        timestamp: Date.now(),
      });
      return true;
    }
    return false;
  }

  updateTraderRelationship(otherPartyKey) {
    const frequency = this.commonTraders.get(otherPartyKey) || 0;
    this.commonTraders.set(otherPartyKey, frequency + 1);

    // Emit event if frequency crosses threshold
    if (frequency + 1 >= config.TRADER.RELATIONSHIP_THRESHOLD) {
      this.emit("frequentTraderRelationship", {
        trader: this,
        otherParty: otherPartyKey,
        frequency: frequency + 1,
      });
    }
  }

  analyzeRecoveryPattern(trade, token) {
    if (!token.recoveryMetrics) return;

    const {
      recoveryPhase,
      recoveryStrength,
      accumulationScore,
      marketStructure,
    } = token.recoveryMetrics;

    // Track recovery trade
    this.patterns.recovery.recoveryTrades.push({
      mint: token.mint,
      phase: recoveryPhase,
      strength: recoveryStrength,
      price: trade.price,
      size: trade.size,
      timestamp: Date.now(),
    });

    // Update recovery style scores
    if (trade.type === "BUY") {
      switch (recoveryPhase) {
        case "accumulation":
          this.patterns.recovery.recoveryStyle.earlyAccumulator +=
            accumulationScore > 0.7 ? 1 : 0;
          break;

        case "expansion":
          this.patterns.recovery.recoveryStyle.trendFollower +=
            marketStructure === "bullish" ? 1 : 0;
          break;

        case "distribution":
          // Penalize buying in distribution
          this.patterns.recovery.recoveryStyle.breakoutTrader -= 0.5;
          break;
      }
    }

    this.patterns.recovery.lastRecoveryTrade = {
      phase: recoveryPhase,
      strength: recoveryStrength,
      timestamp: Date.now(),
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
      this.recoveryMetrics.profitableRecoveries /
      this.recoveryMetrics.totalRecoveryTrades;

    this.recoveryMetrics.averageRecoverySize =
      (this.recoveryMetrics.averageRecoverySize *
        (this.recoveryMetrics.totalRecoveryTrades - 1) +
        trade.size) /
      this.recoveryMetrics.totalRecoveryTrades;

    // Update phase-specific accuracy
    if (token.recoveryMetrics.recoveryPhase === "accumulation") {
      this.recoveryMetrics.accumulationAccuracy =
        (this.patterns.recovery.recoveryStyle.earlyAccumulator /
          this.recoveryMetrics.totalRecoveryTrades) *
        100;
    } else if (token.recoveryMetrics.recoveryPhase === "expansion") {
      this.recoveryMetrics.expansionAccuracy =
        (this.patterns.recovery.recoveryStyle.trendFollower /
          this.recoveryMetrics.totalRecoveryTrades) *
        100;
    }

    // Update average recovery gain
    this.patterns.recovery.avgRecoveryGain =
      (this.patterns.recovery.avgRecoveryGain *
        (this.recoveryMetrics.totalRecoveryTrades - 1) +
        profitLoss) /
      this.recoveryMetrics.totalRecoveryTrades;
  }

  getTradeStats(timeWindow = "5m") {
    const trades = this.tradeHistory[timeWindow];
    const totalTrades = trades.length;

    if (totalTrades === 0) return null;

    return {
      totalTrades,
      buyCount: trades.filter((t) => t.type === "buy").length,
      sellCount: trades.filter((t) => t.type === "sell").length,
      averageTradeSize:
        trades.reduce((sum, t) => sum + t.amount, 0) / totalTrades,
      uniqueTokens: new Set(trades.map((t) => t.mint)).size,
      patterns: this.patterns.tradingBehavior,
    };
  }

  getReputationScore() {
    return {
      overall: this.reputation.score,
      details: {
        ...this.reputation,
        riskLevel: this.calculateRiskLevel(),
      },
    };
  }

  calculateRiskLevel() {
    if (this.reputation.score < 30) return "HIGH_RISK";
    if (this.reputation.score < 70) return "MEDIUM_RISK";
    return "LOW_RISK";
  }

  getTradesForToken(mint, cutoffTime) {
    return this.tradeHistory.all.filter(
      (trade) =>
        trade.mint === mint && (!cutoffTime || trade.timestamp > cutoffTime)
    );
  }

  getTradesInTimeWindow(mint, timeWindow) {
    const now = Date.now();
    const cutoff = now - timeWindow;
    return this.getTradesForToken(mint, cutoff);
  }

  getTokenBalance(mint) {
    const balanceInfo = this.tokenBalances.get(mint);
    return balanceInfo ? balanceInfo.balance : 0;
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
      relationships: Array.from(this.commonTraders.entries()),
    };
  }
}

module.exports = Trader;
