const WebSocket = require("ws");
const EventEmitter = require("events");
const config = require("./config");

class WebSocketManager extends EventEmitter {
  constructor(config, logger) {
    super();
    this.config = config;
    this.logger = logger;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.subscribedTokens = new Set();
    this.subscribedToNewTokens = false;
    this.maxReconnectAttempts = 5;
    this.reconnectTimer = null;
    this.ws = null;

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
          message.method === "subscribeNewToken" ||
          message.method === "subscribeTokenTrade" ||
          message.method === "unsubscribeTokenTrade"
        ) {
          return;
        }

        if (message.txType === "create") {
          if (!message.mint || !message.symbol) {
            this.logger.error("Invalid token creation message", { data });
            return;
          }

          this.emit("newToken", message);
        } else if (message.txType === "buy" || message.txType === "sell") {
          this.emit("tokenTrade", message);
        }
      } catch (error) {
        // Silently log invalid JSON messages
        if (error instanceof SyntaxError) {
          this.logger.error("Failed to parse WebSocket message", {
            data: data.toString().substring(0, 100), // Log only first 100 chars to avoid huge logs
            error: error.message,
          });
          return;
        }
        // Re-throw other types of errors
        throw error;
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
    if (!this.isConnected || this.subscribedToNewTokens) return;

    this.ws.send(
      JSON.stringify({
        method: "subscribeNewToken",
      })
    );

    this.subscribedToNewTokens = true;
  }

  unsubscribeFromNewTokens() {
    if (!this.isConnected || !this.subscribedToNewTokens) return;

    this.ws.send(
      JSON.stringify({
        method: "unsubscribeNewToken",
      })
    );

    this.subscribedToNewTokens = false;
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
    if (this.subscribedToNewTokens) {
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
