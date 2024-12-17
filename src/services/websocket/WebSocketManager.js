const WebSocket = require("ws");
const EventEmitter = require("events");
const config = require("../../utils/config");
const errorLogger = require("../../monitoring/errorLoggerInstance");

class WebSocketManager extends EventEmitter {
  constructor(tokenManager, priceManager) {
    super();
    this.tokenManager = tokenManager;
    this.priceManager = priceManager;
    this.subscriptions = new Set();
    this.isConnected = false;
    this.ws = null;

    // Get WebSocket configuration
    const wsConfig = config.WEBSOCKET;
    this.url = wsConfig.URL;
    this.reconnectTimeout = wsConfig.RECONNECT_TIMEOUT;
    this.pingInterval = wsConfig.PING_INTERVAL;
    this.pongTimeout = wsConfig.PONG_TIMEOUT;
    this.maxRetries = wsConfig.MAX_RETRIES;

    this.retryCount = 0;
    this.pingTimer = null;
    this.pongTimer = null;
    this.messageHandlers = new Map();

    // Don't auto-connect in test mode
    if (process.env.NODE_ENV !== "test") {
      this.connect();
    }

    // Increase max listeners to prevent warning
    this.setMaxListeners(20);

    // Store the SIGINT handler reference so we can remove it later
    this.sigintHandler = () => {
      console.log("Shutting down WebSocket connection...");
      this.close();
      process.exit(0);
    };

    // Handle process termination
    if (process.env.NODE_ENV !== "test") {
      process.on("SIGINT", this.sigintHandler);
    }
  }

  connect() {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = null;
    }

    try {
      this.ws = new WebSocket(this.url);

      this.ws.on("open", () => {
        console.info("WebSocket connection established");
        this.isConnected = true;
        this.emit("connected");

        // Subscribe to new token events
        this.ws.send(
          JSON.stringify({
            method: "subscribeNewToken",
          })
        );

        // Resubscribe to existing tokens
        // this.resubscribeToTokens();
      });

      this.ws.on("error", (error) => {
        console.error("WebSocket error:", error);
        this.emit("error", error);
      });

      this.ws.on("close", () => {
        console.warn("WebSocket connection closed");
        this.isConnected = false;
        this.emit("disconnected");
        if (process.env.NODE_ENV !== "test") {
          setTimeout(() => {
            console.info("Attempting to reconnect...");
            this.connect();
          }, this.reconnectTimeout);
        }
      });

      this.ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          console.error("Error parsing message:", error);
          this.emit("error", error);
        }
      });
    } catch (error) {
      console.error("Error creating WebSocket:", error);
      this.emit("error", error);
      if (process.env.NODE_ENV !== "test") {
        setTimeout(() => {
          console.log("Attempting to reconnect...");
          this.connect();
        }, this.reconnectTimeout);
      }
    }
  }

  handleMessage(message) {
    if (!message || typeof message !== "object") {
      return;
    }

    try {
      // Handle subscription confirmation messages
      if (
        message.message &&
        (message.message ===
          "Successfully subscribed to token creation events." ||
          message.message === "Successfully subscribed to keys.")
      ) {
        return;
      }

      // Validate required fields based on message type
      if (message.txType === "create") {
        if (!this.validateCreateMessage(message)) {
          throw new Error("Invalid create message format");
        }

        const marketCapUSD = this.priceManager.solToUSD(message.marketCapSol);
        if (marketCapUSD >= config.MCAP.MIN) {
          this.tokenManager.handleNewToken(message);
        }
      }
    } catch (error) {
      console.error("Error handling message:", error);
      this.emit("error", error);
    }
  }

  validateCreateMessage(message) {
    const requiredFields = [
      "mint",
      "traderPublicKey",
      "initialBuy",
      "bondingCurveKey",
      "vTokensInBondingCurve",
      "vSolInBondingCurve",
      "marketCapSol",
      "symbol",
    ];

    return requiredFields.every((field) => message[field] !== undefined);
  }

  validateTradeMessage(message) {
    const requiredFields = [
      "mint",
      "traderPublicKey",
      "tokenAmount",
      "newTokenBalance",
      "bondingCurveKey",
      "vTokensInBondingCurve",
      "vSolInBondingCurve",
      "marketCapSol",
    ];

    return requiredFields.every((field) => message[field] !== undefined);
  }

  // For testing purposes
  setWebSocket(ws) {
    this.ws = ws;
    this.isConnected = true;
  }

  subscribeToToken(mint) {
    if (!mint || typeof mint !== "string") {
      console.error("Invalid mint address:", mint);
      return;
    }

    if (this.subscriptions.has(mint)) {
      console.log(`Already subscribed to token: ${mint}`);
      return;
    }

    if (!this.isConnected || !this.ws) {
      console.log(
        `WebSocket not connected. Adding ${mint} to pending subscriptions.`
      );
      this.subscriptions.add(mint);
      return;
    }

    this.ws.send(
      JSON.stringify({
        method: "subscribeTokenTrade",
        keys: [mint],
      })
    );
    return true;
  }

  resubscribeToTokens() {
    if (!this.isConnected || !this.ws) {
      console.log("WebSocket not connected. Will resubscribe when connected.");
      return;
    }

    try {
      const allMints = Array.from(this.subscriptions);
      if (allMints.length === 0) return;

      const subscribeMessage = {
        op: "subscribe",
        channel: "trades",
        markets: allMints,
      };

      this.ws.send(JSON.stringify(subscribeMessage));
      console.log(`Resubscribed to ${allMints.length} tokens`);
    } catch (error) {
      console.error("Error resubscribing to tokens:", error);
      this.emit("error", error);
    }
  }

  f() {
    // Remove SIGINT handler
    if (this.sigintHandler) {
      process.removeListener("SIGINT", this.sigintHandler);
    }

    // Close WebSocket connection
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      this.ws = null;
    }

    this.isConnected = false;
    this.subscriptions.clear();
    this.removeAllListeners();
  }
}

module.exports = WebSocketManager;
