const config = require("./config");
const MissedOpportunityLogger = require("./MissedOpportunityLogger");

class SafetyChecker {
  constructor(priceManager, safetyConfig = {}) {
    this.missedOpportunityLogger = new MissedOpportunityLogger();
    this.priceManager = priceManager;
    this.safetyConfig = safetyConfig;
    this.lastFailureReason = null;
  }

  getFailureReason() {
    return this.lastFailureReason;
  }

  setFailureReason(reason, value = null) {
    this.lastFailureReason = { reason, value };
  }

  async runSecurityChecks(token) {
    const startTime = Date.now();
    let approved = true;
    let rejectionCategory = null;
    let rejectionReason = null;
    let details = {};

    try {
      // Reset failure reason at start of checks
      this.lastFailureReason = null;

      // Basic safety checks that even pump tokens must pass
      if (!this.checkMinimumRequirements(token)) {
        approved = false;
        rejectionCategory = "basic";
        rejectionReason = this.lastFailureReason?.reason || "minimumRequirements";
      } 
      // Check for rug pull signals
      else if (!this.checkRugSignals(token)) {
        approved = false;
        rejectionCategory = "rugPull";
        rejectionReason = this.lastFailureReason?.reason || "rugSignals";
      }
      // Pump-specific checks
      else if (!this.checkPumpDynamics(token)) {
        approved = false;
        rejectionCategory = "pumpDynamics";
        rejectionReason = this.lastFailureReason?.reason || "invalidPumpPattern";
      }

      // Log the check results
      const duration = Date.now() - startTime;

      // Track the token for missed opportunity analysis
      if (!approved) {
        this.missedOpportunityLogger.trackToken(token, rejectionReason);
        token.unsafeReason = rejectionReason;
      }

      return approved;
    } catch (error) {
      console.error("Error in security checks:", error);
      this.setFailureReason("Error running checks");
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
    const creatorWallet = Array.from(token.wallets.values()).find(w => w.isCreator);
    if (creatorWallet) {
      const recentCreatorTrades = creatorWallet.trades.filter(t => 
        Date.now() - t.timestamp < 5 * 60 * 1000
      );
      
      if (recentCreatorTrades.length > 0) {
        const totalSellVolume = recentCreatorTrades.reduce((sum, trade) => 
          sum + (trade.amount < 0 ? Math.abs(trade.volumeInSol) : 0), 0
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
    // Fast check for pump characteristics
    const pumpMetrics = token.pumpMetrics;
    
    // Check price acceleration
    if (pumpMetrics.priceAcceleration > 0.5) {
      // Strong positive acceleration indicates potential pump
      const volumeSpikes = pumpMetrics.volumeSpikes;
      if (volumeSpikes.length > 0) {
        // Analyze volume spikes pattern
        const recentSpike = volumeSpikes[volumeSpikes.length - 1];
        const volumeIncrease = recentSpike.volume / token.getRecentVolume(5 * 60 * 1000) * 100;
        
        if (volumeIncrease > 200) { // Volume spike over 200%
          // Check if price movement correlates with volume
          const priceChange = recentSpike.priceChange;
          if (priceChange > 0 && priceChange/volumeIncrease > 0.3) {
            // Price movement correlates well with volume
            return true;
          }
        }
      }
    }
    
    // Check gain rate
    if (pumpMetrics.highestGainRate > 2) { // More than 2% per second
      const priceStats = token.getPriceStats();
      if (priceStats.volatility < config.SAFETY.MAX_PRICE_VOLATILITY) {
        return true;
      }
    }
    
    // Check pump frequency
    if (pumpMetrics.pumpCount >= 2) {
      const timeSinceLastPump = Date.now() - pumpMetrics.lastPumpTime;
      if (timeSinceLastPump < 5 * 60 * 1000) { // Within last 5 minutes
        return true;
      }
    }
    
    this.setFailureReason("No clear pump pattern detected");
    return false;
  }

  updateTrackedTokens(token) {
    // Update metrics for tracked tokens that failed safety checks
    this.missedOpportunityLogger.updateTokenMetrics(token);
  }

  getSafetyMetrics() {
    return {};
  }
}

module.exports = SafetyChecker;
