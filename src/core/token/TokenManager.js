const EventEmitter = require("events");
const Token = require("./Token");
const config = require("../../utils/config");
const TokenStateManager = require("./TokenStateManager");

class TokenManager extends EventEmitter {
  constructor(safetyChecker, positionManager, priceManager, webSocketManager, traderManager, stateManager) {
    super();
    this.safetyChecker = safetyChecker;
    this.positionManager = positionManager;
    this.priceManager = priceManager;
    this.webSocketManager = webSocketManager;
    this.traderManager = traderManager;
    this.tokens = new Map();
    this.stateManager = stateManager;

    // Set high max listeners as we manage many tokens
    this.setMaxListeners(100);

    // Set up event handlers
    this.setupEventHandlers();

    // Recovery monitoring
    if (process.env.NODE_ENV !== 'test') {
      this._recoveryInterval = setInterval(
        () => this.monitorRecoveryOpportunities(),
        config.RECOVERY_MONITOR_INTERVAL || 30000
      );

      // Set up periodic cleanup
      this._cleanupInterval = setInterval(
        () => this.cleanupInactiveTokens(),
        300000 // Every 5 minutes
      );
    }
  }

  setupEventHandlers() {
    // Set up state change handlers
    this.stateManager.on('stateChanged', this.handleStateChange.bind(this));
    this.stateManager.on('tokenUnsafe', this.handleUnsafeToken.bind(this));
    this.stateManager.on('tokenDead', this.handleDeadToken.bind(this));
    this.stateManager.on('metricsUpdated', this.handleMetricsUpdate.bind(this));

    // Set up price update handler
    if (this.priceManager) {
      this.priceManager.on('priceUpdate', this.handlePriceUpdate.bind(this));
    }
  }

  handleNewToken(tokenData) {
    const mint = tokenData.mint;
    
    // Skip if token already exists
    if (this.tokens.has(mint)) {
      return;
    }

    try {
      // Create new token instance
      const token = new Token(tokenData);
      
      // Add to tokens map
      this.tokens.set(mint, token);
      
      // Initialize token state
      this.stateManager.setState(token, 'new', 'Token created');
      
      return token;
    } catch (error) {
      console.error('Error handling new token:', error);
      return null;
    }
  }

  handleStateChange({ token, from, to, reason }) {
    const mint = token.mint;
    
    switch (to) {
      case 'pumping':
        if (this.positionManager) {
          this.positionManager.evaluateEntry(token);
        }
        break;
        
      case 'drawdown':
        if (this.positionManager) {
          this.positionManager.evaluateExit(token, 'drawdown');
        }
        break;
        
      case 'unsafe':
      case 'dead':
        if (this.positionManager) {
          this.positionManager.forceExit(token, to);
        }
        break;
    }
  }

  handleUnsafeToken({ token, reason }) {
    // Clean up resources for unsafe token
    this.cleanupToken(token.mint);
  }

  handleDeadToken({ token, reason }) {
    // Clean up resources for dead token
    this.cleanupToken(token.mint);
  }

  handleMetricsUpdate({ token, metrics }) {
    // Update internal metrics
    if (metrics.marketCapSol > token.highestMarketCap) {
      token.highestMarketCap = metrics.marketCapSol;
    }
  }

  handlePriceUpdate({ newPrice, oldPrice, percentChange }) {
    // Update token valuations based on new SOL price
    for (const token of this.tokens.values()) {
      // Update token's USD valuation
      const oldMarketCapUSD = token.marketCapUSD;
      token.marketCapUSD = this.priceManager.solToUSD(token.marketCapSol);
      
      // Check if valuation change triggers any state changes
      if (Math.abs(percentChange) > config.TOKEN.PRICE_IMPACT_THRESHOLD) {
        this.stateManager.updateTokenMetrics(token, {
          priceChangePercent: percentChange,
          marketCapUSD: token.marketCapUSD,
          marketCapChange: (token.marketCapUSD - oldMarketCapUSD) / oldMarketCapUSD
        });
      }
    }
  }

