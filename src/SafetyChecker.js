const config = require("./config");

class SafetyChecker {
  constructor(wallet, priceManager) {
    if (!wallet) throw new Error('Wallet is required for SafetyChecker');
    if (!priceManager) throw new Error('PriceManager is required for SafetyChecker');
    
    this.wallet = wallet;
    this.priceManager = priceManager;
  }

  isTokenSafe(token) {
    const result = {
      safe: true,
      reasons: []
    };

    // Check minimum token age (5 minutes)
    const tokenAge = (Date.now() - token.minted) / 1000;
    if (tokenAge < config.MIN_TOKEN_AGE_SECONDS) {
      result.safe = false;
      result.reasons.push(`Token too new (${Math.round(tokenAge)}s < ${config.MIN_TOKEN_AGE_SECONDS}s)`);
    }

    // Check market cap (max $100k)
    const marketCapUSD = this.priceManager.solToUSD(token.marketCapSol);
    if (marketCapUSD > config.MAX_ENTRY_MCAP_USD) {
      result.safe = false;
      result.reasons.push(`Market cap too high ($${Math.round(marketCapUSD)} > $${config.MAX_ENTRY_MCAP_USD})`);
    }

    // Check if we can afford minimum position (0.1% of market cap)
    const minPositionSize = token.marketCapSol * config.MIN_MCAP_POSITION;
    if (minPositionSize > this.wallet.getBalance()) {
      result.safe = false;
      result.reasons.push(`Insufficient balance for min position (${minPositionSize.toFixed(3)} SOL needed)`);
    }

    // Check if price is non-zero
    const currentPrice = token.getCurrentPrice();
    if (currentPrice <= 0) {
      result.safe = false;
      result.reasons.push('Zero or negative price');
    }

    // Check if bonding curve has liquidity
    if (token.vTokensInBondingCurve <= 0 || token.vSolInBondingCurve <= 0) {
      result.safe = false;
      result.reasons.push('Insufficient bonding curve liquidity');
    }

    return result;
  }
}

module.exports = SafetyChecker;
