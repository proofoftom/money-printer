const config = require('./config');

class SafetyChecker {
  constructor(customConfig = {}) {
    this.config = {
      THRESHOLDS: {
        MIN_HOLDERS: customConfig.THRESHOLDS?.MIN_HOLDERS || config.THRESHOLDS.MIN_HOLDERS || 25,
        MAX_TOP_HOLDER_CONCENTRATION: customConfig.THRESHOLDS?.MAX_TOP_HOLDER_CONCENTRATION || config.THRESHOLDS.MAX_TOP_HOLDER_CONCENTRATION || 30,
        MAX_ENTRY_CAP: customConfig.THRESHOLDS?.MAX_ENTRY_CAP || config.THRESHOLDS.MAX_ENTRY_CAP || 250,
        DEAD: customConfig.THRESHOLDS?.DEAD || config.THRESHOLDS.DEAD || 5,
        MAX_INITIAL_PRICE_MULT: customConfig.THRESHOLDS?.MAX_INITIAL_PRICE_MULT || config.THRESHOLDS.MAX_INITIAL_PRICE_MULT || 3,
        MIN_TIME_SINCE_CREATION: customConfig.THRESHOLDS?.MIN_TIME_SINCE_CREATION || config.THRESHOLDS.MIN_TIME_SINCE_CREATION || 30,
      }
    };
  }

  runSecurityChecks(token) {
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
    return token.hasCreatorFullyExited();
  }

  isTokenSafe(marketData) {
    // Check if market cap is below maximum entry threshold
    if (marketData.marketCap > this.config.THRESHOLDS.MAX_ENTRY_CAP) {
      console.log(`Market cap ${marketData.marketCap} exceeds maximum entry threshold of ${this.config.THRESHOLDS.MAX_ENTRY_CAP}`);
      return false;
    }

    // Check if market cap is above minimum (DEAD) threshold
    if (marketData.marketCap < this.config.THRESHOLDS.DEAD) {
      console.log(`Market cap ${marketData.marketCap} is below minimum threshold of ${this.config.THRESHOLDS.DEAD}`);
      return false;
    }

    // Check if token is too new (avoid frontrunning bots)
    const timeSinceCreation = (Date.now() - marketData.creationTime) / 1000; // convert to seconds
    if (timeSinceCreation < this.config.THRESHOLDS.MIN_TIME_SINCE_CREATION) {
      console.log(`Token is too new. Only ${timeSinceCreation.toFixed(0)} seconds old, minimum required is ${this.config.THRESHOLDS.MIN_TIME_SINCE_CREATION} seconds`);
      return false;
    }

    // Check if price has pumped too much from initial
    const priceMultiplier = marketData.currentPrice / marketData.initialPrice;
    if (priceMultiplier > this.config.THRESHOLDS.MAX_INITIAL_PRICE_MULT) {
      console.log(`Price has pumped ${priceMultiplier.toFixed(2)}x from initial, maximum allowed is ${this.config.THRESHOLDS.MAX_INITIAL_PRICE_MULT}x`);
      return false;
    }

    return true;
  }
}

module.exports = SafetyChecker;
