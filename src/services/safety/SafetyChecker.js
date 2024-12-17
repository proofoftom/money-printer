const config = require("../../utils/config");
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
    return this.lastFailReason || { reason: 'Unknown failure', value: null };
  }

  async runSecurityChecks(token) {
    const { SAFETY } = config;
    
    try {
      // Token checks
      if (!this.checkTokenAge(token, SAFETY.TOKEN.MIN_AGE)) {
        return this.fail('Token too new');
      }

      if (!this.checkHolderDistribution(token, SAFETY.TOKEN)) {
        return this.fail('Poor holder distribution');
      }

      // Liquidity checks
      if (!this.checkLiquidity(token, SAFETY.LIQUIDITY)) {
        return this.fail('Insufficient liquidity');
      }

      // Market checks
      if (!this.checkMarketHealth(token, SAFETY.MARKET)) {
        return this.fail('Unhealthy market conditions');
      }

      return true;
    } catch (error) {
      console.error('Safety check failed:', error);
      return false;
    }
  }

  checkTokenAge(token, minAge) {
    return token.age >= minAge;
  }

  checkHolderDistribution(token, config) {
    return token.holders >= config.MIN_HOLDERS &&
           token.creatorHoldings <= config.MAX_CREATOR &&
           token.maxWalletConcentration <= config.MAX_WALLET;
  }

  checkLiquidity(token, config) {
    return token.liquiditySOL >= config.MIN_SOL &&
           token.priceImpact <= config.MAX_IMPACT &&
           token.liquidityDepth >= config.MIN_DEPTH;
  }

  checkMarketHealth(token, config) {
    const metrics = token.getMarketMetrics();
    return metrics.tradeCount >= config.MIN_TRADES &&
           metrics.uniqueTraders >= config.MIN_TRADERS &&
           metrics.spread <= config.MAX_SPREAD &&
           metrics.volumePriceCorrelation >= config.MIN_CORRELATION;
  }

  fail(reason) {
    this.lastFailReason = reason;
    return false;
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
