const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const Trader = require('./Trader');
const config = require('../../utils/config');

class TraderManager extends EventEmitter {
  constructor() {
    super();
    this.traders = new Map();
    this.traderGroups = new Map(); // Groups of related traders
    this.stateFile = path.join(process.cwd(), 'data', 'traders.json');
    
    // Ensure data directory exists
    this.ensureDataDirectory();
    
    // Load existing trader data
    this.loadTraders();
    
    // Don't set up intervals in test mode
    if (process.env.NODE_ENV !== 'test') {
      // Set up periodic state persistence
      this.saveInterval = setInterval(() => this.saveTraders(), config.TRADER.SAVE_INTERVAL || 60000);
      
      // Set up periodic pattern analysis
      this.analysisInterval = setInterval(() => this.analyzeGlobalPatterns(), config.TRADER.ANALYSIS_INTERVAL || 300000);
      
      // Recovery pattern analysis
      this.recoveryInterval = setInterval(() => this.analyzeRecoveryPatterns(), config.TRADER.RECOVERY_ANALYSIS_INTERVAL || 60000);
    }
    
    // Track top recovery traders
    this.topRecoveryTraders = {
      byWinRate: [],
      byVolume: [],
      byAccumulationAccuracy: [],
      byExpansionAccuracy: []
    };
  }

