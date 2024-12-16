const config = require("../../utils/config");
const MissedOpportunityLogger = require("../../monitoring/MissedOpportunityLogger");

class SafetyChecker {
  constructor(config, priceManager, safetyConfig = {}) {
    this.config = config;
    this.missedOpportunityLogger = new MissedOpportunityLogger(priceManager);
    this.priceManager = priceManager;
    this.safetyConfig = safetyConfig;
    this.lastFailureReason = null;
  }

  getFailureReason() {
    return this.lastFailureReason || { reason: 'Unknown failure', value: null };
  }

  setFailureReason(reason, value = null) {
    this.lastFailureReason = { reason, value };
  }

  async runSecurityChecks(token) {
    const startTime = Date.now();
    let approved = true;
    let failedChecks = [];

    try {
      // Reset failure reason at start of checks
      this.lastFailureReason = null;

      // Basic safety checks that even pump tokens must pass
      if (!this.checkMinimumRequirements(token)) {
        approved = false;
        failedChecks.push({
          name: 'MINIMUM_REQUIREMENTS',
          reason: this.lastFailureReason?.reason || 'minimumRequirements',
          actual: this.lastFailureReason?.value,
          configPath: 'SAFETY.MIN_TOKEN_AGE_SECONDS'
        });
      } 
      // Check for rug pull signals
      else if (!this.checkRugSignals(token)) {
        approved = false;
        failedChecks.push({
          name: 'RUG_SIGNALS',
          reason: this.lastFailureReason?.reason || 'rugSignals',
          actual: this.lastFailureReason?.value,
          configPath: 'SAFETY.MAX_TOP_HOLDER_CONCENTRATION'
        });
      }
      // Pump-specific checks
      else if (!this.checkPumpDynamics(token)) {
        approved = false;
        failedChecks.push({
          name: 'PUMP_DYNAMICS',
          reason: this.lastFailureReason?.reason || 'invalidPumpPattern',
          actual: this.lastFailureReason?.value,
          configPath: 'THRESHOLDS.PUMP'
        });
      }

      // Track the token for missed opportunity analysis if it failed any checks
      if (!approved && failedChecks.length > 0) {
        this.missedOpportunityLogger.trackToken(token, failedChecks);
        token.unsafeReason = failedChecks.map(check => check.reason).join(', ');
      }

      return approved;
    } catch (error) {
      console.error("Error in security checks:", error);
      const errorCheck = {
        name: 'ERROR',
        reason: 'Error running checks',
        actual: error.message,
        configPath: null
      };
      failedChecks.push(errorCheck);
      this.missedOpportunityLogger.trackToken(token, errorCheck);
      return false;
    }
  }

  checkMinimumRequirements(token) {
    // Check absolute minimum requirements
    const ageInSeconds = (Date.now() - token.minted) / 1000;
    if (ageInSeconds < config.SAFETY.MIN_TOKEN_AGE_SECONDS) {
      this.setFailureReason("Token too young", ageInSeconds);
      return false;
    }

    // Minimum liquidity check
    if (token.vSolInBondingCurve < config.SAFETY.MIN_LIQUIDITY_SOL) {
      this.setFailureReason("Insufficient liquidity", token.vSolInBondingCurve);
      return false;
    }

    return true;
  }

  checkRugSignals(token) {
    // Enhanced rug detection using pump metrics
    const pumpMetrics = token.pumpMetrics;
    const priceStats = token.getPriceStats();
    
    // Check for suspicious dump after pump
    if (pumpMetrics.pumpCount > 0) {
      const timeSinceLastPump = Date.now() - pumpMetrics.lastPumpTime;
      if (timeSinceLastPump < 2 * 60 * 1000) { // Within 2 minutes of pump
        if (priceStats.priceChange < -30) { // 30% drop
          this.setFailureReason("Suspicious dump after pump", priceStats.priceChange);
          return false;
        }
      }
    }
    
    // Check for extreme holder concentration
    if (token.getTopHolderConcentration(3) > config.SAFETY.MAX_TOP_HOLDER_CONCENTRATION) {
      this.setFailureReason("Extreme holder concentration", token.getTopHolderConcentration(3));
      return false;
    }
    
    // Check creator behavior during pump
    const creatorWallet = token.traderManager.getTrader(token.traderPublicKey);
    if (creatorWallet) {
      const recentCreatorTrades = creatorWallet.getTradesInTimeWindow(token.mint, 5 * 60 * 1000);
      
      if (recentCreatorTrades.length > 0) {
        const totalSellVolume = recentCreatorTrades.reduce((sum, trade) => 
          sum + (trade.type === 'sell' ? Math.abs(trade.volumeInSol) : 0), 0
        );
        
        if (totalSellVolume > token.vSolInBondingCurve * 0.1) { // Creator selling >10% of liquidity
          this.setFailureReason("Suspicious creator selling", totalSellVolume);
          return false;
        }
      }
    }
    
    return true;
  }

