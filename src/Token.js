const EventEmitter = require("events");
const config = require("./config");

class Token extends EventEmitter {
  constructor(tokenData) {
    super();
    this.mint = tokenData.mint;
    this.name = tokenData.name;
    this.symbol = tokenData.symbol;
    this.minted = Date.now();
    this.uri = tokenData.uri;
    this.traderPublicKey = tokenData.traderPublicKey;
    this.initialBuy = tokenData.initialBuy;
    this.vTokensInBondingCurve = tokenData.vTokensInBondingCurve;
    this.vSolInBondingCurve = tokenData.vSolInBondingCurve;
    this.marketCapSol = tokenData.marketCapSol;
    this.signature = tokenData.signature;
    this.bondingCurveKey = tokenData.bondingCurveKey;

    this.state = "new";
    this.highestMarketCap = this.marketCapSol;
    this.drawdownLow = null;
    this.holders = new Map();
    this.creatorInitialHoldings = 0;
    this.unsafeReason = null;

    // Volume and trade tracking
    this.volumeData = {
      trades: [],
      lastCleanup: Date.now(),
      cleanupInterval: 5 * 60 * 1000, // Cleanup every 5 minutes
    };

    // Price tracking
    this.currentPrice = this.calculateTokenPrice();

    // Initialize creator as holder if initial balance provided
    if (tokenData.newTokenBalance) {
      this.holders.set(tokenData.traderPublicKey, tokenData.newTokenBalance);
      this.creatorInitialHoldings = tokenData.newTokenBalance;
    } else if (tokenData.initialBuy) {
      this.holders.set(tokenData.traderPublicKey, tokenData.initialBuy);
      this.creatorInitialHoldings = tokenData.initialBuy;
    }
  }

  setState(newState) {
    const oldState = this.state;
    this.state = newState;
    if (newState === "drawdown") {
      this.drawdownLow = this.marketCapSol;
    }
    this.emit("stateChanged", { token: this, from: oldState, to: newState });
  }

  update(data) {
    if (data.marketCapSol) {
      if (data.marketCapSol > this.highestMarketCap) {
        this.highestMarketCap = data.marketCapSol;
      }
      if (this.state === "drawdown" && data.marketCapSol < this.drawdownLow) {
        this.drawdownLow = data.marketCapSol;
      }
      this.marketCapSol = data.marketCapSol;
    }

    if (data.vTokensInBondingCurve) {
      this.vTokensInBondingCurve = data.vTokensInBondingCurve;
    }

    if (data.vSolInBondingCurve) {
      this.vSolInBondingCurve = data.vSolInBondingCurve;
    }

    // Update current price after bonding curve values change
    this.currentPrice = this.calculateTokenPrice();

    // Update volume if trade data is provided
    if (data.tradeAmount && data.tokenAmount) {
      const volumeInSol = data.tokenAmount * this.currentPrice;
      this.updateVolume(volumeInSol);
    }

    if (data.traderPublicKey && typeof data.newTokenBalance !== "undefined") {
      if (data.newTokenBalance > 0) {
        this.holders.set(data.traderPublicKey, data.newTokenBalance);
      } else {
        this.holders.delete(data.traderPublicKey);
      }
    }
  }

  calculateTokenPrice() {
    if (
      !this.vTokensInBondingCurve ||
      !this.vSolInBondingCurve ||
      this.vTokensInBondingCurve === 0
    ) {
      return 0;
    }
    return this.vSolInBondingCurve / this.vTokensInBondingCurve;
  }

  updateVolume(tradeAmount) {
    const now = Date.now();

    // Add new trade
    this.volumeData.trades.push({
      amount: tradeAmount,
      timestamp: now,
    });

    // Cleanup old trades periodically
    if (now - this.volumeData.lastCleanup > this.volumeData.cleanupInterval) {
      const thirtyMinutesAgo = now - 30 * 60 * 1000;
      this.volumeData.trades = this.volumeData.trades.filter(
        (trade) => trade.timestamp > thirtyMinutesAgo
      );
      this.volumeData.lastCleanup = now;
    }
  }

  getVolume(interval = "1m") {
    const now = Date.now();
    let cutoffTime;

    switch (interval) {
      case "1m":
        cutoffTime = now - 60 * 1000;
        break;
      case "5m":
        cutoffTime = now - 5 * 60 * 1000;
        break;
      case "30m":
        cutoffTime = now - 30 * 60 * 1000;
        break;
      default:
        throw new Error('Invalid volume interval. Use "1m", "5m", or "30m"');
    }

    return this.volumeData.trades
      .filter((trade) => trade.timestamp > cutoffTime)
      .reduce((sum, trade) => sum + trade.amount, 0);
  }

  getTradeStats(interval = "5m") {
    const now = Date.now();
    const cutoffTime = now - parseInt(interval) * 60 * 1000;
    const periodTrades = this.volumeData.trades.filter(
      (trade) => trade.timestamp > cutoffTime
    );

    if (periodTrades.length === 0) {
      return {
        count: 0,
        volume: 0,
        averageSize: 0,
        largestTrade: 0,
        smallestTrade: 0,
      };
    }

    const volume = periodTrades.reduce((sum, trade) => sum + trade.amount, 0);
    const largestTrade = Math.max(...periodTrades.map((trade) => trade.amount));
    const smallestTrade = Math.min(
      ...periodTrades.map((trade) => trade.amount)
    );

    return {
      count: periodTrades.length,
      volume,
      averageSize: volume / periodTrades.length,
      largestTrade,
      smallestTrade,
    };
  }

