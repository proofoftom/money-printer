const { EventEmitter } = require("events");
const { Token } = require("./Token");
const SafetyChecker = require("./SafetyChecker"); // Assuming SafetyChecker is in a separate file

class TokenTracker extends EventEmitter {
  constructor(config, logger, webSocketManager, positionManager) {
    super();
    if (!config) throw new Error("Config is required");
    if (!logger) throw new Error("Logger is required");
    if (!webSocketManager) throw new Error("WebSocketManager is required");
    if (!positionManager) throw new Error("PositionManager is required");
    if (!positionManager.wallet)
      throw new Error("PositionManager must have a wallet");
    if (!positionManager.priceManager)
      throw new Error("PositionManager must have a priceManager");

    this.config = config;
    this.logger = logger;
    this.webSocketManager = webSocketManager;
    this.positionManager = positionManager;
    this.tokens = new Map();
    this.safetyChecker = new SafetyChecker(
      positionManager.wallet,
      positionManager.priceManager,
      logger
    );

    // Set up WebSocket event listeners
    if (this.webSocketManager) {
      this.webSocketManager.on("newToken", (tokenData) => {
        this.handleNewToken(tokenData);
      });

      this.webSocketManager.on("tokenTrade", (tradeData) => {
        this.handleTokenTrade(tradeData);
      });
    }
  }

  async handleNewToken(tokenData) {
    try {
      this.logger.info("New token detected", {
        mint: tokenData.mint,
        symbol: tokenData.symbol,
      });

      // Create new Token instance
      const token = new Token(tokenData, {
        logger: this.logger,
        config: this.config,
        safetyChecker: this.safetyChecker,
        priceManager: this.positionManager.priceManager,
      });

      // Set up token event listeners
      token.on("readyForPosition", async () => {
        if (this.config.TRADING.ENABLED) {
          try {
            await this.positionManager.openPosition(token);
          } catch (error) {
            this.logger.error("Failed to open position", error);
          }
        } else {
          this.logger.info("Trading is disabled, skipping position opening");
        }
      });

      token.on("stateChanged", ({ oldState, newState }) => {
        this.logger.debug("Token state changed", {
          mint: token.mint,
          oldState,
          newState,
        });
      });

      // THIS IS THE EXACT STRUCTURE, DO NOT CHANGE UNLESS YOU KNOW WHAT YOU ARE DOING
      token.on("trade", (tradeData) => {
        this.logger.debug("Trade event received", {
          mint: tradeData.mint,
          txType: tradeData.txType,
          tokenAmount: tradeData.tokenAmount,
          vTokensInBondingCurve: tradeData.vTokensInBondingCurve,
          vSolInBondingCurve: tradeData.vSolInBondingCurve,
          marketCapSol: tradeData.marketCapSol,
        });
        // Forward the complete trade data
        this.emit("tokenTrade", tradeData);
      });

      // Store token
      this.tokens.set(tokenData.mint, token);

      // Subscribe to token trades
      this.webSocketManager.subscribeToToken(tokenData.mint);

      // Start safety checks
      token.startSafetyChecks();
    } catch (error) {
      this.logger.error("Error handling new token:", error);
    }
  }

  handleTokenTrade(tradeData) {
    const token = this.tokens.get(tradeData.mint);
    if (token) {
      token.update(tradeData);

      this.logger.debug("Token trade detected", {
        mint: tradeData.mint,
        txType: tradeData.txType,
      });

      this.logger.debug("Token updated", {
        mint: tradeData.mint,
        marketCapSol: tradeData.marketCapSol,
      });
    }
  }

  removeToken(mint) {
    const token = this.tokens.get(mint);
    if (token) {
      token.cleanup();
      this.tokens.delete(mint);
      this.webSocketManager.unsubscribeFromToken(mint);
    }
  }
}

module.exports = TokenTracker;
