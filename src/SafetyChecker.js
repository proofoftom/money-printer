const EventEmitter = require('events');
const config = require("./config");

class SafetyChecker extends EventEmitter {
  constructor(wallet, priceManager, logger) {
    super();
    if (!wallet) throw new Error('Wallet is required for SafetyChecker');
    if (!priceManager) throw new Error('PriceManager is required for SafetyChecker');
    if (!logger) throw new Error('Logger is required for SafetyChecker');
    
    this.wallet = wallet;
    this.priceManager = priceManager;
    this.logger = logger;
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

    // Check minimum liquidity
    if (token.liquiditySol < config.MIN_LIQUIDITY_SOL) {
      result.safe = false;
      result.reasons.push(`Insufficient liquidity (${token.liquiditySol.toFixed(2)} < ${config.MIN_LIQUIDITY_SOL} SOL)`);
    }

    // Check holder count
    if (token.holderCount < config.MIN_HOLDER_COUNT) {
      result.safe = false;
      result.reasons.push(`Too few holders (${token.holderCount} < ${config.MIN_HOLDER_COUNT})`);
    }

    // Check transaction count
    if (token.transactionCount < config.MIN_TRANSACTIONS) {
      result.safe = false;
      result.reasons.push(`Too few transactions (${token.transactionCount} < ${config.MIN_TRANSACTIONS})`);
    }

    // Check if wallet has enough balance for minimum position
    const minPositionSol = token.marketCapSol * config.MIN_MCAP_POSITION;
    if (this.wallet.balance < minPositionSol) {
      result.safe = false;
      result.reasons.push(`Insufficient balance for minimum position (${this.wallet.balance.toFixed(2)} < ${minPositionSol.toFixed(2)} SOL)`);
    }

    if (!result.safe) {
      this.emit('safetyCheck', {
        token,
        result,
        type: 'tokenSafety'
      });
      this.logger.logSafetyCheck(token, result, 'tokenSafety');
    }

    return result;
  }

  canOpenPosition(token, size) {
    // First check if token is safe
    const safetyCheck = this.isTokenSafe(token);
    if (!safetyCheck.safe) {
      const result = {
        allowed: false,
        reasons: safetyCheck.reasons
      };
      this.emit('safetyCheck', {
        token,
        result,
        type: 'openPosition'
      });
      this.logger.logSafetyCheck(token, result, 'openPosition');
      return result;
    }

    // Check if size is within allowed range
    const minSize = token.marketCapSol * config.MIN_MCAP_POSITION;
    const maxSize = token.marketCapSol * config.MAX_MCAP_POSITION;

    if (size < minSize) {
      const result = {
        allowed: false,
        reasons: [`Position size too small (${size.toFixed(4)} < ${minSize.toFixed(4)} SOL)`]
      };
      this.emit('safetyCheck', {
        token,
        result,
        type: 'positionSize'
      });
      this.logger.logSafetyCheck(token, result, 'positionSize');
      return result;
    }

    if (size > maxSize) {
      const result = {
        allowed: false,
        reasons: [`Position size too large (${size.toFixed(4)} > ${maxSize.toFixed(4)} SOL)`]
      };
      this.emit('safetyCheck', {
        token,
        result,
        type: 'positionSize'
      });
      this.logger.logSafetyCheck(token, result, 'positionSize');
      return result;
    }

    // Check if wallet has enough balance
    if (this.wallet.balance < size) {
      const result = {
        allowed: false,
        reasons: [`Insufficient balance (${this.wallet.balance.toFixed(4)} < ${size.toFixed(4)} SOL)`]
      };
      this.emit('safetyCheck', {
        token,
        result,
        type: 'balance'
      });
      this.logger.logSafetyCheck(token, result, 'balance');
      return result;
    }

    return {
      allowed: true,
      reasons: []
    };
  }
}

module.exports = SafetyChecker;
