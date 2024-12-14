// SafetyChecker component

class SafetyChecker {
  constructor(config = {}) {
    this.MIN_HOLDERS = config.MIN_HOLDERS || 25;
    this.MAX_TOP_HOLDER_CONCENTRATION =
      config.MAX_TOP_HOLDER_CONCENTRATION || 30;
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
      const concentration = token.getTopHolderConcentration(2);
      console.log(
        `Warning: Top holders control ${concentration}% of supply, maximum allowed is ${this.MAX_TOP_HOLDER_CONCENTRATION}%`
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
    const concentration = token.getTopHolderConcentration(2);
    return concentration <= this.MAX_TOP_HOLDER_CONCENTRATION;
  }

  isCreatorFullyExited(token) {
    return token.hasCreatorSoldAll();
  }
}

module.exports = SafetyChecker;
