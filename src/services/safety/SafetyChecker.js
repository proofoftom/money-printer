const MissedOpportunityLogger = require("../../monitoring/MissedOpportunityLogger");

class SafetyChecker {
  constructor(config, priceManager, safetyConfig = {}) {
    this.config = config;
    this.missedOpportunityLogger = new MissedOpportunityLogger(priceManager);
    this.priceManager = priceManager;
    this.safetyConfig = safetyConfig;
    this.lastFailReason = null;
    this.trackedTokens = new Map();
  }

  getFailureReason() {
    return this.lastFailReason;
  }

  fail(reason) {
    this.lastFailReason = { reason, passed: false };
    return this.lastFailReason;
  }

  async runSecurityChecks(token) {
    try {
      // Liquidity checks
      const liquidity = token.getLiquidity();
      if (liquidity < this.safetyConfig.MIN_LIQUIDITY_SOL) {
        return this.fail('Insufficient liquidity');
      }

      // Volume checks
      const volume24h = token.getVolume24h();
      if (volume24h < this.safetyConfig.MIN_VOLUME_24H) {
        return this.fail('Insufficient volume');
      }

      // Holder checks
      const holderCount = token.getHolderCount();
      if (holderCount < this.safetyConfig.MIN_HOLDERS) {
        return this.fail('Insufficient holders');
      }

      // Concentration checks
      const maxConcentration = token.getMaxWalletConcentration();
      if (maxConcentration > this.safetyConfig.MAX_WALLET_CONCENTRATION) {
        return this.fail('High wallet concentration');
      }

      return { passed: true };
    } catch (error) {
      console.error('Safety check failed:', error);
      return this.fail(error.message);
    }
  }

  updateTrackedTokens(token) {
    if (!token || !token.mint) return;
    
    // Update or add token to tracked tokens
    this.trackedTokens.set(token.mint, {
      lastUpdate: Date.now(),
      token
    });

    // Log missed opportunities if applicable
    this.missedOpportunityLogger.checkAndLog(token);
  }
}

module.exports = SafetyChecker;
