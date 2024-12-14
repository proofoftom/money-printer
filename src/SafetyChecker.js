// SafetyChecker component

class SafetyChecker {
  constructor(config = {}) {
    this.config = config;
    this.config.MAX_TOP_HOLDER_CONCENTRATION = this.config.MAX_TOP_HOLDER_CONCENTRATION || 30; // Default 30%
    this.config.MIN_HOLDERS = this.config.MIN_HOLDERS || 25; // Default 25 holders
    console.log("SafetyChecker initialized");
  }

  runSecurityChecks(token) {
    console.log("Running safety checks...");
    
    // Check minimum number of holders
    const holderCount = token.getHolderCount();
    if (holderCount < this.config.MIN_HOLDERS) {
      console.log(`Warning: Only ${holderCount} holders, minimum required is ${this.config.MIN_HOLDERS}`);
      return false;
    }
    
    // Check top holder concentration
    const topHolderConcentration = token.getTopHolderConcentration();
    if (topHolderConcentration > this.config.MAX_TOP_HOLDER_CONCENTRATION) {
      console.log(`Warning: Top 10 holders control ${topHolderConcentration.toFixed(2)}% of supply`);
      return false;
    }
    
    // If creator has sold all tokens, that's a good sign
    if (token.hasCreatorSoldAll()) {
      console.log(`Creator has fully exited their position - reduced risk`);
    }

    return true;
  }

  isCreatorFullyExited(token) {
    return token.hasCreatorSoldAll();
  }

  isHolderConcentrationSafe(token) {
    return token.getTopHolderConcentration() <= this.config.MAX_TOP_HOLDER_CONCENTRATION;
  }

  hasEnoughHolders(token) {
    return token.getHolderCount() >= this.config.MIN_HOLDERS;
  }
}

module.exports = SafetyChecker;
