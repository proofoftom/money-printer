const fs = require('fs');
const path = require('path');
const config = require('./config');

class MissedOpportunityLogger {
  constructor() {
    this.logDir = path.join(process.cwd(), 'logs', 'missed_opportunities');
    this.trackedTokens = new Map(); // Track tokens that failed safety checks
    this.ensureLogDirectory();
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  trackToken(token, failedChecks) {
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
        priceVolatility: token.priceVolatility
      },
      failedChecks: failedChecks.map(check => ({
        check: check.name,
        actualValue: check.actual,
        threshold: check.threshold,
        configPath: check.configPath
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

    const currentPrice = token.currentPrice;
    const currentMarketCap = token.marketCapSol;
    
    // Update peak data if this is a new peak
    if (!trackedToken.peakData || currentPrice > trackedToken.peakData.price) {
      trackedToken.peakData = {
        price: currentPrice,
        marketCap: currentMarketCap,
        timestamp: Date.now(),
        timeToReachSeconds: Math.round((Date.now() - trackedToken.failedAt) / 1000),
        holders: token.getHolderCount(),
        volume: token.getRecentVolume(300000), // 5-minute volume
        priceVolatility: token.priceVolatility,
        topHolderConcentration: token.getTopHolderConcentration(),
        creatorHoldings: token.getCreatorSellPercentage()
      };

      // Calculate potential profit
      const gainPercentage = ((currentPrice - trackedToken.initialPrice) / trackedToken.initialPrice) * 100;
      trackedToken.potentialProfit = {
        percentage: gainPercentage,
        timeToReachSeconds: trackedToken.peakData.timeToReachSeconds,
        missedProfitSOL: this.calculateMissedProfit(trackedToken, currentPrice)
      };

      // Analyze which thresholds could be adjusted
      trackedToken.thresholdAnalysis = this.analyzeThresholds(trackedToken);
    }

    // Update final snapshot
    trackedToken.finalSnapshot = {
      price: currentPrice,
      marketCap: currentMarketCap,
      timestamp: Date.now(),
      holders: token.getHolderCount(),
      volume: token.getRecentVolume(300000),
      priceVolatility: token.priceVolatility,
      topHolderConcentration: token.getTopHolderConcentration(),
      creatorHoldings: token.getCreatorSellPercentage()
    };

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
    
    // Consider it significant if:
    // 1. Potential gain was over 50%
    // 2. Time to peak was reasonable (under 5 minutes)
    // 3. Missed profit would have been at least 0.1 SOL
    return trackedToken.potentialProfit.percentage > 50 &&
           trackedToken.potentialProfit.timeToReachSeconds < 300 &&
           trackedToken.potentialProfit.missedProfitSOL > 0.1;
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
