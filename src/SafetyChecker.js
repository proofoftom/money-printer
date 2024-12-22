class SafetyChecker {
  async isTokenSafe(token) {
    if (!this.shouldRetrySafetyChecks(token)) {
      return false;
    }

    // Check holder concentration
    if (token.getTopHolderConcentration(10) > 30) {
      token.addSafetyReason("Top holder concentration too high");
      return false;
    }

    // Future API checks would go here
    return true;
  }

  shouldRetrySafetyChecks(token) {
    if (!token.safetyReasons.length) return true; // No previous checks, go ahead

    const lastCheck = token.safetyReasons[token.safetyReasons.length - 1].time;
    const timeSinceLastCheck = Date.now() - lastCheck;

    // Only retry if:
    // 1. At least 5 seconds since last check
    // 2. Price hasn't increased more than 20% since second pump started
    if (timeSinceLastCheck < 5000) {
      return false; // Too soon to check again
    }

    const priceIncrease =
      ((token.marketCapSol - token.pumpMetrics.secondPump.startMarketCap) /
        token.pumpMetrics.secondPump.startMarketCap) *
      100;

    return priceIncrease <= 20; // Only continue checking if pump hasn't grown too much
  }
}

module.exports = SafetyChecker;
