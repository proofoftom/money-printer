const config = require("./config");
const SafetyLogger = require("./SafetyLogger");

class SafetyChecker {
  constructor(priceManager, safetyConfig = {}) {
    this.safetyLogger = new SafetyLogger();
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
      this.safetyLogger.logSafetyCheck({
        token: token.mint,
        approved,
        rejectionCategory,
        rejectionReason,
        details,
        duration,
      });

      return approved;
    } catch (error) {
      console.error("Error in security checks:", error);
      this.safetyLogger.logSafetyCheck({
        token: token.mint,
        approved: false,
        rejectionCategory: "error",
        rejectionReason: error.message,
        details,
        duration: Date.now() - startTime,
      });
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
    // Check for extreme concentration
    if (token.getTopHolderConcentration(3) > 80) {
      this.setFailureReason("Extreme holder concentration", token.getTopHolderConcentration(3));
      return false;
    }

    // Check for suspicious creator behavior
    const creatorHoldings = token.getCreatorHoldings();
    if (creatorHoldings > config.SAFETY.MAX_CREATOR_HOLDINGS_PERCENT) {
      this.setFailureReason("High creator holdings", creatorHoldings);
      return false;
    }

    // Check for extreme price drops
    const priceChange = ((token.currentPrice - token.initialPrice) / token.initialPrice) * 100;
    if (priceChange < config.SAFETY.MIN_PRICE_CHANGE_PERCENT) {
      this.setFailureReason("Extreme price drop", priceChange);
      return false;
    }

    return true;
  }

  checkPumpDynamics(token) {
    // Volume pattern checks
    if (token.volumeData.maxWalletVolumePercentage > config.SAFETY.MAX_WALLET_VOLUME_PERCENTAGE) {
      this.setFailureReason("High wallet volume", token.volumeData.maxWalletVolumePercentage);
      return false;
    }

    // Allow higher wash trading for pump tokens
    if (token.volumeData.suspectedWashTradePercentage > config.SAFETY.MAX_WASH_TRADE_PERCENTAGE) {
      this.setFailureReason("Excessive wash trading", token.volumeData.suspectedWashTradePercentage);
      return false;
    }

    // Check if the token is in a valid pump pattern
    const recentVolume = token.getVolume("5m");
    if (recentVolume < config.SAFETY.MIN_VOLUME_SOL) {
      this.setFailureReason("Insufficient volume", recentVolume);
      return false;
    }

    // Price volatility is expected in pumps, but should still be within limits
    if (token.priceVolatility > config.SAFETY.MAX_PRICE_VOLATILITY) {
      this.setFailureReason("Extreme volatility", token.priceVolatility);
      return false;
    }

    return true;
  }

  getSafetyMetrics() {
    return this.safetyLogger.getSummaryMetrics();
  }
}

module.exports = SafetyChecker;
