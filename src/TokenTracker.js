const EventEmitter = require("events");
const Token = require("./Token");
const config = require("./config");

class TokenTracker extends EventEmitter {
  constructor(
    safetyChecker,
    positionManager,
    priceManager
  ) {
    super();
    this.safetyChecker = safetyChecker;
    this.positionManager = positionManager;
    this.priceManager = priceManager;
    this.tokens = new Map();
  }

  handleNewToken(tokenData) {
    const token = new Token(tokenData);

    // Check market cap threshold before processing
    const marketCapUSD = this.priceManager.solToUSD(token.marketCapSol);
    if (marketCapUSD >= config.THRESHOLDS.MAX_MARKET_CAP_USD) {
      console.info(
        `Ignoring new token ${token.symbol || token.mint.slice(0, 8)} - Market cap too high: $${marketCapUSD.toFixed(2)} (${token.marketCapSol.toFixed(2)} SOL)`
      );
      return null;
    }

    this.tokens.set(token.mint, token);

    token.on("stateChanged", ({ token, from, to }) => {
      this.emit("tokenStateChanged", { token, from, to });
    });

    token.on("readyForPosition", async (token) => {
      const success = await this.positionManager.openPosition(
        token.mint,
        token.marketCapSol
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

    token.update(tradeData);

    // Update missed opportunity tracking
    this.safetyChecker.updateTrackedTokens(token);

    // Convert market cap to USD for threshold comparisons
    const marketCapUSD = this.priceManager.solToUSD(token.marketCapSol);

    switch (token.state) {
      case "new":
        if (marketCapUSD >= config.THRESHOLDS.HEATING_UP_USD) {
          token.setState("heatingUp");
          this.emit("tokenHeatingUp", token);
        }
        break;

      case "heatingUp":
        if (marketCapUSD >= config.THRESHOLDS.FIRST_PUMP_USD) {
          token.setState("firstPump");
        }
        break;

      case "firstPump":
        if (!token.highestMarketCap) token.highestMarketCap = marketCapUSD;
        if (marketCapUSD > token.highestMarketCap) {
          token.highestMarketCap = marketCapUSD;
        }
        const drawdownPercentage =
          ((token.highestMarketCap - marketCapUSD) / token.highestMarketCap) *
          100;
        if (drawdownPercentage >= config.THRESHOLDS.PUMP_DRAWDOWN) {
          token.setState("drawdown");
          token.drawdownLow = marketCapUSD;
        }
        break;

      case "drawdown":
        await token.evaluateRecovery(this.safetyChecker);
        break;

      case "unsafeRecovery":
        await token.evaluateRecovery(this.safetyChecker);
        break;

      case "inPosition":
        const result = this.positionManager.updatePosition(
          token.mint,
          token.marketCapSol,
          { volume: token.volume24h }
        );
        if (result) {
          if (result.portion === 1.0) {
            token.setState("closed");
            this.emit("positionClosed", {
              token,
              reason: result.reason || "exit_strategy",
            });
          } else {
            this.emit("partialExit", {
              token,
              percentage: result.profitPercentage,
              portion: result.portion,
              reason: result.reason || "take_profit",
            });
          }
        }
        break;
    }

    // Check for token death in any state
    if (marketCapUSD <= config.THRESHOLDS.DEAD_USD) {
      // Only mark tokens as dead if they've reached FIRST_PUMP state
      if (token.highestMarketCap >= config.THRESHOLDS.FIRST_PUMP_USD) {
        token.setState("dead");
        if (this.positionManager.getPosition(token.mint)) {
          this.positionManager.closePosition(token.mint);
          this.emit("positionClosed", { token, reason: "dead" });
        }
      }
    }

    this.emit("tokenUpdated", token);
  }

  getToken(mint) {
    return this.tokens.get(mint);
  }

  getTokensByState(state) {
    return Array.from(this.tokens.values()).filter(
      (token) => token.state === state
    );
  }
}

module.exports = TokenTracker;
