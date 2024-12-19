const config = require("./config");
const MissedOpportunityLogger = require("./MissedOpportunityLogger");

class SafetyChecker {
  constructor(priceManager, safetyConfig = {}) {
    this.missedOpportunityLogger = new MissedOpportunityLogger(priceManager);
    this.priceManager = priceManager;
    this.safetyConfig = safetyConfig;
    this.lastFailureReason = null;
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
          configPath: 'THRESHOLDS.PUMP'
        });
      }

      // Track the token for missed opportunity analysis if it failed any checks
      if (!approved && failedChecks.length > 0) {
        this.missedOpportunityLogger.trackToken(token, failedChecks);
        token.unsafeReason = failedChecks
          .map((check) => check.reason)
          .join(", ");
      }

      return approved;
    } catch (error) {
      console.error("Error in security checks:", error);
      const errorCheck = {
        name: "ERROR",
        reason: "Error running checks",
        actual: error.message,
        configPath: null,
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

  checkRugSignals(token) {
    const now = Date.now();
    const isNewToken = now - token.minted < 5 * 60 * 1000;

    if (isNewToken) {
      // For new tokens, we're more strict about creator behavior
      if (token.metrics.earlyTrading?.creatorSells > 0) {
        const creatorSellRatio = token.getCreatorSellPercentage();
        if (creatorSellRatio > config.SAFETY.MAX_CREATOR_SELL_PERCENTAGE_EARLY) {
          this.setFailureReason('creator_selling_too_much', creatorSellRatio);
          return false;
        }
      }

      // Check for wash trading patterns
      const alternatingPatterns = token.metrics.earlyTrading?.suspiciousActivity
        ?.filter(a => a.pattern === 'alternating').length || 0;
      
      if (alternatingPatterns > config.SAFETY.MAX_ALTERNATING_PATTERNS) {
        this.setFailureReason('wash_trading_detected', alternatingPatterns);
        return false;
      }
    }

    // Enhanced rug detection using pump metrics
    const pumpMetrics = token.pumpMetrics;
    const priceStats = token.getPriceStats();

    // Check for suspicious dump after pump
    if (pumpMetrics.pumpCount > 0) {
      const timeSinceLastPump = Date.now() - pumpMetrics.lastPumpTime;
      if (timeSinceLastPump < 2 * 60 * 1000) {
        // Within 2 minutes of pump
        if (priceStats.priceChange < -30) {
          // 30% drop
          this.setFailureReason(
            "Suspicious dump after pump",
            priceStats.priceChange
          );
          return false;
        }
      }
    }

    // Check for extreme holder concentration
    if (
      token.getTopHolderConcentration(3) >
      config.SAFETY.MAX_TOP_HOLDER_CONCENTRATION
    ) {
      this.setFailureReason(
        "Extreme holder concentration",
        token.getTopHolderConcentration(3)
      );
      return false;
    }

    // Check creator behavior during pump
    const creatorWallet = Array.from(token.wallets.values()).find(
      (w) => w.isCreator
    );
    if (creatorWallet) {
      const recentCreatorTrades = creatorWallet.trades.filter(
        (t) => Date.now() - t.timestamp < 5 * 60 * 1000
      );

      if (recentCreatorTrades.length > 0) {
        const totalSellVolume = recentCreatorTrades.reduce(
          (sum, trade) =>
            sum + (trade.amount < 0 ? Math.abs(trade.volumeInSol) : 0),
          0
        );

        if (totalSellVolume > token.vSolInBondingCurve * 0.1) {
          // Creator selling >10% of liquidity
          this.setFailureReason("Suspicious creator selling", totalSellVolume);
          return false;
        }
      }
    }

    return true;
  }

  checkPumpDynamics(token) {
    const now = Date.now();
    const isNewToken = now - token.minted < 5 * 60 * 1000; // Less than 5 minutes old

    if (isNewToken && token.metrics.earlyTrading) {
      // Check buy/sell ratio - we want more buys than sells in early trading
      if (token.metrics.earlyTrading.buyToSellRatio < config.SAFETY.MIN_BUY_SELL_RATIO) {
        this.setFailureReason('low_buy_sell_ratio', token.metrics.earlyTrading.buyToSellRatio);
        return false;
      }

      // Check for suspicious trading patterns
      if (token.metrics.earlyTrading.suspiciousActivity?.length > 0) {
        const rapidTradingCount = token.metrics.earlyTrading.suspiciousActivity
          .filter(a => a.pattern === 'rapid').length;
        
        if (rapidTradingCount > config.SAFETY.MAX_RAPID_TRADERS) {
          this.setFailureReason('suspicious_trading_pattern', rapidTradingCount);
          return false;
        }
      }

      // Check if creator is dumping
      if (token.metrics.earlyTrading.creatorSells > config.SAFETY.MAX_CREATOR_SELLS_EARLY) {
        this.setFailureReason('creator_dumping', token.metrics.earlyTrading.creatorSells);
        return false;
      }

      // Check for healthy volume acceleration
      if (token.metrics.earlyTrading.volumeAcceleration < config.SAFETY.MIN_VOLUME_ACCELERATION) {
        this.setFailureReason('low_volume_acceleration', token.metrics.earlyTrading.volumeAcceleration);
        return false;
      }

      // Check for minimum unique buyers
      if (token.metrics.earlyTrading.uniqueBuyers < config.SAFETY.MIN_UNIQUE_BUYERS) {
        this.setFailureReason('insufficient_unique_buyers', token.metrics.earlyTrading.uniqueBuyers);
        return false;
      }
    }

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
        const volumeIncrease =
          (recentSpike.volume /
            token.getRecentVolume(pumpConfig.PUMP_WINDOW_MS)) *
          100;

        if (volumeIncrease > pumpConfig.MIN_VOLUME_SPIKE) {
          // Check if price movement correlates with volume
          const priceChange = recentSpike.priceChange;
          if (
            priceChange > 0 &&
            priceChange / volumeIncrease >
              pumpConfig.MIN_PRICE_VOLUME_CORRELATION
          ) {
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
    if (token.marketCapSol) {
      // Only update if we have valid market cap data
      this.missedOpportunityLogger.updateTokenMetrics(token);
    }
  }

  getSafetyMetrics() {
    return {};
  }
}

module.exports = SafetyChecker;