  checkPumpDynamics(token) {
    const pumpMetrics = token.pumpMetrics;
    const pumpConfig = config.SAFETY.PUMP_DETECTION;
    
    // Check price acceleration and trading activity
    if (pumpMetrics.priceAcceleration > pumpConfig.MIN_PRICE_ACCELERATION) {
      const volumeSpikes = pumpMetrics.volumeSpikes;
      if (volumeSpikes.length > 0) {
        const recentSpike = volumeSpikes[volumeSpikes.length - 1];
        
        // Get unique traders during spike
        const traderCount = token.traderManager.getUniqueTraderCount(
          recentSpike.startTime,
          recentSpike.endTime
        );
        
        // Check if enough unique traders participated
        if (traderCount < pumpConfig.MIN_TRADER_PARTICIPATION) {
          this.setFailureReason("Insufficient trader participation", traderCount);
          return false;
        }
        
        // Analyze volume spike pattern with trader context
        const volumeIncrease = recentSpike.volume / token.getRecentVolume(pumpConfig.PUMP_WINDOW_MS) * 100;
        if (volumeIncrease > pumpConfig.MIN_VOLUME_SPIKE) {
          const priceChange = recentSpike.priceChange;
          if (priceChange > 0 && priceChange/volumeIncrease > pumpConfig.MIN_PRICE_VOLUME_CORRELATION) {
            // Check for suspicious trading relationships
            const tradingGroupRisk = token.traderManager.analyzeTradingRelationships(
              recentSpike.startTime,
              recentSpike.endTime
            );
            
            if (tradingGroupRisk > pumpConfig.MAX_GROUP_RISK) {
              this.setFailureReason("Suspicious trading group activity", tradingGroupRisk);
              return false;
            }
            return true;
          }
        }
      }
    }
    
    // Check gain rate with volatility context
    if (pumpMetrics.highestGainRate > pumpConfig.MIN_GAIN_RATE) {
      const priceStats = token.getPriceStats();
      if (priceStats.volatility < config.SAFETY.MAX_PRICE_VOLATILITY) {
        // Analyze trader behavior during gain period
        const riskMetrics = token.traderManager.analyzeTraderBehavior(
          pumpMetrics.gainStartTime,
          Date.now()
        );
        
        if (riskMetrics.washTradingScore > config.SAFETY.WASH_TRADE_THRESHOLD) {
          this.setFailureReason("Potential wash trading detected", riskMetrics.washTradingScore);
          return false;
        }
        return true;
      }
    }
    
    // Check market cap momentum with trader analysis
    const marketCapUSD = this.priceManager.solToUSD(token.marketCapSol);
    if (marketCapUSD > pumpConfig.LARGE_TOKEN_MC_USD) {
      const mcGainRate = pumpMetrics.marketCapGainRate || 0;
      if (mcGainRate > pumpConfig.MIN_MC_GAIN_RATE) {
        // Analyze top trader concentration
        const topTraderConcentration = token.traderManager.getTopTraderConcentration(5);
        if (topTraderConcentration > config.SAFETY.MAX_TOP_TRADER_CONCENTRATION) {
          this.setFailureReason("High top trader concentration", topTraderConcentration);
          return false;
        }
        return true;
      }
    }
    
    // Check pump frequency with trader participation
    if (pumpMetrics.pumpCount >= pumpConfig.MIN_PUMP_COUNT) {
      const timeSinceLastPump = Date.now() - pumpMetrics.lastPumpTime;
      if (timeSinceLastPump < pumpConfig.PUMP_WINDOW_MS) {
        // Check for repeat pump participants
        const repeatParticipants = token.traderManager.getRepeatPumpParticipants(
          pumpMetrics.pumpTimes
        );
        
        if (repeatParticipants.length > pumpConfig.MAX_REPEAT_PARTICIPANTS) {
          this.setFailureReason("High number of repeat pump participants", repeatParticipants.length);
          return false;
        }
        return true;
      }
    }
    
    this.setFailureReason("No clear pump pattern detected");
    return false;
  }

  updateTrackedTokens(token) {
    // Update metrics for tracked tokens that failed safety checks
    if (token.marketCapSol) {  // Only update if we have valid market cap data
      this.missedOpportunityLogger.updateTokenMetrics(token);
    }
  }

  getSafetyMetrics() {
    return {};
  }
}

module.exports = SafetyChecker;
