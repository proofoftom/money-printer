const config = require("./config");
const MissedOpportunityLogger = require("./MissedOpportunityLogger");

class SafetyChecker {
  constructor(config, priceManager, safetyConfig = {}) {
    this.config = config;
    this.missedOpportunityLogger = new MissedOpportunityLogger(priceManager);
    this.priceManager = priceManager;
    this.safetyConfig = safetyConfig;
    this.lastFailureReason = null;
    this.suspiciousTraders = new Set(); // Track traders with suspicious patterns
  }

  getFailureReason() {
    return this.lastFailureReason;
  }

  setFailureReason(reason, value = null) {
    this.lastFailureReason = { reason, value };
  }

  async runSecurityChecks(token) {
    const startTime = Date.now();
    let approved = true;
    let failedChecks = [];

    try {
      // Reset failure reason at start of checks
      this.lastFailureReason = null;

      // Basic safety checks that even pump tokens must pass
      if (!this.checkMinimumRequirements(token)) {
        approved = false;
        failedChecks.push({
          name: 'MINIMUM_REQUIREMENTS',
          reason: this.lastFailureReason?.reason || 'minimumRequirements',
          actual: this.lastFailureReason?.value,
          configPath: 'SAFETY.MIN_TOKEN_AGE_SECONDS'
        });
      } 
      // Check for suspicious trader patterns
      else if (!this.checkTraderPatterns(token)) {
        approved = false;
        failedChecks.push({
          name: 'SUSPICIOUS_TRADERS',
          reason: this.lastFailureReason?.reason || 'suspiciousTraders',
          actual: this.lastFailureReason?.value,
          configPath: 'SAFETY.MAX_SUSPICIOUS_TRADER_RATIO'
        });
      }
      // Check for rug pull signals
      else if (!this.checkRugSignals(token)) {
        approved = false;
        failedChecks.push({
          name: 'RUG_SIGNALS',
          reason: this.lastFailureReason?.reason || 'rugSignals',
          actual: this.lastFailureReason?.value,
          configPath: 'SAFETY.MAX_TOP_HOLDER_CONCENTRATION'
        });
      }
      // Pump-specific checks
      else if (!this.checkPumpDynamics(token)) {
        approved = false;
        failedChecks.push({
          name: 'PUMP_DYNAMICS',
          reason: this.lastFailureReason?.reason || 'pumpDynamics',
          actual: this.lastFailureReason?.value,
          configPath: 'SAFETY.MAX_PRICE_INCREASE'
        });
      }

      // Track the token for missed opportunity analysis if it failed any checks
      if (!approved && failedChecks.length > 0) {
        this.missedOpportunityLogger.trackToken(token, failedChecks);
        token.unsafeReason = failedChecks.map(check => check.reason).join(', ');
      }

      return approved;
    } catch (error) {
      console.error("Error in security checks:", error);
      const errorCheck = {
        name: 'ERROR',
        reason: 'Error running checks',
        actual: error.message,
        configPath: null
      };
      failedChecks.push(errorCheck);
      this.missedOpportunityLogger.trackToken(token, errorCheck);
      return false;
    }
  }

  checkMinimumRequirements(token) {
    // Check absolute minimum requirements
    const ageInSeconds = (Date.now() - token.minted) / 1000;
    if (ageInSeconds < config.SAFETY.MIN_TOKEN_AGE_SECONDS) {
      this.setFailureReason("Token too young", ageInSeconds);
      return false;
    }

    // Minimum liquidity check
    if (token.vSolInBondingCurve < config.SAFETY.MIN_LIQUIDITY_SOL) {
      this.setFailureReason("Insufficient liquidity", token.vSolInBondingCurve);
      return false;
    }

    return true;
  }

  checkTraderPatterns(token) {
    const traders = token.getTraders();
    const now = Date.now();
    
    // Look for suspicious patterns in trader behavior
    traders.forEach(trader => {
      const tradeHistory = trader.getTradeHistory(token.mint);
      
      // Pattern 1: Rapid buy-sell cycles
      const rapidCycles = this.checkRapidTradeCycles(tradeHistory);
      
      // Pattern 2: Coordinated trading with other suspicious traders
      const coordinatedTrading = this.checkCoordinatedTrading(trader, token);
      
      // Pattern 3: Unusual trade sizes
      const unusualSizes = this.checkUnusualTradeSizes(tradeHistory, token);
      
      if (rapidCycles || coordinatedTrading || unusualSizes) {
        this.suspiciousTraders.add(trader.publicKey);
      }
    });

    // Calculate ratio of suspicious traders
    const suspiciousCount = traders.filter(t => 
      this.suspiciousTraders.has(t.publicKey)
    ).length;
    const suspiciousRatio = suspiciousCount / traders.length;

    if (suspiciousRatio > this.safetyConfig.MAX_SUSPICIOUS_TRADER_RATIO || 0.2) {
      this.setFailureReason('highSuspiciousTraderRatio', suspiciousRatio);
      return false;
    }

    return true;
  }

  checkRapidTradeCycles(tradeHistory) {
    const CYCLE_WINDOW = 5 * 60 * 1000; // 5 minutes
    const MIN_CYCLES = 3;
    
    let cycles = 0;
    let lastType = null;
    let cycleStart = null;

    for (const trade of tradeHistory) {
      if (!cycleStart) {
        cycleStart = trade.timestamp;
        lastType = trade.txType;
        continue;
      }

      if (trade.txType !== lastType) {
        if (trade.timestamp - cycleStart <= CYCLE_WINDOW) {
          cycles++;
        }
        cycleStart = trade.timestamp;
      }
      
      lastType = trade.txType;
    }

    return cycles >= MIN_CYCLES;
  }