  removeToken(mint) {
    const token = this.tokens.get(mint);
    if (!token) return;

    try {
      // Clean up token resources
      token.cleanup();

      // Remove from tokens map
      this.tokens.delete(mint);

      this.emit('tokenRemoved', token);
      console.log(`Token ${token.symbol} (${mint}) removed and cleaned up`);
    } catch (error) {
      console.error(`Error removing token ${mint}:`, error);
    }
  }

  async handleTokenUpdate(tradeData) {
    try {
      const token = this.tokens.get(tradeData.mint);
      if (!token) {
        console.warn(`No token found for mint: ${tradeData.mint}`);
        return;
      }

      // Update token state with trade data
      token.vTokensInBondingCurve = tradeData.vTokensInBondingCurve;
      token.vSolInBondingCurve = tradeData.vSolInBondingCurve;
      token.marketCapSol = tradeData.marketCap;

      // Record the trade in token history
      const trade = {
        type: tradeData.type,
        tokenAmount: tradeData.tokenAmount,
        newTokenBalance: tradeData.newTokenBalance,
        traderPublicKey: tradeData.traderPublicKey,
        timestamp: tradeData.timestamp,
        price: tradeData.price,
        marketCap: tradeData.marketCap
      };

      // Record trade and get updated metrics
      const success = await token.recordTrade(trade);
      if (!success) {
        console.error(`Failed to record trade for token ${token.symbol}`);
        return;
      }

      // Update token state
      this.stateManager.updateState(token, tradeData);

    } catch (error) {
      console.error('Error handling token update:', error);
      console.error('TokenManager.handleTokenUpdate', { tradeData });
    }
  }

  handleTrade(tradeData) {
    try {
      const { mint, traderPublicKey, type, amount, price, timestamp } = tradeData;
      const token = this.tokens.get(mint);
      
      if (!token) return;

      // Update token state
      token.updateTrade({ type, amount, price, timestamp });

      // Forward to trader manager without expecting events back
      if (this.traderManager) {
        this.traderManager.handleTrade(tradeData);
      }
    } catch (error) {
      console.error('Error handling trade:', error);
      // Don't rethrow to ensure graceful error handling
    }
  }

  calculatePositionSize(token, availableBalance) {
    const marketStructure = token.analyzeMarketStructure();
    const riskLevel = this.calculateRiskLevel(token, marketStructure);

    // Base position size on confidence and risk
    let baseSize =
      availableBalance * (marketStructure.recommendation.confidence / 100);

    // Adjust for risk level
    baseSize *= 1 - riskLevel;

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
      patternReliability:
        (100 - marketStructure.structureScore.patternQuality) / 100,
      marketDepth: this.calculateMarketDepth(token),
      recoveryStability: this.calculateRecoveryStability(token),
    };

    // Weight the risk factors
    const weightedRisk =
      riskFactors.priceVolatility * 0.25 +
      riskFactors.volumeConcentration * 0.2 +
      riskFactors.patternReliability * 0.2 +
      riskFactors.marketDepth * 0.15 +
      riskFactors.recoveryStability * 0.2;

