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

    const token = new Token(tokenData, this.priceManager, this.safetyChecker);

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
    token.on("readyForPosition", ({ token, sizeRatio }) => {
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

      // Open position with size ratio
      this.positionManager.openPosition(
        token.mint,
        token.marketCapSol,
        sizeRatio
      ).then(success => {
        if (success) {
          this.emit("positionOpened", token);
        }
      });
    });

    // Listen for significant spread events
    token.on("significantSpread", (data) => {
      this.emit("significantSpread", data);
    });

    this.tokens.set(tokenData.mint, token);
    this.emit("newToken", token);

    // Subscribe to token trades
    this.webSocketManager.subscribeToToken(tokenData.mint);
  }

  handleTradeUpdate(tradeData) {
    const token = this.tokens.get(tradeData.mint);
    if (!token) {
      return;
    }

    // Update token state with new trade data
    token.update(tradeData);

    // Emit update event
    this.emit("tokenUpdated", token);

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
      if (token.getDrawdownPercentage() >= config.THRESHOLDS.DRAWDOWN) {
        const stateChange = token.stateManager.setState(STATES.DRAWDOWN);
        this.emit("tokenStateChanged", { token, ...stateChange });
      } else if (token.getGainPercentage() >= config.THRESHOLDS.PUMPED) {
        const stateChange = token.stateManager.setState(STATES.PUMPED);
        this.emit("tokenStateChanged", { token, ...stateChange });
      }
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
