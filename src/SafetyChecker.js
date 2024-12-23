const { EventEmitter } = require("events");

class SafetyChecker extends EventEmitter {
  constructor(wallet, priceManager, logger) {
    super();
    if (!wallet) throw new Error("Wallet is required for SafetyChecker");
    if (!priceManager)
      throw new Error("PriceManager is required for SafetyChecker");
    if (!logger) throw new Error("Logger is required for SafetyChecker");

    this.logger = logger;
    this.wallet = wallet;
    this.priceManager = priceManager;
    this.lastCheckTimes = new Map(); // Track last check time per token
    this.DEBOUNCE_INTERVAL = 5000; // 5 seconds
    this.setMaxListeners(1000);
  }

  isTokenSafe(token) {
    try {
      // Check if we need to debounce
      const lastCheck = this.lastCheckTimes.get(token.address);
      const now = Date.now();
      if (lastCheck && now - lastCheck < this.DEBOUNCE_INTERVAL) {
        this.logger.debug("Debouncing safety check", {
          token: token.address,
          timeSinceLastCheck: now - lastCheck,
        });
        return true; // Skip check if within debounce interval
      }

      // Update last check time
      this.lastCheckTimes.set(token.address, now);

      // Perform safety checks
      const concentration = token.getTopHolderConcentration(10);
      if (concentration > 30) {
        token.addSafetyReason("Top holder concentration too high");
        this.emit(`safetyCheck:${token.address}`, {
          token,
          result: {
            safe: false,
            reasons: ["Top holder concentration too high"],
          },
          type: "holderConcentration",
        });
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error("Safety check failed:", {
        error: {
          message: error.message,
          stack: error.stack,
        },
        token: token.mint,
      });
      return false;
    }
  }

  cleanupToken(tokenAddress) {
    this.lastCheckTimes.delete(tokenAddress);
    this.logger.debug("Cleaned up safety check timers", {
      token: tokenAddress,
    });
  }
}

module.exports = SafetyChecker;
