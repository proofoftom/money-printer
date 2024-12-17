const EventEmitter = require("events");
const Token = require("./Token");
const config = require("../../utils/config");

class TokenManager extends EventEmitter {
  constructor(
    safetyChecker,
    positionManager,
    priceManager,
    webSocketManager
  ) {
    super();
    this.safetyChecker = safetyChecker;
    this.positionManager = positionManager;
    this.priceManager = priceManager;
    this.webSocketManager = webSocketManager;
    this.tokens = new Map();
    
    // Recovery monitoring
    this._recoveryInterval = setInterval(() => this.monitorRecoveryOpportunities(), 
      config.RECOVERY_MONITOR_INTERVAL || 30000);
  }

  handleNewToken(tokenData) {
    const token = new Token(tokenData);

    // Check market cap threshold before processing
    const marketCapUSD = this.priceManager.solToUSD(token.marketCapSol);
    if (marketCapUSD >= config.MCAP.MAX_ENTRY) {
      console.info(
        `Ignoring new token ${token.symbol || token.mint.slice(0, 8)} - Market cap too high: $${marketCapUSD.toFixed(2)} (${token.marketCapSol.toFixed(2)} SOL)`
      );
      return null;
    }

    this.tokens.set(token.mint, token);

    token.on("stateChanged", ({ token, from, to }) => {
      this.emit("tokenStateChanged", { token, from, to });
      
      // Unsubscribe from WebSocket updates when token enters dead state
      if (to === "dead") {
        console.log(`Token ${token.symbol || token.mint.slice(0, 8)} marked as dead, unsubscribing from updates`);
        this.webSocketManager.unsubscribeFromToken(token.mint);
      }
    });

    token.on("readyForPosition", async (token) => {
      // Check if we already have a position for this token
      if (this.positionManager.getPosition(token.mint)) {
        console.log(`Position already exists for ${token.symbol || token.mint.slice(0, 8)}, skipping`);
        return;
      }

      const availableBalance = await this.positionManager.getAvailableBalance();
      const positionSize = this.calculatePositionSize(token, availableBalance);
      const success = await this.positionManager.openPosition(
        token.mint,
        token.marketCapSol,
        positionSize
      );
      if (success) {
        token.setState("inPosition");
        this.emit("positionOpened", token);
      }
    });

    token.on("unsafeRecovery", (data) => {
      this.emit("unsafeRecovery", data);
    });

    token.on("recoveryGainTooHigh", (data) => {
      this.emit("recoveryGainTooHigh", data);
      const { token, gainPercentage } = data;
      console.warn(
        `Token ${token.symbol} (${token.mint}) recovery gain too high: ${gainPercentage.toFixed(2)}%`
      );
    });

    // Let handleTokenUpdate manage all state transitions
    this.handleTokenUpdate(tokenData);
    this.emit("tokenAdded", token);
    return token;
  }

