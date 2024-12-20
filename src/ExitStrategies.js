/**
 * Exit Strategies for Position Management
 * 
 * Implements various exit strategies for managing positions:
 * 
 * Basic Strategies (Always Enabled):
 * - Stop Loss: Exit when price drops below threshold
 * - Take Profit: Exit when price rises above threshold
 * - Trailing Stop: Exit when price drops from highest by threshold
 * 
 * OHLCV Strategies (Enabled by Default):
 * - Volume Drop: Exit on significant volume decrease
 * - Price Velocity: Exit on rapid price decline
 * - Score-based: Exit when token metrics fall below thresholds
 * 
 * Advanced Strategies (Disabled by Default):
 * - Candlestick Patterns: Exit on bearish patterns
 * - Dynamic Take-Profit: Adjust take-profit based on pump strength
 * - Time-based: Exit after maximum time in position
 * 
 * Configuration Options:
 * ```javascript
 * {
 *   // Basic Strategy Config
 *   stopLossPortion: 1.0,        // Portion of position to exit on stop loss
 *   takeProfitPortion: 1.0,      // Portion of position to exit on take profit
 *   trailingStopLevel: 20,       // % drop from highest price to trigger exit
 *   
 *   // OHLCV Strategy Config
 *   volumeDropEnabled: true,      // Enable volume-based exits
 *   volumeDropThreshold: -50,     // Exit on 50% volume drop
 *   priceVelocityEnabled: true,   // Enable velocity-based exits
 *   priceVelocityThreshold: -0.1, // Price change per second threshold
 *   scoreBasedEnabled: true,      // Enable score-based exits
 *   minimumScoreThreshold: 30,    // Minimum acceptable overall score
 *   
 *   // Advanced Strategy Config
 *   candlePatternsEnabled: false, // Enable pattern recognition
 *   dynamicTakeProfitEnabled: false, // Enable dynamic take-profit
 *   timeBasedExitEnabled: false,  // Enable time-based exits
 *   maxTimeInPosition: 3600000    // Max time in position (ms)
 * }
 * ```
 */
class ExitStrategies {
  constructor(logger) {
    // Default values that can be overridden by position config
    this.defaultConfig = {
      // Basic exit strategies (always enabled)
      stopLossPortion: 1.0,    // Full exit on stop loss by default
      takeProfitPortion: 1.0,  // Full exit on take profit by default
      trailingStopLevel: 20,   // 20% drop from highest price
      trailingStopPortion: 1.0, // Full exit on trailing stop by default
      
      // OHLCV-based exit strategies
      volumeDropEnabled: true,           // Exit on significant volume drop
      volumeDropThreshold: -50,          // Exit if volume drops 50% from peak
      priceVelocityEnabled: true,        // Exit on rapid price decline
      priceVelocityThreshold: -0.1,      // Price change per second threshold
      scoreBasedEnabled: true,           // Use token's score for exit decisions
      minimumScoreThreshold: 30,         // Minimum acceptable overall score
      
      // Advanced strategies (disabled by default)
      candlePatternsEnabled: false,      // Use candlestick patterns for exits
      dynamicTakeProfitEnabled: false,   // Adjust take-profit based on pump strength
      timeBasedExitEnabled: false,       // Exit based on time in position
      maxTimeInPosition: 3600000,        // 1 hour default max time in position
      
      // Score thresholds
      priceScoreThreshold: 30,
      volumeScoreThreshold: 30,
      timeScoreThreshold: 30
    };
    this.logger = logger;
  }

