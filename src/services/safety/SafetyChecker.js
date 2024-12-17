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
      // Liquidity checks using vSolInBondingCurve from WebSocket data
      const liquidity = token.vSolInBondingCurve;
      if (liquidity < this.safetyConfig.MIN_LIQUIDITY_SOL) {
        return this.fail('Insufficient liquidity');
      }

      // Volume checks using token's volume metrics
      const volume = token.volume30m; // Using 30m volume as a proxy for activity
      if (volume < this.safetyConfig.MIN_VOLUME_24H) {
        return this.fail('Insufficient volume');
      }

      // Holder checks using token's trader data
      const holderCount = token.traderManager.getTraderCount(token.mint);
      if (holderCount < this.safetyConfig.MIN_HOLDERS) {
        return this.fail('Insufficient holders');
      }

      // Concentration checks using trader manager data
      const topHolders = token.traderManager.getTopHolders(token.mint, 1);
      const maxConcentration = topHolders.length > 0 
        ? topHolders[0].balance / token.vTokensInBondingCurve 
        : 0;
      
      if (maxConcentration > this.safetyConfig.MAX_WALLET_CONCENTRATION) {
        return this.fail('High wallet concentration');
      }

      // Recovery phase checks
      if (token.recoveryMetrics && token.recoveryMetrics.phase === 'distribution') {
        return this.fail('Token in distribution phase');
      }

      // Market structure checks
      if (token.recoveryMetrics && token.recoveryMetrics.marketStructure === 'bearish') {
        return this.fail('Bearish market structure');
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
