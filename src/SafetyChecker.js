// SafetyChecker component

class SafetyChecker {
  constructor(config = {}) {
    this.MIN_HOLDERS = config.MIN_HOLDERS || 25;
    this.MAX_TOP_HOLDER_CONCENTRATION =
      config.MAX_TOP_HOLDER_CONCENTRATION || 30;
    this.MAX_ENTRY_CAP = config.MAX_ENTRY_CAP || 100000000;
    this.DEAD = config.DEAD || 100000;
  }

  runSecurityChecks(token) {
    // Check minimum holder count
    if (!this.hasEnoughHolders(token)) {
      console.log(
        `Warning: Only ${token.getHolderCount()} holders, minimum required is ${
          this.MIN_HOLDERS
        }`
      );
      return false;
    }

    // Check holder concentration
    if (!this.isHolderConcentrationSafe(token)) {
      const concentration = token.getTopHolderConcentration(10);
      console.log(
        `Warning: Top holders control ${Math.round(concentration)}% of supply, maximum allowed is ${this.MAX_TOP_HOLDER_CONCENTRATION}%`
      );
      return false;
    }

    // Check creator holdings - if they've sold all, that's a good sign
    if (token.hasCreatorSoldAll()) {
      console.log(`Creator has fully exited their position - reduced risk`);
    }

    return true;
  }

  hasEnoughHolders(token) {
    const holderCount = token.getHolderCount();
    return holderCount >= this.MIN_HOLDERS;
  }

  isHolderConcentrationSafe(token) {
    const concentration = token.getTopHolderConcentration(10);
    return concentration <= this.MAX_TOP_HOLDER_CONCENTRATION;
  }

  isCreatorFullyExited(token) {
    return token.hasCreatorSoldAll();
  }

  isTokenSafe(marketData) {
    // Check if market cap is below maximum entry threshold
    if (marketData.marketCap > this.MAX_ENTRY_CAP) {
      console.log(`Market cap ${marketData.marketCap} exceeds maximum entry threshold of ${this.MAX_ENTRY_CAP}`);
      return false;
    }

    // Check if market cap is above minimum (DEAD) threshold
    if (marketData.marketCap < this.DEAD) {
      console.log(`Market cap ${marketData.marketCap} is below minimum threshold of ${this.DEAD}`);
      return false;
    }

    return true;
  }
}

module.exports = SafetyChecker;
