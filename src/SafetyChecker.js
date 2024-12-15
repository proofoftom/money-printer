const config = require('./config');

class SafetyChecker {
  constructor(config, priceManager) {
    this.config = config;
    this.priceManager = priceManager;
  }

  async runSecurityChecks(token) {
    // Convert market cap to USD for all checks
    const marketCapUSD = this.priceManager.solToUSD(token.marketCapSol);

    // Check market cap thresholds
    if (marketCapUSD >= this.config.THRESHOLDS.MAX_ENTRY_CAP_USD) {
      console.log(`Market cap $${marketCapUSD.toFixed(2)} exceeds maximum entry threshold of $${this.config.THRESHOLDS.MAX_ENTRY_CAP_USD}`);
      return false;
    }

    if (marketCapUSD <= this.config.THRESHOLDS.DEAD_USD) {
      console.log(`Market cap $${marketCapUSD.toFixed(2)} is below minimum threshold of $${this.config.THRESHOLDS.DEAD_USD}`);
      return false;
    }

    // Check if we have enough holders
    if (!this.hasEnoughHolders(token)) {
      console.log(
        `Warning: Only ${token.getHolderCount()} holders, minimum required is ${this.config.THRESHOLDS.MIN_HOLDERS}`
      );
      return false;
    }

    // Check holder concentration
    if (!this.isHolderConcentrationSafe(token)) {
      const concentration = token.getTopHolderConcentration(10);
      console.log(
        `Warning: Top holders control ${Math.round(concentration)}% of supply, maximum allowed is ${this.config.THRESHOLDS.MAX_TOP_HOLDER_CONCENTRATION}%`
      );
      return false;
    }

    // Check if creator has exited
    if (this.isCreatorFullyExited(token)) {
      console.log("Creator has fully exited their position - reduced risk");
    }

    // Check time since creation
    const timeSinceCreation = (Date.now() - token.createdAt) / 1000;
    if (timeSinceCreation < this.config.THRESHOLDS.MIN_TIME_SINCE_CREATION) {
      console.log(`Token is too new. Only ${timeSinceCreation.toFixed(0)} seconds old, minimum required is ${this.config.THRESHOLDS.MIN_TIME_SINCE_CREATION} seconds`);
      return false;
    }

    // Check trading patterns
    const avgTradeSizeUSD = this.priceManager.solToUSD(token.getAverageTradeSize());
    if (avgTradeSizeUSD > this.config.THRESHOLDS.MAX_AVG_TRADE_SIZE_USD) {
      console.log(`Average trade size $${avgTradeSizeUSD.toFixed(2)} exceeds maximum of $${this.config.THRESHOLDS.MAX_AVG_TRADE_SIZE_USD}`);
      return false;
    }

    return true;
  }

  hasEnoughHolders(token) {
    const holderCount = token.getHolderCount();
    return holderCount >= this.config.THRESHOLDS.MIN_HOLDERS;
  }

  isHolderConcentrationSafe(token) {
    const concentration = token.getTopHolderConcentration(10);
    return concentration <= this.config.THRESHOLDS.MAX_TOP_HOLDER_CONCENTRATION;
  }

  isCreatorFullyExited(token) {
    return token.hasCreatorSoldAll();
  }

  isTokenSafe(marketData) {
    // Market Cap Checks
    if (!this.checkMarketCap(marketData)) return false;

    // Time and Age Checks
    if (!this.checkTimeAndAge(marketData)) return false;

    // Price Action Checks
    if (!this.checkPriceAction(marketData)) return false;

    // Trading Pattern Checks
    if (!this.checkTradingPatterns(marketData)) return false;

    // Holder Distribution Checks
    if (!this.checkHolderDistribution(marketData)) return false;

    // Volume Pattern Checks
    if (!this.checkVolumePatterns(marketData)) return false;

    return true;
  }

  checkMarketCap(marketData) {
    const marketCapUSD = this.priceManager.solToUSD(marketData.marketCapSol);

    if (marketCapUSD >= this.config.THRESHOLDS.MAX_ENTRY_CAP_USD) {
      console.log(`Market cap $${marketCapUSD.toFixed(2)} exceeds maximum entry threshold of $${this.config.THRESHOLDS.MAX_ENTRY_CAP_USD}`);
      return false;
    }

    if (marketCapUSD <= this.config.THRESHOLDS.DEAD_USD) {
      console.log(`Market cap $${marketCapUSD.toFixed(2)} is below minimum threshold of $${this.config.THRESHOLDS.DEAD_USD}`);
      return false;
    }

    return true;
  }

  checkTimeAndAge(marketData) {
    const timeSinceCreation = (Date.now() - marketData.creationTime) / 1000;
    if (timeSinceCreation < this.config.THRESHOLDS.MIN_TIME_SINCE_CREATION) {
      console.log(`Token is too new. Only ${timeSinceCreation.toFixed(0)} seconds old, minimum required is ${this.config.THRESHOLDS.MIN_TIME_SINCE_CREATION} seconds`);
      return false;
    }

    return true;
  }

