const EventEmitter = require("events");
const { Token, STATES } = require("./Token");
const config = require("./config");

class TokenTracker extends EventEmitter {
  constructor({ safetyChecker, positionManager, priceManager, webSocketManager }) {
    super();
    this.safetyChecker = safetyChecker;
    this.positionManager = positionManager;
    this.priceManager = priceManager;
    this.webSocketManager = webSocketManager;
    this.tokens = new Map();

    // Set up WebSocket event listeners
    this.webSocketManager.on("newToken", (tokenData) => {
      this.handleNewToken(tokenData);
    });

    this.webSocketManager.on("tokenTrade", (tradeData) => {
      if (this.tokens.has(tradeData.mint)) {
        const token = this.tokens.get(tradeData.mint);
        token.update(tradeData);
        this.emit("tokenUpdated", token);
      }
    });

    // Set up error handler to prevent unhandled errors
    this.on('error', () => {});
  }

  handleNewToken(tokenData) {
    if (this.tokens.has(tokenData.mint)) {
      // Update existing token
      const token = this.tokens.get(tokenData.mint);
      token.update(tokenData);
      this.emit("tokenUpdated", token);
      return;
    }

    const token = new Token(tokenData, {
      priceManager: this.priceManager,
      safetyChecker: this.safetyChecker
    });

    // Listen for state changes
    token.on("stateChanged", ({ token, from, to }) => {
      this.emit("tokenStateChanged", { token, from, to });
      this.emit("tokenUpdated", token);

      // Unsubscribe and remove dead tokens
      if (to === STATES.DEAD) {
        this.removeToken(token.mint);
      }
    });

    token.on("readyForPosition", ({ token }) => {
      if (!this.positionManager.isTradingEnabled()) {
        return;
      }

      const success = this.positionManager.openPosition(token);
      if (!success) {
        this.emit("error", { message: `Failed to open position for token ${token.symbol}` });
      }
    });

    // Add token to tracking
    this.tokens.set(token.mint, token);
    this.emit("tokenAdded", token);

    // Check initial state
    token.checkState();
  }

  removeToken(mint) {
    const token = this.tokens.get(mint);
    if (!token) return;

    this.tokens.delete(mint);
    this.webSocketManager.unsubscribeFromToken(mint);
    this.emit("tokenRemoved", token);
  }

  getToken(mint) {
    return this.tokens.get(mint);
  }

  getTokenStats() {
    const stats = {
      totalTokens: this.tokens.size,
      activeTokens: 0,
      deadTokens: 0
    };

    for (const token of this.tokens.values()) {
      const state = token.getCurrentState();
      if (state === STATES.DEAD) {
        stats.deadTokens++;
      } else {
        stats.activeTokens++;
      }
    }

    return stats;
  }
}

module.exports = TokenTracker;
