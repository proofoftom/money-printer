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
    
    // Set up periodic state persistence
    setInterval(() => this.saveTraders(), config.TRADER.SAVE_INTERVAL || 60000);
    
    // Set up periodic pattern analysis
    setInterval(() => this.analyzeGlobalPatterns(), config.TRADER.ANALYSIS_INTERVAL || 300000);
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
    return this.getTraders().filter(trader => {
      const balance = trader.tokenBalances.get(mint);
      return balance && balance.balance > 0;
    }).length;
  }

  getTotalTokensHeldForToken(mint) {
    return this.getTraders().reduce((sum, trader) => {
      const balance = trader.tokenBalances.get(mint);
      return sum + (balance ? balance.balance : 0);
    }, 0);
  }

  getTopHoldersForToken(mint, count = 10) {
    return this.getTraders()
      .filter(trader => {
        const balance = trader.tokenBalances.get(mint);
        return balance && balance.balance > 0;
      })
      .sort((a, b) => {
        const balanceA = a.tokenBalances.get(mint).balance;
        const balanceB = b.tokenBalances.get(mint).balance;
        return balanceB - balanceA;
      })
      .slice(0, count)
      .map(trader => ({
        address: trader.publicKey,
        balance: trader.tokenBalances.get(mint).balance
      }));
  }

  getTokenTraderStats(mint, cutoffTime) {
    const stats = {
      totalVolume: 0,
      uniqueTraders: 0,
      maxWalletVolumePercentage: 0,
      traderStats: {}
    };

    const activeTraders = this.getTraders().filter(trader => {
      const recentTrades = trader.tradeHistory.all.filter(t => 
        t.mint === mint && t.timestamp > cutoffTime
      );
      return recentTrades.length > 0;
    });

    stats.uniqueTraders = activeTraders.length;

    activeTraders.forEach(trader => {
      const recentTrades = trader.tradeHistory.all.filter(t => 
        t.mint === mint && t.timestamp > cutoffTime
      );

      const traderStat = {
        volumeTotal: 0,
        tradeCount: recentTrades.length,
        buyVolume: 0,
        sellVolume: 0,
        currentBalance: trader.tokenBalances.get(mint)?.balance || 0,
        walletAge: Date.now() - trader.firstSeen
      };

      recentTrades.forEach(trade => {
        const volume = Math.abs(trade.amount * trade.price);
        traderStat.volumeTotal += volume;
        if (trade.type === 'buy') {
          traderStat.buyVolume += volume;
        } else {
          traderStat.sellVolume += volume;
        }
      });

      stats.totalVolume += traderStat.volumeTotal;
      stats.traderStats[trader.publicKey] = traderStat;
    });

    // Calculate max wallet volume percentage
    if (stats.totalVolume > 0) {
      stats.maxWalletVolumePercentage = Math.max(
        ...Object.values(stats.traderStats).map(s => 
          (s.volumeTotal / stats.totalVolume) * 100
        )
      );
    }

    return stats;
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
}

module.exports = TraderManager;