  getRecoveryPercentage() {
    if (!this.drawdownLow || !this.marketCapSol) return 0;
    return ((this.marketCapSol - this.drawdownLow) / this.drawdownLow) * 100;
  }

  getDrawdownPercentage() {
    if (!this.highestMarketCap || !this.marketCapSol) return 0;
    return (
      ((this.highestMarketCap - this.marketCapSol) / this.highestMarketCap) *
      100
    );
  }

  getGainPercentage() {
    if (!this.drawdownLow || !this.marketCapSol) return 0;
    return ((this.marketCapSol - this.drawdownLow) / this.drawdownLow) * 100;
  }

  async evaluateRecovery(safetyChecker) {
    try {
      if (this.state !== "drawdown" && this.state !== "unsafeRecovery") {
        return;
      }

      // Check for new drawdown in either state
      if (this.marketCapSol < this.drawdownLow) {
        this.setState("drawdown");
        this.drawdownLow = this.marketCapSol;
        return;
      }

      const gainPercentage = this.getGainPercentage();
      const recoveryPercentage = this.getRecoveryPercentage();

      // If we're in drawdown and hit recovery threshold
      if (this.state === "drawdown" && recoveryPercentage >= config.THRESHOLDS.RECOVERY) {
        const isSecure = await safetyChecker.runSecurityChecks(this);
        if (isSecure) {
          this.emit("readyForPosition", this);
        } else {
          this.setState("unsafeRecovery");
          this.unsafeReason = safetyChecker.getFailureReason();
          this.emit("unsafeRecovery", { 
            token: this, 
            marketCap: this.marketCapSol, 
            reason: this.unsafeReason.reason,
            value: this.unsafeReason.value 
          });
        }
        return;
      }

      // If we're in unsafeRecovery
      if (this.state === "unsafeRecovery") {
        // Check if token has become safe
        const isSecure = await safetyChecker.runSecurityChecks(this);
        if (isSecure) {
          // Only enter position if gain is less than threshold
          if (gainPercentage <= config.THRESHOLDS.SAFE_RECOVERY_GAIN) {
            this.emit("readyForPosition", this);
          } else {
            // If gain is too high, stay in unsafeRecovery but notify
            this.emit("recoveryGainTooHigh", {
              token: this,
              gainPercentage,
              marketCap: this.marketCapSol
            });
          }
        } else {
          // Update unsafe reason if it changed
          this.unsafeReason = safetyChecker.getFailureReason();
        }
      }
    } catch (error) {
      console.error("Error evaluating recovery:", error);
      // If we encounter an error during recovery evaluation, stay in current state
    }
  }

  getHolderCount() {
    return this.holders.size;
  }

  getTotalTokensHeld() {
    // Sum only the tokens held by actual holders (excluding liquidity pool)
    return Array.from(this.holders.values()).reduce(
      (sum, balance) => sum + balance,
      0
    );
  }

  getTotalSupply() {
    // Total supply includes both held tokens and tokens in the liquidity pool
    return this.getTotalTokensHeld() + (this.vTokensInBondingCurve || 0);
  }

  getTopHolderConcentration(topN = 10) {
    const totalSupply = this.getTotalSupply();
    if (totalSupply === 0) return 0;

    // Get holder balances (excluding bonding curve)
    const holderBalances = Array.from(this.holders.values());

    // Sort balances in descending order and take top N
    const topBalances = holderBalances
      .sort((a, b) => b - a)
      .slice(0, Math.min(topN, holderBalances.length));

    // Calculate total balance of top holders
    const topHoldersBalance = topBalances.reduce((sum, balance) => sum + balance, 0);

    // Calculate concentration as percentage of total supply
    return (topHoldersBalance / totalSupply) * 100;
  }

  isHeatingUp(threshold) {
    return this.marketCapSol > threshold;
  }

  isFirstPump(threshold) {
    return this.marketCapSol > threshold;
  }

  isDead(threshold) {
    return this.marketCapSol < threshold;
  }

  getTokenPrice() {
    return this.currentPrice;
  }

  getCreatorHoldings() {
    return this.holders.get(this.traderPublicKey) || 0;
  }

  hasCreatorSoldAll() {
    return this.getCreatorHoldings() === 0;
  }

  getCreatorSellPercentage() {
    if (!this.creatorInitialHoldings) return 0;
    const currentCreatorHoldings = this.getCreatorHoldings();
    return (
      ((this.creatorInitialHoldings - currentCreatorHoldings) /
        this.creatorInitialHoldings) *
      100
    );
  }

  getTopHolders(count = 5) {
    return Array.from(this.holders.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, count)
      .map(([address, balance]) => ({ address, balance }));
  }
}

module.exports = Token;