  checkExitSignals(position) {
    try {
      // Skip if position is not open
      if (position.state !== 'OPEN') {
        return null;
      }

      // Risk management checks (prioritized)
      const trailingStopResult = this.checkTrailingStop(position);
      if (trailingStopResult) {
        this.logger.info('Trailing stop triggered', {
          symbol: position.token.symbol,
          currentPrice: position.currentPrice,
          highestPrice: position.highestPrice,
          dropPercent: ((position.highestPrice - position.currentPrice) / position.highestPrice) * 100
        });
        return trailingStopResult;
      }

      const stopLossResult = this.checkStopLoss(position);
      if (stopLossResult) {
        this.logger.info('Stop loss triggered', {
          symbol: position.token.symbol,
          currentPrice: position.currentPrice,
          entryPrice: position.entryPrice,
          lossPercent: ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100
        });
        return stopLossResult;
      }

      // Profit taking checks
      const takeProfitResult = this.checkTakeProfit(position);
      if (takeProfitResult) {
        this.logger.info('Take profit triggered', {
          symbol: position.token.symbol,
          currentPrice: position.currentPrice,
          entryPrice: position.entryPrice,
          profitPercent: ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100
        });
        return takeProfitResult;
      }

      // Market condition checks
      const volatilityResult = this.checkVolatility(position);
      if (volatilityResult) {
        this.logger.info('High volatility exit triggered', {
          symbol: position.token.symbol,
          volatility: position.token.indicators.volatility,
          portion: volatilityResult.portion
        });
        return volatilityResult;
      }

      // OHLCV-based exit conditions
      const volumeDropResult = this.checkVolumeDrop(position);
      if (volumeDropResult) {
        this.logger.info('Volume drop exit triggered', {
          symbol: position.token.symbol,
          relativeVolume: position.token.indicators.volumeProfile.get('relativeVolume'),
          threshold: position.config.volumeDropThreshold
        });
        return volumeDropResult;
      }

      const priceVelocityResult = this.checkPriceVelocity(position);
      if (priceVelocityResult) {
        this.logger.info('Price velocity exit triggered', {
          symbol: position.token.symbol,
          velocity: position.token.indicators.priceVelocity,
          threshold: position.config.priceVelocityThreshold
        });
        return priceVelocityResult;
      }

      return null;
    } catch (error) {
      this.logger.error('Error checking exit signals', {
        error: error.message,
        position: position.symbol
      });
      return null;
    }
  }

  checkStopLoss(position) {
    const { stopLossLevel } = position.config;
    const percentageChange = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;

    if (percentageChange <= -stopLossLevel) {
      return {
        reason: 'STOP_LOSS',
        portion: 1.0
      };
    }
    return null;
  }

  checkTakeProfit(position) {
    const { takeProfitLevel } = position.config;
    const percentageChange = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;

    if (percentageChange >= takeProfitLevel) {
      return {
        reason: 'TAKE_PROFIT',
        portion: 1.0
      };
    }
    return null;
  }

  checkTrailingStop(position) {
    const { trailingStopLevel } = position.config;
    if (!position.highestPrice) return null;

    const dropFromHigh = ((position.highestPrice - position.currentPrice) / position.highestPrice) * 100;

    if (dropFromHigh >= trailingStopLevel) {
      return {
        reason: 'TRAILING_STOP',
        portion: 1.0
      };
    }
    return null;
  }

  checkVolumeDrop(position) {
    if (!position.config.volumeDropEnabled) return null;

    const volumeProfile = position.token.indicators.volumeProfile;
    if (!volumeProfile || !volumeProfile.has('relativeVolume')) return null;

    const relativeVolume = volumeProfile.get('relativeVolume');
    const threshold = position.config.volumeDropThreshold;

    if (relativeVolume <= threshold) {
      return {
        reason: 'VOLUME_DROP',
        portion: 1.0
      };
    }
    return null;
  }

  checkPriceVelocity(position) {
    if (!position.config.priceVelocityEnabled) return null;

    const priceVelocity = position.token.indicators.priceVelocity;
    if (priceVelocity === undefined || priceVelocity === null) return null;

    const threshold = position.config.priceVelocityThreshold;

    if (priceVelocity <= threshold) {
      return {
        reason: 'PRICE_VELOCITY',
        portion: 1.0
      };
    }
    return null;
  }

  checkVolatility(position) {
    const volatility = position.token.indicators.volatility;
    if (volatility === undefined || volatility === null) return null;

    // Exit if volatility is very high (above 0.4)
    if (volatility >= 0.4) {
      const portion = Math.max(0.2, Math.min(0.8, 1 - volatility));  // Scale portion based on volatility
      return {
        reason: 'HIGH_VOLATILITY',
        portion
      };
    }
    return null;
  }

