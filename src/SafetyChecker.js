const EventEmitter = require('events');
const config = require("./config");
const STATES = require('./constants/STATES');

class SafetyChecker extends EventEmitter {
  constructor(wallet, priceManager, logger) {
    super();
    if (!wallet) throw new Error('Wallet is required for SafetyChecker');
    if (!priceManager) throw new Error('PriceManager is required for SafetyChecker');
    if (!logger) throw new Error('Logger is required for SafetyChecker');
    
    this.wallet = wallet;
    this.priceManager = priceManager;
    this.logger = logger;
    this.config = config;

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
    try {
      const reasons = [];
      let safe = true;

      // Get multipliers based on token state
      const multipliers = token.state === STATES.MATURE ? 
        this.config.MATURE_TOKEN_MULTIPLIERS : 
        { safetyThreshold: 1, minConfidence: 1, minVolume: 1 };

      // Token age check
      const tokenAge = Date.now() - token.createdAt;
      if (tokenAge < this.config.MIN_TOKEN_AGE_SECONDS * 1000) {
        safe = false;
        reasons.push(`Token too new (${(tokenAge / 1000).toFixed(2)} < ${this.config.MIN_TOKEN_AGE_SECONDS} seconds)`);
      }

      // Basic checks
      if (token.getDrawdownPercentage() >= 90) {
        safe = false;
        reasons.push('Token has experienced >90% drawdown');
      }

      // Volume checks
      const minVolume = this.config.MIN_VOLUME_SOL * multipliers.minVolume;
      if (token.volume < minVolume) {
        safe = false;
        reasons.push(`Volume too low: ${token.volume} < ${minVolume}`);
      }

      // Confidence check
      const minConfidence = this.config.MIN_CONFIDENCE_FOR_ENTRY * multipliers.minConfidence;
      if (token.confidence < minConfidence) {
        safe = false;
        reasons.push(`Confidence too low: ${token.confidence} < ${minConfidence}`);
      }

      // Holder concentration check
      const maxHolderConcentration = this.config.MAX_HOLDER_CONCENTRATION / multipliers.safetyThreshold;
      const topHolderConcentration = token.getTopHolderConcentration(3);
      if (topHolderConcentration > maxHolderConcentration) {
        safe = false;
        reasons.push(`Top holder concentration too high: ${topHolderConcentration}% > ${maxHolderConcentration}%`);
      }

      // Market activity checks
      if (token.state === STATES.READY || token.state === STATES.MATURE) {
        const timeSinceLastTrade = Date.now() - (token.lastTradeTime || 0);
        if (timeSinceLastTrade > this.config.MAX_TIME_SINCE_LAST_TRADE) {
          safe = false;
          reasons.push(`No recent trades: ${timeSinceLastTrade}ms since last trade`);
        }

        // Check cycle quality for mature tokens
        if (token.state === STATES.MATURE) {
          const lastCycleQuality = token.cycleQualityScores[token.cycleQualityScores.length - 1]?.score || 0;
          if (lastCycleQuality < this.config.MIN_CYCLE_QUALITY_SCORE) {
            safe = false;
            reasons.push(`Cycle quality score too low: ${lastCycleQuality}`);
          }
        }
      }

      return { safe, reasons };
    } catch (error) {
      this.logger.error('Error in isTokenSafe', {
        error: error.message,
        tokenMint: token.mint
      });
      return { safe: false, reasons: ['Error checking token safety'] };
    }
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
    const minSize = token.marketCapSol * this.config.MIN_MCAP_POSITION;
    const maxSize = token.marketCapSol * this.config.MAX_MCAP_POSITION;

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

    const result = {
      allowed: true,
      reasons: []
    };

    this.emit('safetyCheck', {
      token,
      result,
      type: 'openPosition'
    });

    return result;
  }
}

module.exports = SafetyChecker;
