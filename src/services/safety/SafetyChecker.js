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
      // Get recent volume metrics
      const volume1m = token.volume1m;
      const volume5m = token.volume5m;
      const volume30m = token.volume30m;

      // Calculate volume ratios
      const volumeRatio1m = volume1m > 0 ? (volume5m / 5) / volume1m : 0;
      const volumeRatio5m = volume5m > 0 ? (volume30m / 6) / volume5m : 0;

      // Check for abnormal volume spikes
      if (volumeRatio1m > pumpConfig.MIN_VOLUME_SPIKE || volumeRatio5m > pumpConfig.MIN_VOLUME_SPIKE) {
        // Get unique traders during recent period
        const traderCount = token.traderManager.getUniqueTraderCount(token);
        
        // Check if enough unique traders participated
        if (traderCount < pumpConfig.MIN_TRADER_PARTICIPATION) {
          this.setFailureReason("Insufficient trader participation", traderCount);
          return false;
        }
        
        // Analyze trading relationships during high volume period
        const tradingGroupRisk = token.traderManager.analyzeTradingRelationships(
          Date.now() - (5 * 60 * 1000),  // Last 5 minutes
          Date.now()
        );
        
        if (tradingGroupRisk > pumpConfig.MAX_GROUP_RISK) {
          this.setFailureReason("Suspicious trading group activity", tradingGroupRisk);
          return false;
        }

        // Check volume concentration
        const volumeStats = this.analyzeVolumeConcentration(token);
        if (volumeStats.topWalletVolume > pumpConfig.MAX_WALLET_VOLUME_PERCENTAGE) {
          this.setFailureReason("High volume concentration", volumeStats.topWalletVolume);
          return false;
        }

        return true;
      }
    }
    
    // Check gain rate with volatility context
    if (pumpMetrics.highestGainRate > pumpConfig.MIN_GAIN_RATE) {
      const priceStats = token.getPriceStats();
      if (priceStats.volatility < config.SAFETY.MAX_PRICE_VOLATILITY) {
        // Analyze volume patterns during gain period
        const volumePattern = this.analyzeVolumePattern(token);
        if (volumePattern.isSuspicious) {
          this.setFailureReason("Suspicious volume pattern", volumePattern.reason);
          return false;
        }
        return true;
      }
    }
    
    return false;
  }

  analyzeVolumeConcentration(token) {
    const traders = Array.from(token.traderManager.traders.values());
    const volumes = traders.map(trader => {
      const recentTrades = trader.tradeHistory['5m'].filter(t => t.mint === token.mint);
      return recentTrades.reduce((sum, trade) => sum + Math.abs(trade.amount * trade.price), 0);
    });

    const totalVolume = volumes.reduce((a, b) => a + b, 0);
    const topWalletVolume = Math.max(...volumes);

    return {
      topWalletVolume: totalVolume > 0 ? (topWalletVolume / totalVolume) * 100 : 0,
      totalVolume
    };
  }

  analyzeVolumePattern(token) {
    const volume1m = token.volume1m;
    const volume5m = token.volume5m;
    const volume30m = token.volume30m;

    // Check for abnormal volume distribution
    const shortTermRatio = volume1m > 0 ? (volume5m / 5) / volume1m : 0;
    const longTermRatio = volume5m > 0 ? (volume30m / 6) / volume5m : 0;

    return {
      isSuspicious: shortTermRatio > 3 || longTermRatio > 3,
      reason: shortTermRatio > 3 ? "Abnormal short-term volume spike" : 
              longTermRatio > 3 ? "Abnormal long-term volume pattern" : null
    };
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
