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

    // Trading safety thresholds
    this.safetyConfig = {
      MIN_VOLUME_SOL: 10,             // Minimum 10 SOL volume
      MIN_TRADES: 50,                 // Minimum 50 trades
      MAX_AGE_MS: 3600000,           // 1 hour maximum age
      MIN_NEW_HOLDERS: 10,            // Minimum 10 new holders in 5 minutes
      MIN_BUY_SELL_RATIO: 1.5,       // 1.5x more buys than sells
      MAX_VOLATILITY: 0.5,           // Maximum 50% volatility
      HOLDER_CHECK_WINDOW_MS: 300000, // 5 minutes for holder growth check
    };
  }

  getRecentHolderGrowth(token) {
    const currentTime = Date.now();
    const windowStart = currentTime - this.safetyConfig.HOLDER_CHECK_WINDOW_MS;
    
    const recentHolderEvents = token.holderHistory?.filter(event => event.timestamp > windowStart) || [];
    if (recentHolderEvents.length < 2) return 0;
    
    const oldestCount = recentHolderEvents[0].count;
    const newestCount = recentHolderEvents[recentHolderEvents.length - 1].count;
    return newestCount - oldestCount;
  }

  checkMarketActivity(token) {
    const result = {
      safe: true,
      reasons: []
    };

    // Check volume
    const totalVolume = token.volume;
    if (totalVolume < this.safetyConfig.MIN_VOLUME_SOL) {
      result.safe = false;
      result.reasons.push(`Insufficient volume (${totalVolume.toFixed(2)} < ${this.safetyConfig.MIN_VOLUME_SOL} SOL)`);
    }

    // Check trade count
    if (token.tradeCount < this.safetyConfig.MIN_TRADES) {
      result.safe = false;
      result.reasons.push(`Insufficient trades (${token.tradeCount} < ${this.safetyConfig.MIN_TRADES})`);
    }

    // Check age
    const tokenAge = Date.now() - token.createdAt;
    if (tokenAge > this.safetyConfig.MAX_AGE_MS) {
      result.safe = false;
      result.reasons.push(`Token too old (${(tokenAge / 1000 / 60).toFixed(2)} minutes)`);
    }

    // Check holder growth
    const recentHolders = this.getRecentHolderGrowth(token);
    if (recentHolders < this.safetyConfig.MIN_NEW_HOLDERS) {
      result.safe = false;
      result.reasons.push(`Insufficient holder growth (${recentHolders} < ${this.safetyConfig.MIN_NEW_HOLDERS} new holders in 5m)`);
    }

    // Check volatility
    const volatility = token.calculateVolatility(token.ohlcvData.secondly.slice(-30));
    if (volatility > this.safetyConfig.MAX_VOLATILITY) {
      result.safe = false;
      result.reasons.push(`Excessive volatility (${(volatility * 100).toFixed(2)}% > ${(this.safetyConfig.MAX_VOLATILITY * 100)}%)`);
    }

    // Check buy/sell ratio
    const buyCount = token.ohlcvData.secondly.reduce((count, candle) => count + (candle.buyCount || 0), 0);
    const sellCount = token.ohlcvData.secondly.reduce((count, candle) => count + (candle.sellCount || 0), 0);
    const buySellRatio = sellCount > 0 ? buyCount / sellCount : 0;
    
    if (buySellRatio < this.safetyConfig.MIN_BUY_SELL_RATIO) {
      result.safe = false;
      result.reasons.push(`Insufficient buy pressure (${buySellRatio.toFixed(2)}x < ${this.safetyConfig.MIN_BUY_SELL_RATIO}x)`);
    }

    return result;
  }

  isTokenSafe(token) {
    const result = {
      safe: true,
      reasons: []
    };

    // Check minimum token age (5 minutes)
    const tokenAge = (Date.now() - token.createdAt) / 1000;
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

    // Only check market activity if we're in recovery phase
    if (token.pumpState.firstDipDetected && !token.pumpState.inCooldown) {
      const activityCheck = this.checkMarketActivity(token);
      if (!activityCheck.safe) {
        result.safe = false;
        result.reasons.push(...activityCheck.reasons);
      }
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

    return {
      allowed: true,
      reasons: []
    };
  }
}

module.exports = SafetyChecker;
