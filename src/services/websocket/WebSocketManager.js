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
    this.pendingTraderSubscriptions = new Set(); // Track pending subscriptions
    this.subscribedTraders = new Set(); // Track subscribed traders
    
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

    // Listen for trader subscription events
    if (tokenManager.traderManager) {
      this.traderSubscriptionHandler = ({ publicKey }) => {
        this.subscribeToTrader(publicKey);
      };
      tokenManager.traderManager.on('subscribeTrader', this.traderSubscriptionHandler);
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
        this.subscribeToNewTokens();
        this.resubscribeToTokens();

        // Subscribe to any pending traders
        if (this.pendingTraderSubscriptions.size > 0) {
          const payload = {
            method: "subscribeAccountTrade",
            keys: Array.from(this.pendingTraderSubscriptions)
          };
          this.ws.send(JSON.stringify(payload));
          
          // Mark all as subscribed
          this.pendingTraderSubscriptions.forEach(publicKey => {
            this.subscribedTraders.add(publicKey);
          });
          this.pendingTraderSubscriptions.clear();
        }
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

    // Handle create messages
    if (message.txType === "create") {
      const marketCapUSD = this.priceManager.solToUSD(message.marketCapSol);

      // Track new token if it meets minimum market cap requirement
      if (marketCapUSD >= config.MCAP.MIN) {
        this.tokenManager.handleNewToken(message);
        // Subscribe to trades for the new token
        this.subscribeToToken(message.mint);
      }
      return;
    }

    // Handle trade messages
    if (message.txType === "buy" || message.txType === "sell") {
      // Check if token exists and is not dead before processing trade
      const token = this.tokenManager.getToken(message.mint);
      if (token && token.state !== "dead") {
        this.emit("trade", message);
        this.tokenManager.handleTokenUpdate(message);
      }
      return;
    }

    // Log unknown message formats to file
    errorLogger.log("Unknown WebSocket message format", {
      component: "WebSocketManager",
      method: "handleMessage",
      message
    });
  }

  // For testing purposes
  setWebSocket(ws) {
    this.ws = ws;
    this.isConnected = true;
  }

  subscribeToToken(mint) {
    if (
      !this.isConnected ||
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {
      console.debug("Cannot subscribe: WebSocket not connected");
      return false;
    }

    this.subscriptions.add(mint);
    this.ws.send(
      JSON.stringify({
        method: "subscribeTokenTrade",
        keys: [mint],
      })
    );
    return true;
  }

  unsubscribeFromToken(mint) {
    if (
      !this.isConnected ||
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {
      console.debug("Cannot unsubscribe: WebSocket not connected");
      return false;
    }

    this.subscriptions.delete(mint);
    this.ws.send(
      JSON.stringify({
        method: "unsubscribeTokenTrade",
        keys: [mint],
      })
    );
    return true;
  }

  subscribeToNewTokens() {
    if (
      !this.isConnected ||
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {
      console.debug("Cannot subscribe to new tokens: WebSocket not connected");
      return false;
    }

    this.ws.send(
      JSON.stringify({
        method: "subscribeNewToken",
      })
    );
    return true;
  }

  resubscribeToTokens() {
    if (
      !this.isConnected ||
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN ||
      this.subscriptions.size === 0
    ) {
      return false;
    }

    const keys = Array.from(this.subscriptions);
    this.ws.send(
      JSON.stringify({
        method: "subscribeTokenTrade",
        keys,
      })
    );
    return true;
  }

  subscribeToTrader(publicKey) {
    if (this.subscribedTraders.has(publicKey)) return;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const payload = {
        method: "subscribeAccountTrade",
        keys: [publicKey]
      };
      this.ws.send(JSON.stringify(payload));
      this.subscribedTraders.add(publicKey);
    } else {
      // Queue subscription for when connection is established
      this.pendingTraderSubscriptions.add(publicKey);
    }
  }

  close() {
    // Remove SIGINT handler
    if (this.sigintHandler) {
      process.removeListener("SIGINT", this.sigintHandler);
    }

    // Remove trader subscription handler
    if (this.tokenManager.traderManager && this.traderSubscriptionHandler) {
      this.tokenManager.traderManager.removeListener('subscribeTrader', this.traderSubscriptionHandler);
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
    this.pendingTraderSubscriptions.clear();
    this.subscribedTraders.clear();
    this.removeAllListeners();
  }
}

module.exports = WebSocketManager;