  calculatePositionSize(token, baseSize) {
    try {
      const riskFactors = this.calculateRiskFactors(token);
      const adjustedSize = this.adjustSizeForRisk(baseSize, riskFactors);
      
      this.logger.debug('Position size calculation', {
        token: token.symbol,
        baseSize,
        riskFactors,
        adjustedSize
      });
      
      return {
        size: adjustedSize,
        riskFactors,
        reason: this.getSizeAdjustmentReason(riskFactors)
      };
    } catch (error) {
      this.logger.error('Error calculating position size', {
        token: token.symbol,
        error: error.message
      });
      return { size: 0, reason: 'ERROR' };
    }
  }

  calculateRiskFactors(token) {
    const factors = {
      volatility: 1.0,
      liquidity: 1.0,
      momentum: 1.0,
      safety: 1.0
    };

    try {
      // Volatility Factor (more sensitive to high volatility)
      const volatility = token.indicators.volatility || 0;
      factors.volatility = Math.max(0.2, Math.min(1.0, 1 - (volatility * 3)));  // More aggressive reduction

      // Liquidity Factor
      const volumeProfile = token.indicators.volumeProfile;
      if (volumeProfile) {
        const relativeVolume = volumeProfile.get('relativeVolume');
        factors.liquidity = Math.min(1.0, Math.max(0.2, relativeVolume / 150));  // Normalized to 150%
      } else {
        factors.liquidity = 0.3;  // Conservative default
      }

      // Momentum Factor (more weight on negative momentum)
      const priceVelocity = token.indicators.priceVelocity || 0;
      factors.momentum = Math.min(1.0, Math.max(0.2,
        priceVelocity < 0 
          ? 1 + (priceVelocity * 2)  // Faster reduction for negative momentum
          : 1 + (priceVelocity * 0.5) // Slower increase for positive momentum
      ));

      // Safety Factor (more conservative)
      const safetyScore = token.indicators.safetyScore || 0;
      factors.safety = Math.max(0.2, Math.min(1.0, safetyScore / 120));  // Normalized to 120%

      this.logger.debug('Risk factors calculated', {
        token: token.symbol,
        factors,
        inputs: {
          volatility,
          relativeVolume: volumeProfile?.get('relativeVolume'),
          priceVelocity,
          safetyScore
        }
      });

      return factors;
    } catch (error) {
      this.logger.error('Error calculating risk factors', {
        token: token.symbol,
        error: error.message
      });
      // Return conservative factors on error
      return {
        volatility: 0.3,
        liquidity: 0.3,
        momentum: 0.3,
        safety: 0.3
      };
    }
  }

  adjustSizeForRisk(baseSize, factors) {
    try {
      // Calculate weighted risk score
      const weights = {
        volatility: 0.35,  // Increased weight
        liquidity: 0.25,
        momentum: 0.15,
        safety: 0.25
      };

      const riskScore = Object.entries(factors).reduce((score, [factor, value]) => {
        return score + (value * weights[factor]);
      }, 0);

      // Apply more aggressive non-linear adjustment
      const adjustment = Math.pow(riskScore, 2);  // Quadratic reduction
      const finalSize = baseSize * Math.min(1.0, adjustment);

      this.logger.debug('Position size adjustment', {
        baseSize,
        riskScore,
        adjustment,
        finalSize
      });

      return finalSize;
    } catch (error) {
      this.logger.error('Error adjusting size for risk', {
        error: error.message
      });
      return baseSize * 0.3;  // Conservative fallback
    }
  }

  getSizeAdjustmentReason(factors) {
    const lowestFactor = Object.entries(factors).reduce((lowest, [factor, value]) => {
      return value < lowest.value ? { factor, value } : lowest;
    }, { factor: null, value: 1 });

    if (lowestFactor.value < 0.5) {
      return `HIGH_${lowestFactor.factor.toUpperCase()}`;
    }
    
    return 'NORMAL';
  }
}

module.exports = ExitStrategies;