  async handleTokenUpdate(tradeData) {
    const token = this.tokens.get(tradeData.mint);
    if (!token) return;

    // Add trade amount for volume tracking if this is a trade
    if (tradeData.txType === "buy" || tradeData.txType === "sell") {
      tradeData.tradeAmount = tradeData.tokenAmount;
    }

    // Update token data first
    token.update(tradeData);

    // Update missed opportunity tracking
    this.safetyChecker.updateTrackedTokens(token);

    // Convert market cap to USD for threshold comparisons
    const marketCapUSD = this.priceManager.solToUSD(token.marketCapSol);

    // Get current position if exists
    const position = this.positionManager.getPosition(token.mint);
    if (position && token.state !== "inPosition") {
      token.setState("inPosition");
    }

    switch (token.state) {
      case "new":
        // Check for pump conditions
        if (token.isPumping()) {
          token.setState("pumping");
          this.emit("tokenPumping", token);
        }
        break;

      case "pumping":
        // Check for drawdown
        if (token.getDrawdownPercentage() >= config.RECOVERY.DRAWDOWN.MIN) {
          if (token.isSafe()) {
            // If token is safe, enter smaller position due to volatility
            token.setState("open");
            this.emit("tokenSafeForEntry", { token, positionSize: "small" });
          } else {
            // If unsafe, move to drawdown state
            token.setState("drawdown");
            this.emit("tokenInDrawdown", token);
          }
        }
        break;

      case "drawdown":
        // Check for recovery or new drawdown cycle
        const gainFromBottom = token.getGainPercentage();
        if (gainFromBottom >= config.RECOVERY.GAIN.MIN) {
          if (token.isSafe()) {
            if (gainFromBottom <= config.RECOVERY.GAIN.MAX_ENTRY) {
              // Safe and within entry threshold - open full position
              token.setState("open");
              this.emit("tokenSafeForEntry", { token, positionSize: "full" });
            } else {
              // Gained too much - back to drawdown
              token.setState("drawdown");
            }
          } else {
            // Unsafe but recovering - move to recovery state
            token.setState("recovery");
            this.emit("tokenRecovering", token);
          }
        } else if (token.getDrawdownPercentage() >= config.RECOVERY.DRAWDOWN.MAX) {
          // Too much drawdown - mark as dead
          token.setState("dead");
          this.emit("tokenDead", token);
        }
        break;

      case "recovery":
        // Monitor recovery progress
        const currentGain = token.getGainPercentage();
        if (token.isSafe()) {
          if (currentGain <= config.RECOVERY.GAIN.MAX_ENTRY) {
            // Safe and within entry threshold - open medium position
            token.setState("open");
            this.emit("tokenSafeForEntry", { token, positionSize: "medium" });
          }
        } else if (token.getDrawdownPercentage() >= config.RECOVERY.DRAWDOWN.MIN) {
          // New drawdown cycle - reset to drawdown state
          token.setState("drawdown");
          this.emit("tokenInDrawdown", token);
        }
        break;

      case "open":
        // Monitor position
        if (position && position.isStopLossHit()) {
          token.setState("closed");
          this.emit("tokenPositionClosed", token);
        }
        break;
    }

    // Update safety checker
    this.safetyChecker.updateTrackedTokens(token);

    // Check for token death in any state
    if (marketCapUSD <= config.THRESHOLDS.DEAD_USD) {
      // Only mark tokens as dead if they've reached FIRST_PUMP state
      if (token.highestMarketCap >= config.THRESHOLDS.FIRST_PUMP_USD) {
        if (position) {
          const closeResult = this.positionManager.closePosition(token.mint, token.marketCapSol);
          if (closeResult) {
            token.setState("dead");
            this.emit("positionClosed", { token, reason: "dead" });
            this.webSocketManager.unsubscribeFromToken(token.mint);
          }
        } else {
          token.setState("dead");
          this.webSocketManager.unsubscribeFromToken(token.mint);
        }
      }
    }

    // Check for recovery pattern after update
    if (token.state === 'drawdown' || token.state === 'recovery') {
      const metrics = token.recoveryMetrics;
      if (metrics && this.isStrongRecoverySetup(token)) {
        this.emit('recoveryOpportunity', {
          token,
          metrics,
          reason: 'patternDetected'
        });
      }
    }

    this.emit("tokenUpdated", token);
  }

  calculatePositionSize(token, availableBalance) {
    const marketStructure = token.analyzeMarketStructure();
    const riskLevel = this.calculateRiskLevel(token, marketStructure);
    
    // Base position size on confidence and risk
    let baseSize = availableBalance * (marketStructure.recommendation.confidence / 100);
    
    // Adjust for risk level
    baseSize *= (1 - riskLevel);
    
    // Apply position sizing rules
    const maxPositionSize = availableBalance * 0.1; // Never use more than 10% of balance
    const minPositionSize = availableBalance * 0.01; // Minimum 1% of balance
    
    // Scale based on market structure health
    const healthAdjustment = marketStructure.overallHealth / 100;
    baseSize *= healthAdjustment;
    
    // Ensure within limits
    return Math.min(Math.max(baseSize, minPositionSize), maxPositionSize);
  }

  calculateRiskLevel(token, marketStructure) {
    const riskFactors = {
      priceVolatility: token.getPriceVolatility() / 100,
      volumeConcentration: this.calculateVolumeConcentration(token),
      patternReliability: (100 - marketStructure.structureScore.patternQuality) / 100,
      marketDepth: this.calculateMarketDepth(token),
      recoveryStability: this.calculateRecoveryStability(token)
    };

    // Weight the risk factors
    const weightedRisk = (
      riskFactors.priceVolatility * 0.25 +
      riskFactors.volumeConcentration * 0.20 +
      riskFactors.patternReliability * 0.20 +
      riskFactors.marketDepth * 0.15 +
      riskFactors.recoveryStability * 0.20
    );

    return Math.min(Math.max(weightedRisk, 0), 1);
  }

  calculateVolumeConcentration(token) {
    const volumeProfile = token.getVolumeProfile();
    if (!volumeProfile) return 1; // Maximum risk if no volume data

    // Calculate Herfindahl-Hirschman Index for volume concentration
    const totalVolume = volumeProfile.profile.reduce((sum, level) => sum + level.totalVolume, 0);
    const hhi = volumeProfile.profile.reduce((sum, level) => {
      const marketShare = level.totalVolume / totalVolume;
      return sum + (marketShare * marketShare);
    }, 0);

    return Math.min(hhi * 10, 1); // Normalize to 0-1 range
  }

  calculateMarketDepth(token) {
    const volumeProfile = token.getVolumeProfile();
    if (!volumeProfile) return 1;

    // Calculate liquidity depth score
    const totalVolume = volumeProfile.volumeDistribution.buyVolume + 
                       volumeProfile.volumeDistribution.sellVolume;
    const avgVolumePerLevel = totalVolume / volumeProfile.profile.length;
    
    // Count levels with significant volume
    const significantLevels = volumeProfile.profile.filter(
      level => level.totalVolume > avgVolumePerLevel * 0.5
    ).length;

    return 1 - (significantLevels / volumeProfile.profile.length);
  }

