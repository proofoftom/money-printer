const fs = require('fs');
const path = require('path');
const config = require('../utils/config');

class MissedOpportunityLogger {
  constructor(priceManager) {
    this.logDir = path.join(process.cwd(), 'logs', 'missed_opportunities');
    this.trackedTokens = new Map(); // Track tokens that failed safety checks
    this.priceManager = priceManager;
    this.ensureLogDirectory();
    this.metrics = {
      totalMissed: 0,
      totalPotentialProfit: 0,
      avgPotentialProfit: 0,
      missedByReason: {},
      missedByTokenType: {},
      missedByTimeframe: {},
      missedByVolume: {
        low: 0,
        medium: 0,
        high: 0
      },
      recoveryMetrics: {
        missedRecoveries: 0,
        avgRecoveryPotential: 0,
        byPhase: {
          accumulation: 0,
          expansion: 0,
          distribution: 0
        },
        byMarketStructure: {
          bullish: 0,
          bearish: 0,
          neutral: 0
        },
        byRecoveryStrength: {
          weak: 0,
          moderate: 0,
          strong: 0
        }
      }
    };
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  trackToken(token, failedChecks) {
    // Normalize failedChecks to array format
    const checks = Array.isArray(failedChecks) ? failedChecks : [failedChecks];

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

  checkAndLog(token) {
    if (!token || !token.mint) return;
    
    // Check if token meets criteria for logging
    const shouldLog = this.shouldLogToken(token);
    if (!shouldLog) return;
    
    // Track the token with its failed checks
    this.trackToken(token, shouldLog.failedChecks);
    
    // Update metrics
    this.updateMetrics(token, shouldLog.failedChecks);
    
    // Log to file
    this.logToFile(token, shouldLog.failedChecks);
  }

  shouldLogToken(token) {
    // Check if token has potential for profit but failed safety checks
    const failedChecks = [];
    
    // Check liquidity
    const liquidity = token.vSolInBondingCurve;
    if (liquidity < config.SAFETY.MIN_LIQUIDITY_SOL) {
      failedChecks.push('Insufficient liquidity');
    }
    
    // Check volume
    const volume24h = token.getRecentVolume(24 * 60 * 60 * 1000); // 24 hours in ms
    if (volume24h < config.SAFETY.MIN_VOLUME_24H) {
      failedChecks.push('Insufficient volume');
    }
    
    // Check holder count
    const holderCount = token.getHolderCount();
    if (holderCount < config.SAFETY.MIN_HOLDERS) {
      failedChecks.push('Insufficient holders');
    }
    
    // Check wallet concentration
    const maxConcentration = token.getTopHolderConcentration();
    if (maxConcentration > config.SAFETY.MAX_WALLET_CONCENTRATION) {
      failedChecks.push('High wallet concentration');
    }
    
    return failedChecks.length > 0 ? { failedChecks } : false;
  }

  logMissedOpportunity(data) {
    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(this.logDir, `missed_opportunities_${date}.json`);
    
    let opportunities = [];
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf8');
      opportunities = JSON.parse(content);
    }

    opportunities.push({
      timestamp: Date.now(),
      token: data
    });

    fs.writeFileSync(logFile, JSON.stringify(opportunities, null, 2));

    // Log recovery-specific metrics if available
    if (data.token && data.token.recoveryMetrics) {
      const {
        recoveryPhase,
        marketStructure,
        recoveryStrength
      } = data.token.recoveryMetrics;
      
      this.metrics.recoveryMetrics.missedRecoveries++;
      
      // Update average recovery potential
      this.metrics.recoveryMetrics.avgRecoveryPotential = 
        (this.metrics.recoveryMetrics.avgRecoveryPotential * 
         (this.metrics.recoveryMetrics.missedRecoveries - 1) + 
         data.potentialProfit) / this.metrics.recoveryMetrics.missedRecoveries;
      
      // Update phase stats
      if (recoveryPhase && this.metrics.recoveryMetrics.byPhase.hasOwnProperty(recoveryPhase)) {
        this.metrics.recoveryMetrics.byPhase[recoveryPhase]++;
      }
      
      // Update market structure stats
      if (marketStructure && this.metrics.recoveryMetrics.byMarketStructure.hasOwnProperty(marketStructure)) {
        this.metrics.recoveryMetrics.byMarketStructure[marketStructure]++;
      }
      
      // Categorize recovery strength
      if (recoveryStrength) {
        let strengthCategory;
        if (recoveryStrength < 0.33) {
          strengthCategory = 'weak';
        } else if (recoveryStrength < 0.66) {
          strengthCategory = 'moderate';
        } else {
          strengthCategory = 'strong';
        }
        this.metrics.recoveryMetrics.byRecoveryStrength[strengthCategory]++;
      }
    }
  }

  updateMetrics(token, failedChecks) {
    // Update total missed opportunities
    this.metrics.totalMissed++;

    // Update missed by reason
    failedChecks.forEach(reason => {
      this.metrics.missedByReason[reason] = (this.metrics.missedByReason[reason] || 0) + 1;
    });

    // Update missed by volume category
    const volume24h = token.getRecentVolume(24 * 60 * 60 * 1000);
    if (volume24h < 1000) {
      this.metrics.missedByVolume.low++;
    } else if (volume24h < 10000) {
      this.metrics.missedByVolume.medium++;
    } else {
      this.metrics.missedByVolume.high++;
    }

    // Update recovery metrics if applicable
    const marketStructure = token.getMarketStructure();
    if (marketStructure) {
      this.metrics.recoveryMetrics.byMarketStructure[marketStructure]++;
    }
  }

  logToFile(token, failedChecks) {
    const data = {
      timestamp: new Date().toISOString(),
      mint: token.mint,
      failedChecks,
      tokenMetrics: {
        liquidity: token.vSolInBondingCurve,
        volume24h: token.getRecentVolume(24 * 60 * 60 * 1000),
        holderCount: token.getHolderCount(),
        maxWalletConcentration: token.getTopHolderConcentration()
      }
    };

    this.logMissedOpportunity(data);
  }
}

module.exports = MissedOpportunityLogger;
