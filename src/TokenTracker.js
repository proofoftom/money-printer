const EventEmitter = require("events");
const Token = require("./Token");
const config = require("./config");
const { STATES } = require("./TokenStateManager");

class TokenTracker extends EventEmitter {
  constructor(safetyChecker, positionManager, priceManager, webSocketManager) {
    super();
    this.safetyChecker = safetyChecker;
    this.positionManager = positionManager;
    this.priceManager = priceManager;
    this.webSocketManager = webSocketManager;
    this.tokens = new Map();
  }

  handleNewToken(tokenData) {
    if (this.tokens.has(tokenData.mint)) {
      return;
    }

    const token = new Token(tokenData, this.priceManager);

    // Listen for state changes
    token.on("stateChanged", ({ token, from, to }) => {
      this.emit("tokenStateChanged", { token, from, to });

      // Handle dead state
      if (to === STATES.DEAD) {
        console.log(`Token ${token.symbol || token.mint.slice(0, 8)} marked as dead, cleaning up...`);
        // Unsubscribe from WebSocket updates
        this.webSocketManager.unsubscribeFromToken(token.mint);
        // Remove from tracking
        this.tokens.delete(token.mint);
      }
    });

    // Listen for position ready events
    token.on("readyForPosition", async (token) => {
      // Check if we already have a position for this token
      if (this.positionManager.getPosition(token.mint)) {
        console.log(`Position already exists for ${token.symbol || token.mint.slice(0, 8)}, skipping`);
        return;
      }

      // Check market cap before entering position
      const marketCapUSD = this.priceManager.solToUSD(token.marketCapSol);
      if (marketCapUSD > config.THRESHOLDS.MAX_ENTRY_CAP_USD) {
        console.log(
          `Skipping position for ${token.symbol || token.mint.slice(0, 8)} - Market cap too high: $${marketCapUSD.toFixed(
            2
          )} (${token.marketCapSol.toFixed(2)} SOL)`
        );
        return;
      }

      const success = await this.positionManager.openPosition(
        token.mint,
        token.marketCapSol
      );
      if (success) {
        this.emit("positionOpened", token);
      }
    });

    // Listen for unsafe recovery events
    token.on("unsafeRecovery", (data) => {
      this.emit("unsafeRecovery", data);
    });

    this.tokens.set(tokenData.mint, token);
    this.emit("newToken", token);
  }

  handleTradeUpdate(tradeData) {
    const token = this.tokens.get(tradeData.mint);
    if (!token) {
      return;
    }

    // Update token state with new trade data
    token.update(tradeData);

    // Update missed opportunity tracking
    this.safetyChecker.updateTrackedTokens(token);

    // Convert market cap to USD for threshold comparisons
    const marketCapUSD = this.priceManager.solToUSD(token.marketCapSol);

    // Get current position if exists
    const position = this.positionManager.getPosition(token.mint);

    // Handle position state synchronization
    if (position && token.state !== STATES.OPEN) {
      const stateChange = token.stateManager.setState(STATES.OPEN);
      this.emit("tokenStateChanged", { token, ...stateChange });
    } else if (!position && token.state === STATES.OPEN) {
      // Position was closed, transition to appropriate state based on current conditions
      if (token.stateManager.priceHistory.bottom) {
        const stateChange = token.stateManager.setState(STATES.RECOVERY);
        this.emit("tokenStateChanged", { token, ...stateChange });
      } else {
        const stateChange = token.stateManager.setState(STATES.DRAWDOWN);
        this.emit("tokenStateChanged", { token, ...stateChange });
      }
    }

    // Evaluate recovery conditions if in recovery state
    if (token.state === STATES.RECOVERY) {
      token.evaluateRecovery(this.safetyChecker);
    }
  }

  getToken(mint) {
    return this.tokens.get(mint);
  }

  getAllTokens() {
    return Array.from(this.tokens.values());
  }

  getTokensByState(state) {
    return this.getAllTokens().filter(token => token.state === state);
  }

  getActiveTokens() {
    return this.getAllTokens().filter(token => 
      token.state !== STATES.DEAD && token.state !== STATES.CLOSED
    );
  }
}

module.exports = TokenTracker;