  checkCoordinatedTrading(trader, token) {
    const COORDINATION_WINDOW = 30 * 1000; // 30 seconds
    const traders = token.getTraders();
    const suspiciousTraders = traders.filter(t => 
      this.suspiciousTraders.has(t.publicKey)
    );

    // Look for trades that happen close to suspicious traders' trades
    const traderTrades = trader.getTradeHistory(token.mint);
    
    return suspiciousTraders.some(suspiciousTrader => {
      const suspiciousTrades = suspiciousTrader.getTradeHistory(token.mint);
      
      return traderTrades.some(trade1 => 
        suspiciousTrades.some(trade2 => 
          Math.abs(trade1.timestamp - trade2.timestamp) <= COORDINATION_WINDOW &&
          trade1.txType === trade2.txType
        )
      );
    });
  }

  checkUnusualTradeSizes(tradeHistory, token) {
    if (tradeHistory.length < 2) return false;

    // Calculate average trade size for the token
    const allTrades = token.getTraders()
      .flatMap(t => t.getTradeHistory(token.mint));
    
    const avgTradeSize = allTrades.reduce((sum, t) => sum + t.amount, 0) / allTrades.length;
    const stdDev = Math.sqrt(
      allTrades.reduce((sum, t) => sum + Math.pow(t.amount - avgTradeSize, 2), 0) / allTrades.length
    );

    // Look for trades more than 3 standard deviations from mean
    return tradeHistory.some(trade => 
      Math.abs(trade.amount - avgTradeSize) > stdDev * 3
    );
  }

  checkRugSignals(token) {
    // Enhanced rug detection using pump metrics
    const pumpMetrics = token.pumpMetrics;
    const priceStats = token.getPriceStats();
    
    // Check for suspicious dump after pump
    if (pumpMetrics.pumpCount > 0) {
      const timeSinceLastPump = Date.now() - pumpMetrics.lastPumpTime;
      if (timeSinceLastPump < 2 * 60 * 1000) { // Within 2 minutes of pump
        if (priceStats.priceChange < -30) { // 30% drop
          this.setFailureReason("Suspicious dump after pump", priceStats.priceChange);
          return false;
        }
      }
    }
    
    // Check for extreme holder concentration
    if (token.getTopHolderConcentration(3) > config.SAFETY.MAX_TOP_HOLDER_CONCENTRATION) {
      this.setFailureReason("Extreme holder concentration", token.getTopHolderConcentration(3));
      return false;
    }
    
    // Check creator behavior during pump
    const creatorWallet = Array.from(token.wallets.values()).find(w => w.isCreator);
    if (creatorWallet) {
      const recentCreatorTrades = creatorWallet.trades.filter(t => 
        Date.now() - t.timestamp < 5 * 60 * 1000
      );
      
      if (recentCreatorTrades.length > 0) {
        const totalSellVolume = recentCreatorTrades.reduce((sum, trade) => 
          sum + (trade.amount < 0 ? Math.abs(trade.volumeInSol) : 0), 0
        );
        
        if (totalSellVolume > token.vSolInBondingCurve * 0.1) { // Creator selling >10% of liquidity
          this.setFailureReason("Suspicious creator selling", totalSellVolume);
          return false;
        }
      }
    }
    
    return true;
  }

  checkPumpDynamics(token) {
    // Fast check for pump characteristics
    const pumpMetrics = token.pumpMetrics;
    const pumpConfig = config.SAFETY.PUMP_DETECTION;
    
    // Check price acceleration
    if (pumpMetrics.priceAcceleration > pumpConfig.MIN_PRICE_ACCELERATION) {
      // Strong positive acceleration indicates potential pump
      const volumeSpikes = pumpMetrics.volumeSpikes;
      if (volumeSpikes.length > 0) {
        // Analyze volume spikes pattern
        const recentSpike = volumeSpikes[volumeSpikes.length - 1];
        const volumeIncrease = recentSpike.volume / token.getRecentVolume(pumpConfig.PUMP_WINDOW_MS) * 100;
        
        if (volumeIncrease > pumpConfig.MIN_VOLUME_SPIKE) {
          // Check if price movement correlates with volume
          const priceChange = recentSpike.priceChange;
          if (priceChange > 0 && priceChange/volumeIncrease > pumpConfig.MIN_PRICE_VOLUME_CORRELATION) {
            // Price movement correlates well with volume
            return true;
          }
        }
      }
    }
    
    // Check gain rate
    if (pumpMetrics.highestGainRate > pumpConfig.MIN_GAIN_RATE) {
      const priceStats = token.getPriceStats();
      if (priceStats.volatility < config.SAFETY.MAX_PRICE_VOLATILITY) {
        return true;
      }
    }
    
    // Check market cap momentum
    const marketCapUSD = this.priceManager.solToUSD(token.marketCapSol);
    if (marketCapUSD > pumpConfig.LARGE_TOKEN_MC_USD) {
      const mcGainRate = pumpMetrics.marketCapGainRate || 0;
      if (mcGainRate > pumpConfig.MIN_MC_GAIN_RATE) {
        return true;
      }
    }
    
    // Check pump frequency
    if (pumpMetrics.pumpCount >= pumpConfig.MIN_PUMP_COUNT) {
      const timeSinceLastPump = Date.now() - pumpMetrics.lastPumpTime;
      if (timeSinceLastPump < pumpConfig.PUMP_WINDOW_MS) {
        return true;
      }
    }
    
    this.setFailureReason("No clear pump pattern detected");
    return false;
  }

  updateTrackedTokens(token) {
    // Update metrics for tracked tokens that failed safety checks
    if (token.marketCapSol) {  // Only update if we have valid market cap data
      this.missedOpportunityLogger.updateTokenMetrics(token);
    }
  }

  getSafetyMetrics() {
    return {};
  }
}

module.exports = SafetyChecker;