    return Math.min(Math.max(weightedRisk, 0), 1);
  }

  calculateVolumeConcentration(token) {
    const volumeProfile = token.getVolumeProfile();
    if (!volumeProfile) return 1; // Maximum risk if no volume data

    // Calculate Herfindahl-Hirschman Index for volume concentration
    const totalVolume = volumeProfile.profile.reduce(
      (sum, level) => sum + level.totalVolume,
      0
    );
    const hhi = volumeProfile.profile.reduce((sum, level) => {
      const marketShare = level.totalVolume / totalVolume;
      return sum + marketShare * marketShare;
    }, 0);

    return Math.min(hhi * 10, 1); // Normalize to 0-1 range
  }

  calculateMarketDepth(token) {
    const volumeProfile = token.getVolumeProfile();
    if (!volumeProfile) return 1;

    // Calculate liquidity depth score
    const totalVolume =
      volumeProfile.volumeDistribution.buyVolume +
      volumeProfile.volumeDistribution.sellVolume;
    const avgVolumePerLevel = totalVolume / volumeProfile.profile.length;

    // Count levels with significant volume
    const significantLevels = volumeProfile.profile.filter(
      (level) => level.totalVolume > avgVolumePerLevel * 0.5
    ).length;

    return 1 - significantLevels / volumeProfile.profile.length;
  }

  calculateRecoveryStability(token) {
    const strength = token.getRecoveryStrength();
    const recentPrices = token.priceHistory.slice(-10);

    if (recentPrices.length < 2) return 1;

    // Calculate price stability
    const priceChanges = [];
    for (let i = 1; i < recentPrices.length; i++) {
      const change = Math.abs(
        (recentPrices[i].price - recentPrices[i - 1].price) /
          recentPrices[i - 1].price
      );
      priceChanges.push(change);
    }

    const avgChange =
      priceChanges.reduce((a, b) => a + b, 0) / priceChanges.length;
    const stability = Math.min(avgChange * 5, 1); // Normalize to 0-1

    return stability * 0.7 + ((100 - strength.total) / 100) * 0.3;
  }

  getDynamicStopLoss(token) {
    const marketStructure = token.analyzeMarketStructure();
    const volumeProfile = token.getVolumeProfile();

    if (!volumeProfile) return null;

    // Find strongest support level below current price
    const currentPrice = token.getTokenPrice();
    const supportLevels = volumeProfile.profile
      .filter((level) => level.priceLevel < currentPrice)
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
    let takeProfit = 1 + strength.total / 100; // 100% recovery = 2x target

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
      if (!["drawdown", "recovery"].includes(token.state)) continue;

      const metrics = token.recoveryMetrics;
      if (!metrics) continue;

      // Check for strong recovery setups
      if (this.isStrongRecoverySetup(token)) {
        this.emit("recoveryOpportunity", {
          token,
          metrics,
          reason: "strongSetup",
        });
      }

      // Monitor ongoing recoveries
      if (token.state === "recovery") {
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
      marketStructure,
    } = token.recoveryMetrics;

    // Check for ideal recovery conditions
    return (
      drawdownDepth > config.RECOVERY_MIN_DRAWDOWN &&
      recoveryStrength > 0.2 &&
      accumulationScore > 0.7 &&
      buyPressure > 0.6 &&
      marketStructure === "bullish"
    );
  }

  monitorOngoingRecovery(token) {
    const metrics = token.recoveryMetrics;

    // Check for recovery weakness
    if (
      metrics.recoveryPhase === "distribution" ||
      (metrics.marketStructure === "bearish" && metrics.buyPressure < 0.3)
    ) {
      this.emit("recoveryWarning", {
        token,
        metrics,
        reason: "weakening",
      });
    }

    // Check for recovery strength
    if (
      metrics.recoveryPhase === "expansion" &&
      metrics.recoveryStrength > 0.5 &&
      metrics.marketStructure === "bullish"
    ) {
      this.emit("recoveryStrength", {
        token,
        metrics,
        reason: "acceleration",
      });
    }
  }

  cleanupInactiveTokens() {
    const now = Date.now();
    const inactivityThreshold = 30 * 60 * 1000; // 30 minutes

    for (const [mint, token] of this.tokens.entries()) {
      if (token.lastTradeTime && (now - token.lastTradeTime > inactivityThreshold)) {
        console.log(`Removing inactive token ${token.symbol}`);
        this.removeToken(mint);
      }
    }
  }

  cleanupToken(mint) {
    const token = this.tokens.get(mint);
    if (token) {
      token.removeAllListeners();
      this.tokens.delete(mint);
    }
  }

  cleanup() {
    // Clear intervals if they exist
    if (this._recoveryInterval) {
      clearInterval(this._recoveryInterval);
      this._recoveryInterval = null;
    }

    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }

    // Clean up all tokens
    for (const token of this.tokens.values()) {
      token.cleanup();
    }

    // Clear the tokens map
    this.tokens.clear();

    // Clean up the state manager
    if (this.stateManager && typeof this.stateManager.cleanup === 'function') {
      this.stateManager.cleanup();
    }

    // Remove all event listeners
    this.removeAllListeners();
  }
}

module.exports = TokenManager;
