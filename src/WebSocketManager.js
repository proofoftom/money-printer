const WebSocket = require("ws");
const EventEmitter = require("events");
const config = require("./config");

class WebSocketManager extends EventEmitter {
  constructor(config, logger) {
    super();
    this.config = config;
    this.logger = logger;
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectTimer = null;
    this.subscribedTokens = new Set();
    this.isSubscribedToNewTokens = false;

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      this.close();
      process.exit(0);
    });
  }

  sanitizeString(str) {
    if (typeof str !== "string") return str;
    // Remove null bytes and trim whitespace
    return str.replace(/\0/g, "").trim();
  }

  sanitizeTokenData(data) {
    return {
      ...data,
      name: this.sanitizeString(data.name),
      symbol: this.sanitizeString(data.symbol),
      mint: this.sanitizeString(data.mint),
      traderPublicKey: this.sanitizeString(data.traderPublicKey),
      bondingCurveKey: this.sanitizeString(data.bondingCurveKey),
    };
  }

  async connect() {
    try {
      this.ws = new WebSocket(this.config.WS_URL);
      this.setupEventHandlers();
    } catch (error) {
      this.logger.error("Failed to connect to WebSocket:", { error });
      throw error;
    }
  }

  setupEventHandlers() {
    this.ws.on("open", () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.emit("connected");

      // Subscribe to new tokens
      this.subscribeToNewTokens();

      // Resubscribe to all active subscriptions
      this.resubscribeAll();
    });

    this.ws.on("message", (data) => {
      try {
        const message = JSON.parse(data);

        // Silently ignore subscription confirmation messages
        if (
          typeof message === "string" &&
          message.includes("Successfully subscribed")
        ) {
          this.logger.debug("Subscription confirmed");
          return;
        }

        this.logger.debug("WebSocket message received", {
          type: message.txType,
        });

        switch (message.txType) {
          case "create":
            // Validate required fields
            if (!message.mint || !message.symbol) {
              this.logger.error("Invalid token creation message", { message });
              return;
            }

            const tokenData = this.sanitizeTokenData({
              mint: message.mint,
              name: message.name,
              symbol: message.symbol,
              traderPublicKey: message.traderPublicKey,
              bondingCurveKey: message.bondingCurveKey,
              minted: Date.now(),
              marketCapSol: message.marketCapSol || 0,
              vTokensInBondingCurve: message.vTokensInBondingCurve || 0,
              vSolInBondingCurve: message.vSolInBondingCurve || 0,
            });
            this.emit("newToken", tokenData);
            break;

          case "buy":
          case "sell":
            if (!message.mint) {
              this.logger.error("Invalid trade message", { message });
              return;
            }

            const tradeData = this.sanitizeTokenData({
              txType: message.txType,
              mint: message.mint,
              traderPublicKey: message.traderPublicKey,
              tokenAmount: message.tokenAmount,
              newTokenBalance: message.newTokenBalance,
              marketCapSol: message.marketCapSol || 0,
              vTokensInBondingCurve: message.vTokensInBondingCurve || 0,
              vSolInBondingCurve: message.vSolInBondingCurve || 0,
            });

            if (this.config.LOGGING.TRADES) {
              this.logger.debug("Token trade detected", tradeData);
            }
            this.emit("tokenTrade", tradeData);
            break;

          default:
            this.logger.warn("Unknown message type", { type: message.txType });
        }
      } catch (error) {
        this.logger.error("Failed to parse WebSocket message", {
          error: error.message,
          data: typeof data === "string" ? data : "<binary>",
        });
        this.emit("error", error);
      }
    });

    this.ws.on("close", () => {
      this.isConnected = false;
      this.handleReconnect();
    });

    this.ws.on("error", (error) => {
      this.logger.error("WebSocket error:", { error });
      this.emit("error", error);
    });
  }

  subscribeToNewTokens() {
    if (!this.isConnected || this.isSubscribedToNewTokens) return;

    this.ws.send(
      JSON.stringify({
        method: "subscribeNewToken",
      })
    );

    this.isSubscribedToNewTokens = true;
  }

  unsubscribeFromNewTokens() {
    if (!this.isConnected || !this.isSubscribedToNewTokens) return;

    this.ws.send(
      JSON.stringify({
        method: "unsubscribeNewToken",
      })
    );

    this.isSubscribedToNewTokens = false;
  }

  subscribeToToken(mint) {
    if (!this.isConnected || this.subscribedTokens.has(mint)) return;

    this.ws.send(
      JSON.stringify({
        method: "subscribeTokenTrade",
        keys: [mint],
      })
    );

    this.subscribedTokens.add(mint);
  }

  unsubscribeFromToken(mint) {
    if (!this.isConnected || !this.subscribedTokens.has(mint)) return;

    this.ws.send(
      JSON.stringify({
        method: "unsubscribeTokenTrade",
        keys: [mint],
      })
    );

    this.subscribedTokens.delete(mint);
  }

  resubscribeAll() {
    // Resubscribe to new tokens if previously subscribed
    if (this.isSubscribedToNewTokens) {
      this.ws.send(
        JSON.stringify({
          method: "subscribeNewToken",
        })
      );
    }

    // Resubscribe to all tracked tokens
    if (this.subscribedTokens.size > 0) {
      this.ws.send(
        JSON.stringify({
          method: "subscribeTokenTrade",
          keys: Array.from(this.subscribedTokens),
        })
      );
    }
  }

  async handleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error("Max reconnection attempts reached");
      return;
    }

    this.reconnectAttempts++;

    // Clear any existing reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    // Use setTimeout for reconnect delay
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error) => {
        this.logger.error("Reconnection attempt failed:", { error });
        this.emit("error", error);
      });
    }, this.config.RECONNECT_INTERVAL);
  }

  close() {
    // Clear any pending reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Unsubscribe from all subscriptions
    if (this.isConnected) {
      this.unsubscribeFromNewTokens();
      this.subscribedTokens.forEach((mint) => this.unsubscribeFromToken(mint));
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }
}

module.exports = WebSocketManager;
