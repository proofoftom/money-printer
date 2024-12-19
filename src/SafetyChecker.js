const config = require("./config");

class SafetyChecker {
  constructor(wallet, priceManager) {
    this.wallet = wallet;
    this.priceManager = priceManager;
  }

  isTokenSafe(token) {
    // Check minimum token age (5 minutes)
    const tokenAge = (Date.now() - token.minted) / 1000;
    if (tokenAge < config.MIN_TOKEN_AGE_SECONDS) {
      return false;
    }

    // Check market cap (max $100k)
    const marketCapUSD = this.priceManager.solToUSD(token.marketCapSol);
    if (marketCapUSD > config.MAX_ENTRY_MCAP_USD) {
      return false;
    }

    // Check if we can afford minimum position (0.1% of market cap)
    const minPositionSize = token.marketCapSol * config.MIN_MCAP_POSITION;
    if (minPositionSize > this.wallet.getBalance()) {
      return false;
    }

    // Check if price is non-zero
    const currentPrice = token.getCurrentPrice();
    if (currentPrice <= 0) {
      return false;
    }

    // Check if bonding curve has liquidity
    if (token.vTokensInBondingCurve <= 0 || token.vSolInBondingCurve <= 0) {
      return false;
    }

    return true;
  }
}

module.exports = SafetyChecker;
