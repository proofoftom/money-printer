const { EventEmitter } = require("events");
const { Token } = require("./Token");
const SafetyChecker = require("./SafetyChecker");

const MAX_CONCURRENT_TOKENS = 500;

class TokenTracker extends EventEmitter {
  constructor(config, logger, webSocketManager, positionManager, priceManager) {
    super();
    if (!config) throw new Error("Config is required");
    if (!logger) throw new Error("Logger is required");
    if (!webSocketManager) throw new Error("WebSocketManager is required");
    if (!positionManager) throw new Error("PositionManager is required");
    if (!positionManager.wallet)
      throw new Error("PositionManager must have a wallet");
    if (!positionManager.priceManager)
      throw new Error("PositionManager must have a priceManager");
    if (!priceManager) throw new Error("PriceManager is required"); // Add this check

    this.config = config;
    this.logger = logger;
    this.webSocketManager = webSocketManager;
    this.positionManager = positionManager;
    this.priceManager = priceManager; // Add this line
    this.tokens = new Map();
    this.safetyChecker = new SafetyChecker(
      positionManager.wallet,
      priceManager,
      logger
    );

    // Set up safety check event handlers
    this.safetyChecker.on("safetyCheck", ({ token, result, type }) => {
      this.logger.debug("Safety check result:", {
        token: token.address,
        result,
        type,
      });

      // If token is unsafe, we might want to take action
      if (!result.safe) {
        this.logger.warn("Token failed safety check:", {
          address: token.address,
          reasons: result.reasons,
          type,
        });

        // Optionally emit our own event for upstream handlers
        this.emit("tokenUnsafe", {
          token,
          reasons: result.reasons,
          type,
        });
      }
    });

    // Set up WebSocket event listeners
    if (this.webSocketManager) {
      this.webSocketManager.on("newToken", (tokenData) => {
        this.handleNewToken(tokenData);
      });

      this.webSocketManager.on("tokenTrade", (tradeData) => {
        this.handleTokenTrade(tradeData);
      });
    }

    // Set up cleanup interval
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [mint, token] of this.tokens) {
        if (now - token.createdAt > this.config.MAX_TOKEN_AGE) {
          this.logger.info("Cleaning up aged token", { mint });
          this.removeToken(mint);
        }
      }
    }, 60000); // Check every minute

    this.setMaxListeners(1000); // Increase for more tokens
  }

  async handleNewToken(tokenData) {
    // Check if token limit has been reached
    if (this.tokens.size >= MAX_CONCURRENT_TOKENS) {
      this.logger.warn("Max token limit reached, skipping new token", {
        mint: tokenData.mint,
        currentCount: this.tokens.size,
      });
      return;
    }

    try {
      this.logger.info("New token detected", {
        mint: tokenData.mint,
        symbol: tokenData.symbol,
      });

      // Create new Token instance
      const token = new Token(tokenData, {
        logger: this.logger,
        config: this.config,
        safetyChecker: this.safetyChecker, // Uncomment this line
        priceManager: this.priceManager,
        positionManager: this.positionManager,
      });

      // Set up token-specific safety check listener ONCE
      this.safetyChecker.on(
        `safetyCheck:${token.address}`,
        ({ result, type }) => {
          try {
            this.logger.debug("Safety check result:", {
              token: token.address,
              result,
              type,
            });

            if (!result.safe) {
              this.logger.warn("Token failed safety check:", {
                address: token.address,
                reasons: result.reasons,
                type,
              });

              this.emit("tokenUnsafe", {
                token,
                reasons: result.reasons,
                type,
              });
            }
          } catch (error) {
            this.logger.error("Error handling safety check event:", {
              token: token.address,
              error: error.message,
            });
          }
        }
      );

      // Announce when token is ready for position
      token.on("readyForPosition", ({ token, metrics, suggestedSize }) => {
        if (this.config.TRADING.ENABLED) {
          try {
            this.positionManager.openPosition(token, suggestedSize);
          } catch (error) {
            this.logger.error("Failed to open position", {
              mint: token.mint,
              error: error.message,
              metrics,
            });
          }
        } else {
          this.logger.info("Trading is disabled, skipping position", {
            mint: token.mint,
            metrics,
          });
        }
      });

      // Set up other token event listeners
      token.on("stateChanged", ({ oldState, newState }) => {
        try {
          this.logger.debug("Token state changed", {
            mint: token.mint,
            oldState,
            newState,
          });
        } catch (error) {
          this.logger.error("Error handling state change event:", {
            mint: token?.mint,
            error: error.message,
          });
        }
      });

      // THIS IS THE EXACT STRUCTURE, DO NOT CHANGE UNLESS YOU KNOW WHAT YOU ARE DOING
      token.on("trade", (tradeData) => {
        try {
          this.logger.debug("Trade event received", {
            mint: tradeData.mint,
            txType: tradeData.txType,
            tokenAmount: tradeData.tokenAmount,
            vTokensInBondingCurve: tradeData.vTokensInBondingCurve,
            vSolInBondingCurve: tradeData.vSolInBondingCurve,
            marketCapSol: tradeData.marketCapSol,
          });
          this.emit("tokenTrade", tradeData);
        } catch (error) {
          this.logger.error("Error handling trade event:", {
            mint: tradeData?.mint,
            error: error.message,
          });
        }
      });

      // Store token
      this.tokens.set(tokenData.mint, token);

      // Subscribe to token trades
      this.webSocketManager.subscribeToToken(tokenData.mint);
    } catch (error) {
      this.logger.error("Error handling new token:", error);
    }
  }

  handleTokenTrade(tradeData) {
    const token = this.tokens.get(tradeData.mint);
    if (token) {
      // Update token metrics with trade data
      token.update(tradeData);

      this.logger.debug("Token trade detected", {
        mint: tradeData.mint,
        txType: tradeData.txType,
      });

      this.logger.debug("Token updated TokenTracker.js", {
        mint: tradeData.mint,
        marketCapSol: tradeData.marketCapSol,
      });

      // If token is no longer active (liquidity removed)
      if (
        tradeData.vTokensInBondingCurve === 0 ||
        tradeData.vSolInBondingCurve === 0
      ) {
        try {
          this.logger.info("Token liquidity removed, cleaning up", {
            mint: tradeData.mint,
            vTokens: tradeData.vTokensInBondingCurve,
            vSol: tradeData.vSolInBondingCurve,
            marketCap: tradeData.marketCapSol,
          });

          // Emit event before removal for any final analytics
          this.emit("tokenLiquidityRemoved", {
            mint: tradeData.mint,
            token,
            metrics: {
              vTokens: tradeData.vTokensInBondingCurve,
              vSol: tradeData.vSolInBondingCurve,
              marketCap: tradeData.marketCapSol,
              txType: tradeData.txType,
              state: token.state,
              lifetime: {
                maxMarketCap: token.maxMarketCap,
                totalTrades: token.trades?.length || 0,
                age: Date.now() - token.createdAt,
              },
            },
          });

          this.removeToken(tradeData.mint);
        } catch (error) {
          this.logger.error("Error removing token:", {
            mint: tradeData.mint,
            error: error.message,
          });
        }
      }
    }
  }

  removeToken(mint) {
    const token = this.tokens.get(mint);
    if (token) {
      // Clean up safety checker resources
      this.safetyChecker.cleanupToken(token.address);
      this.safetyChecker.removeAllListeners(`safetyCheck:${token.address}`);

      // Clean up token resources
      token.cleanup();

      // Remove the token from our map
      this.tokens.delete(mint);

      // Unsubscribe from WebSocket updates
      this.webSocketManager.unsubscribeFromToken(mint);

      this.logger.debug("Token removed", { mint });

      // Emit event for other components
      this.emit("tokenRemoved", { mint, token });
    }
  }

  cleanup() {
    // Clear the cleanup interval
    clearInterval(this.cleanupInterval);

    // Clean up all tokens using our existing removeToken method
    for (const [mint] of this.tokens) {
      this.removeToken(mint);
    }

    // Clean up WebSocket manager globally
    this.webSocketManager.cleanup();

    this.logger.info("TokenTracker cleaned up", {
      finalTokenCount: this.tokens.size,
    });
  }
}

module.exports = TokenTracker;
