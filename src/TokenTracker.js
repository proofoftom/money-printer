const EventEmitter = require("events");
const { Token, STATES } = require("./Token");
const config = require("./config");

class TokenTracker extends EventEmitter {
  constructor({
    safetyChecker,
    positionManager,
    priceManager,
    webSocketManager,
    logger,
  }) {
    super();
    this.safetyChecker = safetyChecker;
    this.positionManager = positionManager;
    this.priceManager = priceManager;
    this.webSocketManager = webSocketManager;
    this.logger = logger;
    this.tokens = new Map();
    this.config = webSocketManager.config; // Get config from WebSocketManager

    // Set up WebSocket event listeners
    this.webSocketManager.on("newToken", (tokenData) => {
      this.handleNewToken(tokenData);
    });

    this.webSocketManager.on("tokenTrade", (tradeData) => {
      if (this.tokens.has(tradeData.mint)) {
        const token = this.tokens.get(tradeData.mint);

        // Log trade data if enabled
        if (this.config.LOGGING.TRADES) {
          console.debug(`Trade received for ${token.symbol}:`, {
            type: tradeData.txType,
            amount: tradeData.tokenAmount,
            marketCap: tradeData.marketCapSol,
          });
        }

        // Update token with trade data
        token.update(tradeData);

        // Forward trade event to listeners
        this.emit("tokenTrade", {
          token,
          type: tradeData.txType,
          amount: tradeData.tokenAmount,
          marketCapSol: tradeData.marketCapSol,
        });

        // Also emit general update
        this.emit("tokenUpdated", token);
      }
    });

    // Set up error handler to prevent unhandled errors
    this.on("error", () => {});
  }

  async handleNewToken(tokenData) {
    if (this.tokens.has(tokenData.mint)) {
      // Update existing token
      const token = this.tokens.get(tokenData.mint);
      token.update(tokenData);
      this.emit("tokenUpdated", token);
      return;
    }

    const token = new Token(tokenData, {
      priceManager: this.priceManager,
      safetyChecker: this.safetyChecker,
      logger: this.logger,
      config: this.config
    });

    // Listen for state changes
    token.on("stateChanged", ({ token, from, to }) => {
      if (this.config.LOGGING.POSITIONS) {
        console.debug(`Token ${token.symbol} state changed from ${from} to ${to}`);
      }
      this.emit("tokenStateChanged", { token, from, to });
      this.emit("tokenUpdated", token);

      // Unsubscribe and remove dead tokens
      if (to === STATES.DEAD) {
        if (this.config.LOGGING.POSITIONS) {
          console.debug(`Token ${token.symbol} is dead, removing from tracking`);
        }
        this.removeToken(token.mint);
      }
    });

    // Listen for ready for position events
    token.on("readyForPosition", (token) => {
      if (this.config.LOGGING.POSITIONS) {
        console.debug(`Token ${token.symbol} is ready for position`);
      }

      // Attempt to open position
      try {
        const position = this.positionManager.openPosition(token);
        if (position && this.config.LOGGING.POSITIONS) {
          console.debug(`Opened position for ${token.symbol}:`, {
            size: position.size,
            entryPrice: position.entryPrice,
          });
        }
      } catch (error) {
        console.error(`Failed to open position for ${token.symbol}:`, error);
      }
    });

    // Add token to tracking
    this.tokens.set(token.mint, token);
    this.emit("tokenAdded", token);

    // Subscribe to token trades
    this.webSocketManager.subscribeToToken([token.mint]);

    // Check initial state
    token.checkState();

    // Check if token is safe
    const safetyCheck = await this.safetyChecker.isTokenSafe(token);
    if (!safetyCheck.safe && this.config.LOGGING.SAFETY_CHECKS) {
      this.emit("tokenSafetyCheckFailed", token, safetyCheck.reasons);
    }
  }

  removeToken(mint) {
    const token = this.tokens.get(mint);
    if (token) {
      // Clean up token resources
      token.cleanup();

      // Unsubscribe from trades
      this.webSocketManager.unsubscribeTokenTrade([mint]);

      // Remove from tracking
      this.tokens.delete(mint);
      this.emit("tokenRemoved", token);
    }
  }

  getToken(mint) {
    return this.tokens.get(mint);
  }

  getTokenStats() {
    const stats = {
      totalTokens: this.tokens.size,
      activeTokens: 0,
      deadTokens: 0,
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
