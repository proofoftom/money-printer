const EventEmitter = require("events");
const Token = require("./Token");
const config = require("./config");

class TokenTracker extends EventEmitter {
  constructor(safetyChecker, positionManager) {
    super();
    this.safetyChecker = safetyChecker;
    this.positionManager = positionManager;
    this.tokens = new Map();
  }

  handleNewToken(tokenData) {
    const token = new Token(tokenData);
    this.tokens.set(token.mint, token);

    token.on("stateChanged", ({ token, from, to }) => {
      this.emit("tokenStateChanged", { token, from, to });
    });

    if (token.marketCapSol >= config.THRESHOLDS.HEATING_UP) {
      token.setState("heatingUp");
      this.emit("tokenHeatingUp", token);
    }

    this.emit("tokenAdded", token);
    return token;
  }

  async handleTokenUpdate(tradeData) {
    const token = this.tokens.get(tradeData.mint);
    if (!token) return;

    const previousMarketCap = token.marketCapSol;
    token.update(tradeData);

    switch (token.state) {
      case "heatingUp":
        if (token.marketCapSol >= config.THRESHOLDS.FIRST_PUMP) {
          token.setState("firstPump");
        }
        break;

      case "firstPump":
        if (!token.highestMarketCap) token.highestMarketCap = token.marketCapSol;
        if (token.marketCapSol > token.highestMarketCap) {
          token.highestMarketCap = token.marketCapSol;
        }
        const drawdownPercentage = ((token.highestMarketCap - token.marketCapSol) / token.highestMarketCap) * 100;
        if (drawdownPercentage >= config.THRESHOLDS.PUMP_DRAWDOWN) {
          token.setState("drawdown");
          token.drawdownLow = token.marketCapSol;
        }
        break;

      case "drawdown":
        if (token.marketCapSol > token.drawdownLow) {
          const recoveryPercentage = ((token.marketCapSol - token.drawdownLow) / token.drawdownLow) * 100;
          if (recoveryPercentage >= config.THRESHOLDS.RECOVERY) {
            const isSecure = await this.safetyChecker.runSecurityChecks(token);
            if (isSecure) {
              const success = this.positionManager.openPosition(token.mint, token.marketCapSol);
              if (success) {
                token.setState("inPosition");
                this.emit("positionOpened", token);
              }
            }
          }
        }
        break;

      case "inPosition":
        const position = this.positionManager.getPosition(token.mint);
        if (position) {
          this.positionManager.updateHighestPrice(token.mint, token.marketCapSol);
          
          // Check take profit tiers
          if (config.TAKE_PROFIT.ENABLED) {
            const profitPercentage = ((token.marketCapSol - position.entryPrice) / position.entryPrice) * 100;
            for (const tier of config.TAKE_PROFIT.TIERS) {
              if (profitPercentage >= tier.percentage) {
                this.positionManager.closePosition(token.mint, tier.portion);
                this.emit("takeProfitExecuted", { token, percentage: tier.percentage, portion: tier.portion });
              }
            }
          }

          // Check stop loss
          const drawdown = ((position.highestPrice - token.marketCapSol) / position.highestPrice) * 100;
          if (drawdown >= config.THRESHOLDS.TRAIL_DRAWDOWN) {
            this.positionManager.closePosition(token.mint);
            token.setState("closed");
            this.emit("positionClosed", { token, reason: "stopLoss" });
          }
        }
        break;
    }

    // Check for token death in any state
    if (token.marketCapSol <= config.THRESHOLDS.DEAD) {
      token.setState("dead");
      if (this.positionManager.getPosition(token.mint)) {
        this.positionManager.closePosition(token.mint);
        this.emit("positionClosed", { token, reason: "dead" });
      }
    }

    this.emit("tokenUpdated", token);
  }

  getToken(mint) {
    return this.tokens.get(mint);
  }

  getTokensByState(state) {
    return Array.from(this.tokens.values()).filter(token => token.state === state);
  }
}

module.exports = TokenTracker;
