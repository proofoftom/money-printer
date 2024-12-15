const WebSocket = require("ws");
const EventEmitter = require("events");
const config = require("./config");

class WebSocketManager extends EventEmitter {
  constructor(tokenTracker, priceManager) {
    super();
    this.tokenTracker = tokenTracker;
    this.priceManager = priceManager;
    this.subscriptions = new Set();
    this.isConnected = false;
    this.ws = null;
    this.reconnectAttempts = 0;

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
    process.on("SIGINT", this.sigintHandler);
  }

  connect() {
    if (this.isConnected) {
      console.debug("Already connected");
      return;
    }

    console.log("Connecting to WebSocket...");
    
    try {
      this.ws = new WebSocket(config.WEBSOCKET.URL);

      this.ws.on("open", () => {
        console.log("WebSocket connected");
        this.isConnected = true;
        this.emit("connected");
        this.subscribeToNewTokens();
        this.resubscribeToTokens();
      });

      this.ws.on("message", (data) => {
        try {
          const message = JSON.parse(data);
          this.handleMessage(message);
        } catch (error) {
          console.error("Error parsing WebSocket message:", error.message);
          this.emit("error", {
            source: "WebSocketManager.messageParser",
            message: error.message,
            stack: error.stack,
            type: error.constructor.name,
            data: { rawMessage: data.toString() }
          });
        }
      });

      this.ws.on("close", () => {
        console.log("WebSocket disconnected");
        this.isConnected = false;
        this.emit("disconnected");
        
        // Implement exponential backoff for reconnection
        const backoffTime = Math.min(
          config.WEBSOCKET.RECONNECT_TIMEOUT * Math.pow(2, this.reconnectAttempts || 0),
          config.WEBSOCKET.MAX_RECONNECT_TIMEOUT
        );
        this.reconnectAttempts = (this.reconnectAttempts || 0) + 1;
        
        console.log(`Attempting to reconnect in ${backoffTime}ms...`);
        setTimeout(() => {
          this.connect();
        }, backoffTime);
      });

      this.ws.on("error", (error) => {
        console.error("WebSocket error:", error.message);
        this.emit("error", {
          source: "WebSocketManager.connection",
          message: error.message,
          stack: error.stack,
          type: error.constructor.name
        });
      });
    } catch (error) {
      console.error("Error creating WebSocket connection:", error.message);
      this.emit("error", {
        source: "WebSocketManager.connect",
        message: error.message,
        stack: error.stack,
        type: error.constructor.name
      });
      
      // Attempt to reconnect
      setTimeout(() => {
        this.connect();
      }, config.WEBSOCKET.RECONNECT_TIMEOUT);
    }
  }

  handleMessage(message) {
    if (!message) {
      return;
    }

    try {
      // Handle subscription confirmation messages silently
      if (
        message.message &&
        message.message.includes("Successfully subscribed")
      ) {
        return;
      }

      // Handle token creation messages
      if (message.txType === "create" && message.mint && message.name) {
        if (!this.priceManager.isInitialized()) {
          console.warn("Waiting for PriceManager to initialize before processing new tokens...");
          return;
        }

        try {
          // Ignore tokens that are already above our heating up threshold
          const marketCapUSD = this.priceManager.solToUSD(message.marketCapSol);
          if (marketCapUSD > config.THRESHOLDS.HEATING_UP_USD) {
            console.log(`Ignoring new token ${message.name} (${message.mint}) - Market cap too high: $${marketCapUSD.toFixed(2)} (${message.marketCapSol.toFixed(2)} SOL)`);
            return;
          }

          this.emit("newToken", message);
          this.tokenTracker.handleNewToken(message);
          // Subscribe to trades for the new token
          this.subscribeToToken(message.mint);
        } catch (error) {
          console.error("Error processing new token:", error.message);
          this.emit("error", {
            source: "WebSocketManager.handleTokenCreation",
            message: error.message,
            stack: error.stack,
            type: error.constructor.name,
            data: { mint: message.mint, name: message.name }
          });
        }
        return;
      }

      // Handle trade messages
      if (message.txType && message.mint && message.txType !== "create") {
        this.emit("trade", message);
        this.tokenTracker.handleTokenUpdate(message);
        return;
      }

      console.debug("Unknown message format:", message);
    } catch (error) {
      console.error("Error handling WebSocket message:", error.message);
      this.emit("error", {
        source: "WebSocketManager.handleMessage",
        message: error.message,
        stack: error.stack,
        type: error.constructor.name,
        data: { message }
      });
    }
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

  close() {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    process.removeListener("SIGINT", this.sigintHandler);
  }
}

module.exports = WebSocketManager;