  ensureDataDirectory() {
    const dataDir = path.dirname(this.stateFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  loadTraders() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const data = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
        
        // Reconstruct trader instances
        data.traders.forEach(traderData => {
          const trader = new Trader(traderData.publicKey, traderData.isCreator);
          
          // Restore trader state
          trader.firstSeen = traderData.firstSeen;
          trader.lastActive = traderData.lastActive;
          trader.reputation = traderData.reputation;
          trader.patterns = traderData.patterns;
          
          // Restore maps
          traderData.tokenBalances.forEach(([mint, balance]) => {
            trader.tokenBalances.set(mint, balance);
          });
          traderData.relationships.forEach(([key, frequency]) => {
            trader.commonTraders.set(key, frequency);
          });

          // Set up event listeners
          this.setupTraderEventListeners(trader);
          
          this.traders.set(trader.publicKey, trader);
        });

        // Restore trader groups
        if (data.traderGroups) {
          data.traderGroups.forEach(group => {
            this.traderGroups.set(group.id, group);
          });
        }

        console.log(`Loaded ${this.traders.size} traders and ${this.traderGroups.size} groups`);
      }
    } catch (error) {
      console.error('Error loading traders:', error);
    }
  }

  saveTraders() {
    try {
      const data = {
        traders: Array.from(this.traders.values()).map(trader => trader.toJSON()),
        traderGroups: Array.from(this.traderGroups.values()),
        lastSaved: new Date().toISOString()
      };
      fs.writeFileSync(this.stateFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error saving traders:', error);
    }
  }

  getOrCreateTrader(publicKey, isCreator = false) {
    let trader = this.traders.get(publicKey);
    
    if (!trader) {
      trader = new Trader(publicKey, isCreator);
      trader.firstSeen = Date.now(); // Set first seen time
      this.setupTraderEventListeners(trader);
      this.traders.set(publicKey, trader);
      
      // Emit events for new trader
      this.emit('newTrader', trader);
      this.emit('subscribeTrader', { publicKey }); // Emit event to subscribe to trader's trades
    }
    
    return trader;
  }

  setupTraderEventListeners(trader) {
    trader.on('washTradingDetected', (data) => {
      this.emit('washTradingDetected', data);
      this.updateTraderGroups(data.trader, data.trade.otherParty, 'wash_trading');
    });

    trader.on('frequentTraderRelationship', (data) => {
      this.emit('frequentTraderRelationship', data);
      this.updateTraderGroups(data.trader, data.otherParty, 'frequent_trading');
    });

    trader.on('trade', (data) => {
      this.emit('trade', data);
      this.analyzeTradePatterns(data);
    });
  }

  updateTraderGroups(trader1, trader2PublicKey, reason) {
    const trader2 = this.traders.get(trader2PublicKey);
    if (!trader2) return;

    // Look for existing group containing either trader
    let group = this.findTraderGroup(trader1.publicKey) || this.findTraderGroup(trader2.publicKey);

    if (group) {
      // Add the other trader to existing group if not present
      if (!group.members.includes(trader1.publicKey)) {
        group.members.push(trader1.publicKey);
      }
      if (!group.members.includes(trader2PublicKey)) {
        group.members.push(trader2PublicKey);
      }
      group.lastActivity = Date.now();
      group.patterns.push({ type: reason, timestamp: Date.now() });
    } else {
      // Create new group
      group = {
        id: `group_${Date.now()}`,
        members: [trader1.publicKey, trader2PublicKey],
        created: Date.now(),
        lastActivity: Date.now(),
        patterns: [{ type: reason, timestamp: Date.now() }],
        riskScore: this.calculateGroupRiskScore([trader1, trader2])
      };
      this.traderGroups.set(group.id, group);
    }

    this.emit('traderGroupUpdated', group);
  }

  findTraderGroup(publicKey) {
    return Array.from(this.traderGroups.values())
      .find(group => group.members.includes(publicKey));
  }

  calculateGroupRiskScore(traders) {
    const avgReputation = traders.reduce((sum, t) => sum + t.reputation.score, 0) / traders.length;
    const washTradingIncidents = traders.reduce((sum, t) => sum + t.reputation.washTradingIncidents, 0);
    const rugPullInvolvements = traders.reduce((sum, t) => sum + t.reputation.rugPullInvolvements, 0);

    let riskScore = 100 - (100 - avgReputation); // Start with inverse of avg reputation
    riskScore += washTradingIncidents * 10; // Increase risk for wash trading
    riskScore += rugPullInvolvements * 20; // Increase risk for rug pull involvement

    return Math.min(100, Math.max(0, riskScore));
  }

  analyzeTradePatterns(tradeData) {
    const { trader, trade } = tradeData;
    const token = trade.mint;
    
    // Get all trades for this token in the last 5 minutes
    const recentTrades = Array.from(this.traders.values())
      .flatMap(t => t.tradeHistory['5m'])
      .filter(t => t.mint === token);

    // Look for coordinated buying/selling
    const buyCount = recentTrades.filter(t => t.type === 'buy').length;
    const sellCount = recentTrades.filter(t => t.type === 'sell').length;
    const tradeRatio = buyCount / (buyCount + sellCount);

    // If there's significant one-sided trading, analyze the traders involved
    if (tradeRatio > 0.8 || tradeRatio < 0.2) {
      const tradersInvolved = new Set(recentTrades.map(t => t.trader));
      if (tradersInvolved.size >= config.TRADER.COORDINATION_THRESHOLD) {
        this.emit('coordinatedTrading', {
          token,
          tradersInvolved: Array.from(tradersInvolved),
          tradeRatio,
          timestamp: Date.now()
        });
      }
    }
  }

  analyzeGlobalPatterns() {
    // Analyze trader groups for suspicious patterns
    for (const group of this.traderGroups.values()) {
      const recentPatterns = group.patterns
        .filter(p => Date.now() - p.timestamp < 30 * 60 * 1000); // Last 30 minutes

      if (recentPatterns.length >= config.TRADER.SUSPICIOUS_PATTERN_THRESHOLD) {
        this.emit('suspiciousGroupActivity', {
          group,
          recentPatterns,
          timestamp: Date.now()
        });
      }
    }

    // Clean up old groups
    this.cleanupInactiveGroups();
  }

  cleanupInactiveGroups() {
    const now = Date.now();
    for (const [id, group] of this.traderGroups) {
      if (now - group.lastActivity > config.TRADER.GROUP_CLEANUP_THRESHOLD) {
        this.traderGroups.delete(id);
      }
    }
  }

  getTraderStats(publicKey) {
    const trader = this.traders.get(publicKey);
    if (!trader) return null;

    return {
      ...trader.getReputationScore(),
      group: this.findTraderGroup(publicKey),
      tradeStats: trader.getTradeStats()
    };
  }

  getHighRiskTraders() {
    return Array.from(this.traders.values())
      .filter(trader => trader.calculateRiskLevel() === 'HIGH_RISK');
  }

  getActiveTraderCount() {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    return Array.from(this.traders.values())
      .filter(trader => trader.lastActive > fiveMinutesAgo)
      .length;
  }

  getTraders() {
    return Array.from(this.traders.values());
  }

  getTrader(publicKey) {
    return this.traders.get(publicKey);
  }

  getHolderCountForToken(mint) {
    let count = 0;
    for (const trader of this.traders.values()) {
      const balance = trader.tokenBalances.get(mint);
      if (balance && balance.balance > 0) {
        count++;
      }
    }
    return count;
  }

  getTotalTokensHeldForToken(mint) {
    let total = 0;
    for (const trader of this.traders.values()) {
      const balance = trader.tokenBalances.get(mint);
      if (balance && balance.balance > 0) {
        total += balance.balance;
      }
    }
    return total;
  }

  getTradesInTimeWindow(mint, timeWindow) {
    const now = Date.now();
    const cutoff = now - timeWindow;
    const trades = [];

    // Collect trades from all traders
    for (const trader of this.traders.values()) {
      const traderTrades = trader.tradeHistory.all.filter(
        trade => trade.mint === mint && trade.timestamp > cutoff
      );
      trades.push(...traderTrades);
    }

    // Sort by timestamp
    return trades.sort((a, b) => a.timestamp - b.timestamp);
  }

  getTotalVolumeInTimeWindow(mint, startTime, endTime) {
    let totalVolume = 0;
    
    // Iterate through all traders
    for (const trader of this.traders.values()) {
      const trades = trader.tradeHistory.all.filter(trade => 
        trade.mint === mint && 
        trade.timestamp >= startTime && 
        trade.timestamp <= endTime
      );
      trades.forEach(trade => {
        totalVolume += trade.amount;
      });
    }
    
    return totalVolume;
  }

  cleanupOldTrades(cutoffTime) {
    this.getTraders().forEach(trader => {
      trader.tradeHistory.all = trader.tradeHistory.all.filter(t => t.timestamp > cutoffTime);
      trader.tradeHistory['1m'] = trader.tradeHistory['1m'].filter(t => t.timestamp > cutoffTime - 60000);
      trader.tradeHistory['5m'] = trader.tradeHistory['5m'].filter(t => t.timestamp > cutoffTime - 300000);
      trader.tradeHistory['30m'] = trader.tradeHistory['30m'].filter(t => t.timestamp > cutoffTime - 1800000);
    });
  }

  getRepeatPumpParticipants(pumpTimes, minParticipation = 2) {
    if (!pumpTimes || !Array.isArray(pumpTimes)) {
      return [];
    }

    // Create a map to track trader participation in pumps
    const participationCount = new Map();
    const repeatParticipants = new Set();

    // Go through each pump time and find traders who were active
    pumpTimes.forEach(pumpTime => {
      // Look at trades within 5 minutes of pump
      const startTime = pumpTime - (5 * 60 * 1000);
      const endTime = pumpTime + (5 * 60 * 1000);

      // Find traders active during this pump
      this.traders.forEach(trader => {
        const wasActive = trader.tradeHistory.all.some(trade => {
          const tradeTime = trade.timestamp;
          return tradeTime >= startTime && tradeTime <= endTime;
        });

        if (wasActive) {
          const count = (participationCount.get(trader.publicKey) || 0) + 1;
          participationCount.set(trader.publicKey, count);

          // If trader has participated in multiple pumps, add to repeat participants
          if (count >= minParticipation) {
            repeatParticipants.add(trader.publicKey);
          }
        }
      });
    });

    return Array.from(repeatParticipants);
  }

  getUniqueTraderCount(token) {
    return Array.from(this.traders.values())
      .filter(trader => trader.tokenBalances.has(token.mint))
      .length;
  }

  getTokenTraderStats(mint, cutoffTime) {
    const stats = {
      totalVolume: 0,
      uniqueTraders: 0,
      traderStats: {},
    };

    // Get all traders who have traded this token
    const tradersForToken = Array.from(this.traders.values()).filter(trader => 
      trader.tradeHistory.all.some(trade => trade.mint === mint)
    );

    stats.uniqueTraders = tradersForToken.length;

    // Process each trader's stats
    tradersForToken.forEach(trader => {
      const relevantTrades = trader.tradeHistory.all.filter(trade => 
        trade.mint === mint && trade.timestamp >= cutoffTime
      );

      if (relevantTrades.length === 0) return;

      const traderStats = {
        volumeTotal: 0,
        buyVolume: 0,
        sellVolume: 0,
        tradeCount: relevantTrades.length,
        lastTradeTime: 0,
        averageTradeSize: 0
      };

      // Calculate volumes and other metrics
      relevantTrades.forEach(trade => {
        const volume = trade.amount * trade.price;
        traderStats.volumeTotal += volume;
        
        if (trade.type === 'buy') {
          traderStats.buyVolume += volume;
        } else {
          traderStats.sellVolume += volume;
        }

        traderStats.lastTradeTime = Math.max(traderStats.lastTradeTime, trade.timestamp);
      });

      // Calculate average trade size
      traderStats.averageTradeSize = traderStats.volumeTotal / traderStats.tradeCount;

      // Add to total volume
      stats.totalVolume += traderStats.volumeTotal;

      // Store trader stats
      stats.traderStats[trader.publicKey] = traderStats;
    });

    return stats;
  }

  cleanup() {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
    }
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
    }
    this.removeAllListeners();
  }

  async analyzeTrader(trader) {
    const { SAFETY } = config;
    
    try {
      // Get trader metrics
      const metrics = await trader.getMetrics();
      
      // Check volume and trade count
      if (metrics.totalVolume < SAFETY.MARKET.MIN_TRADES ||
          metrics.tradeCount < SAFETY.MARKET.MIN_TRADES) {
        return false;
      }

      // Check wash trading
      const washTradePercent = (metrics.washTrades / metrics.tradeCount) * 100;
      if (washTradePercent > SAFETY.MARKET.MAX_WASH) {
        return false;
      }

      // Check market correlation
      if (metrics.volumePriceCorrelation < SAFETY.MARKET.MIN_CORRELATION) {
        return false;
      }

      return true;
    } catch (error) {
      console.error('Failed to analyze trader:', error);
      return false;
    }
  }

  analyzeRecoveryPatterns() {
    const recoveryTraders = Array.from(this.traders.values())
      .filter(trader => trader.recoveryMetrics.totalRecoveryTrades > 0);
    
    if (recoveryTraders.length === 0) return;
    
    // Update top traders lists
    this.topRecoveryTraders = {
      byWinRate: recoveryTraders
        .sort((a, b) => b.recoveryMetrics.recoveryWinRate - a.recoveryMetrics.recoveryWinRate)
        .slice(0, 10),
        
      byVolume: recoveryTraders
        .sort((a, b) => b.recoveryMetrics.totalRecoveryTrades - a.recoveryMetrics.totalRecoveryTrades)
        .slice(0, 10),
        
      byAccumulationAccuracy: recoveryTraders
        .sort((a, b) => b.recoveryMetrics.accumulationAccuracy - a.recoveryMetrics.accumulationAccuracy)
        .slice(0, 10),
        
      byExpansionAccuracy: recoveryTraders
        .sort((a, b) => b.recoveryMetrics.expansionAccuracy - a.recoveryMetrics.expansionAccuracy)
        .slice(0, 10)
    };
    
    // Analyze recovery trading patterns
    for (const trader of recoveryTraders) {
      this.analyzeTraderRecoveryStyle(trader);
    }
    
    // Emit recovery analysis update
    this.emit('recoveryAnalysisUpdated', {
      topTraders: this.topRecoveryTraders,
      timestamp: Date.now()
    });
  }
  
  analyzeTraderRecoveryStyle(trader) {
    const {
      earlyAccumulator,
      trendFollower,
      breakoutTrader
    } = trader.patterns.recovery.recoveryStyle;
    
    // Calculate dominant style
    const styles = [
      { name: 'accumulator', score: earlyAccumulator },
      { name: 'trendFollower', score: trendFollower },
      { name: 'breakoutTrader', score: breakoutTrader }
    ];
    
    const dominantStyle = styles.reduce((prev, current) => 
      (current.score > prev.score) ? current : prev
    );
    
    // Calculate style effectiveness
    const styleEffectiveness = {
      accumulator: trader.recoveryMetrics.accumulationAccuracy,
      trendFollower: trader.recoveryMetrics.expansionAccuracy,
      breakoutTrader: trader.recoveryMetrics.recoveryWinRate
    };
    
    // Emit trader style analysis
    this.emit('traderRecoveryStyleAnalyzed', {
      trader,
      dominantStyle: dominantStyle.name,
      effectiveness: styleEffectiveness,
      timestamp: Date.now()
    });
  }
  
  getTopRecoveryTraders(category = 'byWinRate', limit = 10) {
    if (!this.topRecoveryTraders[category]) {
      throw new Error(`Invalid category: ${category}`);
    }
    return this.topRecoveryTraders[category].slice(0, limit);
  }
  
  getTraderRecoveryStats(publicKey) {
    const trader = this.traders.get(publicKey);
    if (!trader) return null;
    
    return {
      metrics: trader.recoveryMetrics,
      patterns: trader.patterns.recovery,
      ranking: {
        byWinRate: this.topRecoveryTraders.byWinRate.findIndex(t => t.publicKey === publicKey),
        byVolume: this.topRecoveryTraders.byVolume.findIndex(t => t.publicKey === publicKey),
        byAccumulationAccuracy: this.topRecoveryTraders.byAccumulationAccuracy.findIndex(t => t.publicKey === publicKey),
        byExpansionAccuracy: this.topRecoveryTraders.byExpansionAccuracy.findIndex(t => t.publicKey === publicKey)
      }
    };
  }

  recordTrade(trade) {
    try {
      const { mint, type, amount, price, timestamp = Date.now(), trader: publicKey, newBalance } = trade;

      // Get or create trader
      let trader = this.getOrCreateTrader(publicKey);

      // Record the trade
      const success = trader.recordTrade({
        mint,
        type,
        amount,
        price,
        timestamp,
        newBalance
      });

      if (success) {
        // Update trader groups
        this.updateTraderGroups(trader, trade);

        // Analyze patterns
        this.analyzeTraderPatterns(trader, trade);

        // Emit trade event
        this.emit('tradeRecorded', { trader, trade });
      }

      return success;
    } catch (error) {
      console.error('Error in TraderManager.recordTrade:', error);
      return false;
    }
  }

  updateTraderGroups(trader, trade) {
    const { mint, type, amount } = trade;

    // Get or create group for this token
    let group = this.traderGroups.get(mint) || {
      traders: new Set(),
      totalVolume: 0,
      lastTrade: null,
      tradeCount: 0
    };

    // Update group metrics
    group.traders.add(trader.publicKey);
    group.totalVolume += amount;
    group.lastTrade = Date.now();
    group.tradeCount++;

    // Calculate group velocity (trades per minute)
    const timeWindow = 5 * 60 * 1000; // 5 minutes
    const recentTrades = Array.from(group.traders)
      .map(pk => this.traders.get(pk))
      .flatMap(t => t.tradeHistory['5m'])
      .filter(t => t.mint === mint);

    group.velocity = recentTrades.length / (timeWindow / (60 * 1000));

    this.traderGroups.set(mint, group);
  }

  analyzeTraderPatterns(trader, trade) {
    const { mint, type, amount, price } = trade;
    const group = this.traderGroups.get(mint);

    if (!group) return;

    // Analyze group concentration
    const concentration = amount / group.totalVolume;
    if (concentration > 0.1) { // If trader controls more than 10% of volume
      this.emit('highConcentration', {
        trader,
        mint,
        concentration
      });
    }

    // Analyze trading velocity
    if (group.velocity > 10) { // More than 10 trades per minute
      this.emit('highVelocity', {
        mint,
        velocity: group.velocity
      });
    }

    // Update top traders lists
    this.updateTopTraders(trader);
  }

  updateTopTraders(trader) {
    const rep = trader.reputation;
    const winRate = rep.totalTrades > 0 ? (rep.profitableTrades / rep.totalTrades) * 100 : 0;

    // Update by win rate
    this.updateTopTradersList('byWinRate', trader, winRate);

    // Update by volume
    const totalVolume = Array.from(trader.tokenBalances.values())
      .reduce((sum, { balance }) => sum + balance, 0);
    this.updateTopTradersList('byVolume', trader, totalVolume);

    // Emit top traders update
    this.emit('topTradersUpdated', {
      byWinRate: this.topRecoveryTraders.byWinRate,
      byVolume: this.topRecoveryTraders.byVolume
    });
  }

  updateTopTradersList(category, trader, value) {
    const list = this.topRecoveryTraders[category];
    const existingIndex = list.findIndex(t => t.trader.publicKey === trader.publicKey);

    if (existingIndex !== -1) {
      list[existingIndex] = { trader, value };
    } else {
      list.push({ trader, value });
    }

    // Sort and limit to top 10
    list.sort((a, b) => b.value - a.value);
    this.topRecoveryTraders[category] = list.slice(0, 10);
  }

  handleTrade({ mint, traderPublicKey, type, amount, newBalance, price, timestamp }) {
    try {
      // Get or create trader
      const trader = this.getOrCreateTrader(traderPublicKey);

      // Update trader's token balance
      trader.updateTokenBalance(mint, newBalance, timestamp);

      // Record trade in trader's history
      trader.recordTrade({
        mint,
        type,
        amount,
        price,
        timestamp,
        newBalance
      });

      // Update trader metrics
      trader.updateMetrics();

      // Emit trader update event
      this.emit('traderUpdated', {
        trader,
        mint,
        type,
        amount,
        newBalance
      });

    } catch (error) {
      console.error('Error handling trade in TraderManager:', error);
      errorLogger.logError(error, 'TraderManager.handleTrade', {
        mint,
        traderPublicKey,
        type,
        amount,
        newBalance
      });
    }
  }

  getTopHoldersForToken(tokenMint, limit = 10) {
    const holders = [];
    for (const [publicKey, trader] of this.traders) {
      const tokenBalance = trader.getTokenBalance(tokenMint);
      if (tokenBalance > 0) {
        holders.push({
          publicKey,
          balance: tokenBalance
        });
      }
    }

    // Sort by balance in descending order and take top N
    return holders
      .sort((a, b) => b.balance - a.balance)
      .slice(0, limit);
  }

}

module.exports = TraderManager;
