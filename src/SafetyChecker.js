const config = require('./config');
const SafetyLogger = require('./SafetyLogger');

class SafetyChecker {
  constructor(priceManager) {
    this.safetyLogger = new SafetyLogger();
    this.priceManager = priceManager;
  }

  async runSecurityChecks(token) {
    const startTime = Date.now();
    let approved = true;
    let rejectionCategory = null;
    let rejectionReason = null;
    let details = {};

    try {
      // Run all checks
      if (!this.checkMarketCap(token)) {
        approved = false;
        rejectionCategory = 'marketCap';
        rejectionReason = token.marketCapSol * config.SAFETY.SOL_PRICE_USD > config.SAFETY.MAX_MARKET_CAP_USD ? 'high' : 'low';
      } else if (!this.checkTokenAge(token)) {
        approved = false;
        rejectionCategory = 'age';
        rejectionReason = 'tooNew';
      } else if (!this.checkPriceAction(token)) {
        approved = false;
        rejectionCategory = 'priceAction';
        rejectionReason = token.priceVolatility > config.SAFETY.MAX_PRICE_VOLATILITY ? 'volatilityTooHigh' : 'pumpTooHigh';
      } else if (!this.checkTradingPatterns(token)) {
        approved = false;
        rejectionCategory = 'tradingPatterns';
        rejectionReason = this.getTradingPatternRejectionReason(token);
      } else if (!this.checkHolderDistribution(token)) {
        approved = false;
        rejectionCategory = 'holders';
        rejectionReason = this.getHolderDistributionRejectionReason(token);
      } else if (!this.checkVolumePatterns(token)) {
        approved = false;
        rejectionCategory = 'volume';
        rejectionReason = token.suspectedWashTradePercentage > config.SAFETY.MAX_WASH_TRADE_PERCENTAGE ? 'excessiveWashTrading' : 'lowCorrelation';
      }

      // Log the check results
      const duration = Date.now() - startTime;
      this.safetyLogger.logSafetyCheck({
        token: token.mint,
        approved,
        rejectionCategory,
        rejectionReason,
        details,
        duration
      });

      return approved;

    } catch (error) {
      console.error('Error in security checks:', error);
      
      this.safetyLogger.logSafetyCheck({
        token: token.mint,
        approved: false,
        rejectionCategory: 'error',
        rejectionReason: error.message,
        details,
        duration: Date.now() - startTime
      });

      return false;
    }
  }

  checkMarketCap(token) {
    const marketCapUSD = token.marketCapSol * config.SAFETY.SOL_PRICE_USD;
    return marketCapUSD <= config.SAFETY.MAX_MARKET_CAP_USD && 
           marketCapUSD >= config.SAFETY.MIN_MARKET_CAP_USD;
  }

  checkTokenAge(token) {
    const ageInSeconds = (Date.now() - token.createdAt) / 1000;
    return ageInSeconds >= config.SAFETY.MIN_TOKEN_AGE_SECONDS;
  }

  checkPriceAction(token) {
    const priceMultiplier = token.currentPrice / token.initialPrice;
    if (priceMultiplier > config.SAFETY.MAX_PUMP_MULTIPLE) return false;
    if (token.priceVolatility > config.SAFETY.MAX_PRICE_VOLATILITY) return false;
    return true;
  }

  checkTradingPatterns(token) {
    if (token.uniqueBuyers < config.SAFETY.MIN_UNIQUE_BUYERS) return false;
    
    const avgTradeSizeUSD = token.avgTradeSize * config.SAFETY.SOL_PRICE_USD;
    if (avgTradeSizeUSD > config.SAFETY.MAX_AVG_TRADE_SIZE_USD) return false;
    
    const buySellRatio = token.buyCount / (token.buyCount + token.sellCount);
    if (buySellRatio < config.SAFETY.MIN_BUY_SELL_RATIO) return false;
    
    if (token.maxWalletVolumePercentage > config.SAFETY.MAX_SINGLE_WALLET_VOLUME) return false;
    
    return true;
  }

  getTradingPatternRejectionReason(token) {
    if (token.uniqueBuyers < config.SAFETY.MIN_UNIQUE_BUYERS) return 'insufficientBuyers';
    if (token.avgTradeSize * config.SAFETY.SOL_PRICE_USD > config.SAFETY.MAX_AVG_TRADE_SIZE_USD) return 'tradeSizeTooHigh';
    if (token.buyCount / (token.buyCount + token.sellCount) < config.SAFETY.MIN_BUY_SELL_RATIO) return 'lowBuySellRatio';
    if (token.maxWalletVolumePercentage > config.SAFETY.MAX_SINGLE_WALLET_VOLUME) return 'walletConcentration';
    return null;
  }

  checkHolderDistribution(token) {
    if (!this.hasEnoughHolders(token)) return false;
    if (!this.isHolderConcentrationSafe(token)) return false;
    if (token.minHolderWalletAge < config.SAFETY.MIN_HOLDER_WALLET_AGE) return false;
    return true;
  }

  getHolderDistributionRejectionReason(token) {
    if (!this.hasEnoughHolders(token)) return 'insufficientHolders';
    if (!this.isHolderConcentrationSafe(token)) return 'concentrationTooHigh';
    if (token.minHolderWalletAge < config.SAFETY.MIN_HOLDER_WALLET_AGE) return 'walletAgeTooLow';
    return null;
  }

  checkVolumePatterns(token) {
    if (token.volumePriceCorrelation < config.SAFETY.MIN_VOLUME_PRICE_CORRELATION) return false;
    if (token.suspectedWashTradePercentage > config.SAFETY.MAX_WASH_TRADE_PERCENTAGE) return false;
    return true;
  }

  hasEnoughHolders(token) {
    return token.holderCount >= config.SAFETY.MIN_HOLDERS;
  }

  isHolderConcentrationSafe(token) {
    return token.topHolderConcentration <= config.SAFETY.MAX_TOP_HOLDER_CONCENTRATION;
  }

  isCreatorFullyExited(token) {
    return token.creatorExited;
  }

  checkAll(token) {
    return this.checkMarketCap(token) &&
           this.checkTokenAge(token) &&
           this.checkPriceAction(token) &&
           this.checkTradingPatterns(token) &&
           this.checkHolderDistribution(token) &&
           this.checkVolumePatterns(token);
  }

  getSafetyMetrics() {
    return this.safetyLogger.getSummaryMetrics();
  }
}

module.exports = SafetyChecker;
