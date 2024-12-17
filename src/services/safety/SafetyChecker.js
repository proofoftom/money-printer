const config = require("../../utils/config");
const MissedOpportunityLogger = require("../../monitoring/MissedOpportunityLogger");

class SafetyChecker {
  constructor(config, priceManager, safetyConfig = {}) {
    this.config = config;
    this.missedOpportunityLogger = new MissedOpportunityLogger(priceManager);
    this.priceManager = priceManager;
    this.safetyConfig = safetyConfig;
    this.lastFailureReason = null;
    this.trackedTokens = new Map();
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
      this.lastFailureReason = null;

      // Check if token is in recovery phase
      if (!this.checkRecoveryPattern(token)) {
        approved = false;
        failedChecks.push({
          name: 'RECOVERY_PATTERN',
          reason: this.lastFailureReason?.reason || 'invalidRecoveryPattern',
          actual: this.lastFailureReason?.value,
          configPath: 'THRESHOLDS.RECOVERY'
        });
      }
      // Check if there's enough liquidity
      else if (!this.checkLiquidity(token)) {
        approved = false;
        failedChecks.push({
          name: 'LIQUIDITY',
          reason: this.lastFailureReason?.reason || 'insufficientLiquidity',
          actual: this.lastFailureReason?.value,
          configPath: 'SAFETY.MIN_LIQUIDITY_SOL'
        });
      }
      // Check volume patterns during recovery
      else if (!this.checkVolumeSpike(token)) {
        approved = false;
        failedChecks.push({
          name: 'VOLUME_SPIKE',
          reason: this.lastFailureReason?.reason || 'insufficientVolume',
          actual: this.lastFailureReason?.value,
          configPath: 'THRESHOLDS.VOLUME_SPIKE'
        });
      }

      if (!approved && failedChecks.length > 0) {
        this.missedOpportunityLogger.trackToken(token, failedChecks);
        token.unsafeReason = failedChecks.map(check => check.reason).join(', ');
      }

      return approved;
    } catch (error) {
      console.error("Error in security checks:", error);
      return false;
    }
  }

  checkRecoveryPattern(token) {
    // Check if token has had a significant drawdown
    const drawdown = token.getDrawdownPercentage();
    if (drawdown > -30) { // Minimum 30% drawdown required
      this.setFailureReason("Insufficient drawdown", drawdown);
      return false;
    }

    // Get comprehensive recovery metrics
    const recoveryStrength = token.getRecoveryStrength();
    if (recoveryStrength.total < 60) {
      this.setFailureReason("Weak recovery strength", recoveryStrength.total);
      return false;
    }

    // Check buy pressure
    const buyPressure = recoveryStrength.breakdown.buyPressure;
    if (buyPressure.buyRatio < 0.6) {
      this.setFailureReason("Insufficient buy pressure", buyPressure.buyRatio);
      return false;
    }

    // Ensure multiple unique buyers
    if (buyPressure.uniqueBuyers < 3) {
      this.setFailureReason("Too few unique buyers", buyPressure.uniqueBuyers);
      return false;
    }

    // Check if buy sizes are increasing (good sign)
    if (!buyPressure.buySizeIncreasing) {
      this.setFailureReason("Buy sizes not increasing", null);
      return false;
    }

    // Additional check for rapid price movements
    const priceVolatility = token.getPriceVolatility();
    if (priceVolatility > 50) { // More than 50% price swings
      this.setFailureReason("Too volatile", priceVolatility);
      return false;
    }

    return true;
  }

  checkLiquidity(token) {
    // Enhanced liquidity check
    const minLiquidity = this.config.SAFETY.MIN_LIQUIDITY_SOL;
    if (token.vSolInBondingCurve < minLiquidity) {
      this.setFailureReason("Insufficient liquidity", token.vSolInBondingCurve);
      return false;
    }

    // Check liquidity stability
    const liquidityChange = token.getLiquidityChangePercent(300000); // 5 min window
    if (Math.abs(liquidityChange) > 20) { // 20% liquidity change is too unstable
      this.setFailureReason("Unstable liquidity", liquidityChange);
      return false;
    }

    return true;
  }

  checkVolumeSpike(token) {
    const recentVolume = token.getRecentVolume(300000); // 5 minutes
    const averageVolume = token.getAverageVolume(1800000); // 30 minutes

    // Check for significant but not excessive volume increase
    const volumeRatio = recentVolume / averageVolume;
    if (volumeRatio < 1.5) {
      this.setFailureReason("Insufficient volume spike", volumeRatio);
      return false;
    }
    if (volumeRatio > 5) {
      this.setFailureReason("Suspicious volume spike", volumeRatio);
      return false;
    }

    // Check volume distribution
    const volumeDistribution = token.getVolumeDistribution(300000);
    if (volumeDistribution.topTraderPercent > 40) { // Single trader > 40% of volume
      this.setFailureReason("Volume too concentrated", volumeDistribution.topTraderPercent);
      return false;
    }

    return true;
  }

  updateTrackedTokens(tokens) {
    tokens.forEach(token => {
      if (!this.trackedTokens.has(token.address)) {
        this.trackedTokens.set(token.address, {
          firstSeen: Date.now(),
          checks: []
        });
      }
    });
  }

  cleanup() {
    const now = Date.now();
    const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [address, data] of this.trackedTokens.entries()) {
      if (now - data.firstSeen > MAX_AGE) {
        this.trackedTokens.delete(address);
      }
    }
  }
}

module.exports = SafetyChecker;
