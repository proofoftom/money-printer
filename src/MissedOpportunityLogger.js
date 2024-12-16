const fs = require('fs');
const path = require('path');
const config = require('./config');

class MissedOpportunityLogger {
  constructor(priceManager, safetyChecker) {
    this.logDir = path.join(process.cwd(), 'logs', 'missed_opportunities');
    this.trackedTokens = new Map(); // Track tokens that failed safety checks
    this.priceManager = priceManager;
    this.safetyChecker = safetyChecker;
    this.ensureLogDirectory();
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  trackToken(token, failedChecks) {
    // Normalize failedChecks to array format
    const checks = Array.isArray(failedChecks) ? failedChecks : [failedChecks];

    // Get trader metrics
    const traderMetrics = token.getTraderMetrics();
    const suspiciousTraders = token.getTraders()
      .filter(trader => this.safetyChecker?.suspiciousTraders.has(trader.publicKey))
      .map(trader => ({
        publicKey: trader.publicKey,
        balance: trader.getTokenBalance(token.mint),
        totalVolume: trader.getTradeHistory(token.mint)
          .reduce((sum, t) => sum + t.amount, 0)
      }));

    const tokenData = {
      mint: token.mint,
      initialPrice: token.currentPrice,
      initialMarketCap: token.marketCapSol,
      createdAt: token.minted,
      failedAt: Date.now(),
      initialMetrics: {
        holders: token.getHolderCount(),
        topHolderConcentration: token.getTopHolderConcentration(),
        creatorHoldings: token.getCreatorSellPercentage(),
        volumeData: token.metrics.volumeData,
        priceVolatility: token.priceVolatility,
        traders: {
          total: traderMetrics.uniqueTraders,
          active: traderMetrics.activeTraders,
          crossToken: traderMetrics.crossTokenTraders,
          suspicious: suspiciousTraders.length,
          whales: traderMetrics.whaleCount,
          topTraders: traderMetrics.topTraders,
          suspiciousTraders
        }
      },
      failedChecks: checks.map(check => ({
        check: typeof check === 'string' ? check : check.name || 'unknown',
        actualValue: check.actual || null,
        threshold: check.threshold || null,
        configPath: check.configPath || null,
        reason: check.reason || null
      })),
      peakData: null,
      finalSnapshot: null,
      potentialProfit: null,
      thresholdAnalysis: null
    };

    this.trackedTokens.set(token.mint, tokenData);
  }

  updateTokenMetrics(token) {
    const trackedToken = this.trackedTokens.get(token.mint);
    if (!trackedToken) return;

    // Get current trader metrics
    const traderMetrics = token.getTraderMetrics();
    const suspiciousTraders = token.getTraders()
      .filter(trader => this.safetyChecker?.suspiciousTraders.has(trader.publicKey))
      .map(trader => ({
        publicKey: trader.publicKey,
        balance: trader.getTokenBalance(token.mint),
        totalVolume: trader.getTradeHistory(token.mint)
          .reduce((sum, t) => sum + t.amount, 0)
      }));

    const snapshot = {
      price: token.currentPrice,
      marketCap: token.marketCapSol,
      timestamp: Date.now(),
      metrics: {
        holders: token.getHolderCount(),
        volume: token.volume,
        priceVolatility: token.priceVolatility,
        traders: {
          total: traderMetrics.uniqueTraders,
          active: traderMetrics.activeTraders,
          suspicious: suspiciousTraders.length,
          whales: traderMetrics.whaleCount,
          suspiciousTraders,
          traderRetention: traderMetrics.activeTraders / trackedToken.initialMetrics.traders.total
        }
      }
    };

    // Update peak data if this is a new peak
    if (!trackedToken.peakData || token.currentPrice > trackedToken.peakData.price) {
      trackedToken.peakData = {
        price: token.currentPrice,
        marketCap: token.marketCapSol,
        timestamp: Date.now(),
        timeToReachSeconds: Math.round((Date.now() - trackedToken.failedAt) / 1000),
        holders: token.getHolderCount(),
        volume: token.getRecentVolume(300000), // 5-minute volume
        priceVolatility: token.priceVolatility,
        topHolderConcentration: token.getTopHolderConcentration(),
        creatorHoldings: token.getCreatorSellPercentage(),
        traders: snapshot.metrics.traders
      };

      // Calculate potential profit
      const gainPercentage = ((token.currentPrice - trackedToken.initialPrice) / trackedToken.initialPrice) * 100;
      trackedToken.potentialProfit = {
        percentage: gainPercentage,
        timeToReachSeconds: trackedToken.peakData.timeToReachSeconds,
        missedProfitSOL: this.calculateMissedProfit(trackedToken, token.currentPrice),
        traderImpact: {
          retentionRate: snapshot.metrics.traders.traderRetention,
          suspiciousTraderRatio: snapshot.metrics.traders.suspicious / snapshot.metrics.traders.total,
          whaleConcentration: snapshot.metrics.traders.whales / snapshot.metrics.traders.active
        }
      };

      // Analyze which thresholds could be adjusted
      trackedToken.thresholdAnalysis = this.analyzeThresholds(trackedToken);
    }

    trackedToken.finalSnapshot = snapshot;
    
    // If gain is significant, log the opportunity
    if (this.isSignificantMiss(trackedToken)) {
      this.logMissedOpportunity(trackedToken);
      this.trackedTokens.delete(token.mint); // Stop tracking after logging
    }
  }

  calculateMissedProfit(trackedToken, peakPrice) {
    const marketCap = trackedToken.initialMarketCap;
    const positionSize = this.calculatePositionSize(marketCap);
    const potentialGain = ((peakPrice - trackedToken.initialPrice) / trackedToken.initialPrice) * positionSize;
    return potentialGain;
  }

  calculatePositionSize(marketCap) {
    let size = config.POSITION.MIN_POSITION_SIZE_SOL;
    const marketCapBasedSize = marketCap * config.POSITION.POSITION_SIZE_MARKET_CAP_RATIO;
    size = Math.min(marketCapBasedSize, config.POSITION.MAX_POSITION_SIZE_SOL);
    return Math.max(size, config.POSITION.MIN_POSITION_SIZE_SOL);
  }

  isSignificantMiss(trackedToken) {
    if (!trackedToken.potentialProfit) return false;
    
    try {
      // Consider it significant if:
      // 1. Potential gain was over 30% (lowered from 50%)
      // 2. Time to peak was reasonable (under 15 minutes, increased from 5)
      // 3. Missed profit would have been at least 0.05 SOL (lowered from 0.1)
      // 4. Initial market cap was below 20k USD (new check)
      const initialMarketCapUSD = this.priceManager.solToUSD(trackedToken.initialMarketCap);
      
      return trackedToken.potentialProfit.percentage > 30 &&
             trackedToken.potentialProfit.timeToReachSeconds < 900 &&
             trackedToken.potentialProfit.missedProfitSOL > 0.05 &&
             initialMarketCapUSD < 20000;
    } catch (error) {
      console.error('Error checking significant miss:', error);
      return false;
    }
  }

  analyzeThresholds(trackedToken) {
    const analysis = {
      thresholdSuggestions: [],
      riskLevel: 'LOW',
      confidenceScore: 0
    };

    // Analyze each failed check
    trackedToken.failedChecks.forEach(check => {
      const suggestion = {
        configPath: check.configPath,
        currentThreshold: check.threshold,
        actualValue: check.actualValue,
        suggestedThreshold: null,
        confidence: 0,
        reasoning: ''
      };

      // Calculate suggested threshold based on peak performance
      const peakMetrics = trackedToken.peakData;
      if (peakMetrics) {
        switch (check.check) {
          case 'MIN_HOLDERS':
            if (peakMetrics.holders > check.threshold) {
              suggestion.suggestedThreshold = Math.floor(check.actualValue * 0.9);
              suggestion.confidence = 0.8;
              suggestion.reasoning = 'Token gained holders quickly after launch';
            }
            break;
          case 'MAX_TOP_HOLDER_CONCENTRATION':
            if (peakMetrics.topHolderConcentration < check.threshold) {
              suggestion.suggestedThreshold = Math.ceil(check.actualValue * 1.1);
              suggestion.confidence = 0.7;
              suggestion.reasoning = 'Concentration decreased during pump';
            }
            break;
          // Add more cases for other checks
        }
      }

      if (suggestion.suggestedThreshold !== null) {
        analysis.thresholdSuggestions.push(suggestion);
        analysis.confidenceScore += suggestion.confidence;
      }
    });

    // Calculate overall risk level
    analysis.confidenceScore = analysis.confidenceScore / trackedToken.failedChecks.length;
    analysis.riskLevel = analysis.confidenceScore > 0.7 ? 'MEDIUM' : 'LOW';

    return analysis;
  }

  logMissedOpportunity(tokenData) {
    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(this.logDir, `missed_opportunities_${date}.json`);
    
    let opportunities = [];
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf8');
      opportunities = JSON.parse(content);
    }

    opportunities.push({
      timestamp: Date.now(),
      token: tokenData
    });

    fs.writeFileSync(logFile, JSON.stringify(opportunities, null, 2));
  }
}

module.exports = MissedOpportunityLogger;