  calculateRecoveryStability(token) {
    const strength = token.getRecoveryStrength();
    const recentPrices = token.priceHistory.slice(-10);
    
    if (recentPrices.length < 2) return 1;

    // Calculate price stability
    const priceChanges = [];
    for (let i = 1; i < recentPrices.length; i++) {
      const change = Math.abs(
        (recentPrices[i].price - recentPrices[i-1].price) / recentPrices[i-1].price
      );
      priceChanges.push(change);
    }

    const avgChange = priceChanges.reduce((a,b) => a + b, 0) / priceChanges.length;
    const stability = Math.min(avgChange * 5, 1); // Normalize to 0-1

    return (stability * 0.7) + ((100 - strength.total) / 100 * 0.3);
  }

  getDynamicStopLoss(token) {
    const marketStructure = token.analyzeMarketStructure();
    const volumeProfile = token.getVolumeProfile();
    
    if (!volumeProfile) return null;

    // Find strongest support level below current price
    const currentPrice = token.getTokenPrice();
    const supportLevels = volumeProfile.profile
      .filter(level => level.priceLevel < currentPrice)
      .sort((a, b) => {
        const aStrength = a.buyVolume / a.totalVolume;
        const bStrength = b.buyVolume / b.totalVolume;
        return bStrength - aStrength;
      });

    if (supportLevels.length === 0) return null;

    // Use the strongest support level as base
    const baseStopLevel = supportLevels[0].priceLevel;
    
    // Add buffer based on volatility
    const volatility = token.getPriceVolatility();
    const buffer = baseStopLevel * (volatility * 0.01); // 1% buffer per volatility point
    
    return Math.max(baseStopLevel - buffer, 0);
  }

  getDynamicTakeProfit(token) {
    const marketStructure = token.analyzeMarketStructure();
    const strength = token.getRecoveryStrength();
    
    // Base take profit on recovery strength
    let takeProfit = 1 + (strength.total / 100); // 100% recovery = 2x target
    
    // Adjust based on market structure
    if (marketStructure.pattern && marketStructure.pattern.confidence > 70) {
      takeProfit *= 1.2; // 20% higher target for strong patterns
    }
    
    // Cap maximum take profit
    return Math.min(takeProfit, 3); // Maximum 3x
  }

  getToken(mint) {
    return this.tokens.get(mint);
  }

  getTokensByState(state) {
    return Array.from(this.tokens.values()).filter(
      (token) => token.state === state
    );
  }

  monitorRecoveryOpportunities() {
    for (const [mint, token] of this.tokens) {
      // Skip tokens that aren't in drawdown or recovery state
      if (!['drawdown', 'recovery'].includes(token.state)) continue;
      
      const metrics = token.recoveryMetrics;
      if (!metrics) continue;
      
      // Check for strong recovery setups
      if (this.isStrongRecoverySetup(token)) {
        this.emit('recoveryOpportunity', {
          token,
          metrics,
          reason: 'strongSetup'
        });
      }
      
      // Monitor ongoing recoveries
      if (token.state === 'recovery') {
        this.monitorOngoingRecovery(token);
      }
    }
  }
  
  isStrongRecoverySetup(token) {
    const {
      drawdownDepth,
      recoveryStrength,
      accumulationScore,
      buyPressure,
      marketStructure
    } = token.recoveryMetrics;
    
    // Check for ideal recovery conditions
    return (
      drawdownDepth > config.RECOVERY_MIN_DRAWDOWN &&
      recoveryStrength > 0.2 &&
      accumulationScore > 0.7 &&
      buyPressure > 0.6 &&
      marketStructure === 'bullish'
    );
  }
  
  monitorOngoingRecovery(token) {
    const metrics = token.recoveryMetrics;
    
    // Check for recovery weakness
    if (
      metrics.recoveryPhase === 'distribution' ||
      (metrics.marketStructure === 'bearish' && metrics.buyPressure < 0.3)
    ) {
      this.emit('recoveryWarning', {
        token,
        metrics,
        reason: 'weakening'
      });
    }
    
    // Check for recovery strength
    if (
      metrics.recoveryPhase === 'expansion' &&
      metrics.recoveryStrength > 0.5 &&
      metrics.marketStructure === 'bullish'
    ) {
      this.emit('recoveryStrength', {
        token,
        metrics,
        reason: 'acceleration'
      });
    }
  }

  cleanup() {
    // Remove all event listeners from tokens
    for (const token of this.tokens.values()) {
      token.removeAllListeners();
    }
    
    // Clear tokens map
    this.tokens.clear();
    
    // Remove all event listeners from TokenManager itself
    this.removeAllListeners();
  }
}

module.exports = TokenManager;