  checkPriceAction(marketData) {
    // Check initial price pump
    const priceMultiplier = marketData.currentPrice / marketData.initialPrice;
    if (priceMultiplier > this.config.THRESHOLDS.MAX_INITIAL_PRICE_MULT) {
      console.log(`Price has pumped ${priceMultiplier.toFixed(2)}x from initial, maximum allowed is ${this.config.THRESHOLDS.MAX_INITIAL_PRICE_MULT}x`);
      return false;
    }

    // Check price volatility
    if (marketData.priceVolatility > this.config.THRESHOLDS.MAX_PRICE_VOLATILITY) {
      console.log(`Price volatility ${marketData.priceVolatility.toFixed(2)}% exceeds maximum of ${this.config.THRESHOLDS.MAX_PRICE_VOLATILITY}%`);
      return false;
    }

    return true;
  }

  checkTradingPatterns(marketData) {
    // Check unique buyers
    if (marketData.uniqueBuyers < this.config.THRESHOLDS.MIN_UNIQUE_BUYERS) {
      console.log(`Only ${marketData.uniqueBuyers} unique buyers, minimum required is ${this.config.THRESHOLDS.MIN_UNIQUE_BUYERS}`);
      return false;
    }

    // Check average trade size
    const avgTradeSizeUSD = this.priceManager.solToUSD(marketData.avgTradeSize);
    if (avgTradeSizeUSD > this.config.THRESHOLDS.MAX_AVG_TRADE_SIZE_USD) {
      console.log(`Average trade size $${avgTradeSizeUSD.toFixed(2)} exceeds maximum of $${this.config.THRESHOLDS.MAX_AVG_TRADE_SIZE_USD}`);
      return false;
    }

    // Check buy/sell ratio
    const buySellRatio = marketData.buyCount / (marketData.buyCount + marketData.sellCount);
    if (buySellRatio < this.config.THRESHOLDS.MIN_BUY_SELL_RATIO) {
      console.log(`Buy/Sell ratio ${(buySellRatio * 100).toFixed(2)}% below minimum of ${(this.config.THRESHOLDS.MIN_BUY_SELL_RATIO * 100)}%`);
      return false;
    }

    // Check single wallet volume
    if (marketData.maxWalletVolumePercentage > this.config.THRESHOLDS.MAX_SINGLE_WALLET_VOLUME) {
      console.log(`Single wallet accounts for ${marketData.maxWalletVolumePercentage.toFixed(2)}% of volume, maximum allowed is ${this.config.THRESHOLDS.MAX_SINGLE_WALLET_VOLUME}%`);
      return false;
    }

    return true;
  }

  checkHolderDistribution(marketData) {
    // Check minimum holders
    if (marketData.holderCount < this.config.THRESHOLDS.MIN_HOLDERS) {
      console.log(`Only ${marketData.holderCount} holders, minimum required is ${this.config.THRESHOLDS.MIN_HOLDERS}`);
      return false;
    }

    // Check holder concentration
    if (marketData.topHolderConcentration > this.config.THRESHOLDS.MAX_TOP_HOLDER_CONCENTRATION) {
      console.log(`Top holders control ${marketData.topHolderConcentration.toFixed(2)}% of supply, maximum allowed is ${this.config.THRESHOLDS.MAX_TOP_HOLDER_CONCENTRATION}%`);
      return false;
    }

    // Check holder wallet age
    if (marketData.minHolderWalletAge < this.config.THRESHOLDS.MIN_HOLDER_WALLET_AGE) {
      console.log(`Newest holder wallet is ${marketData.minHolderWalletAge} days old, minimum required is ${this.config.THRESHOLDS.MIN_HOLDER_WALLET_AGE} days`);
      return false;
    }

    return true;
  }

  checkVolumePatterns(marketData) {
    // Check volume-price correlation
    if (marketData.volumePriceCorrelation < this.config.THRESHOLDS.MIN_VOLUME_PRICE_CORRELATION) {
      console.log(`Volume-price correlation ${marketData.volumePriceCorrelation.toFixed(2)} below minimum of ${this.config.THRESHOLDS.MIN_VOLUME_PRICE_CORRELATION}`);
      return false;
    }

    // Check for wash trading
    if (marketData.suspectedWashTradePercentage > this.config.THRESHOLDS.MAX_WASH_TRADE_PERCENTAGE) {
      console.log(`${marketData.suspectedWashTradePercentage.toFixed(2)}% of trades suspected as wash trades, maximum allowed is ${this.config.THRESHOLDS.MAX_WASH_TRADE_PERCENTAGE}%`);
      return false;
    }

    return true;
  }
}

module.exports = SafetyChecker;
