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
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = null;
    }

    try {
      this.ws = new WebSocket(config.WEBSOCKET.URL);

      this.ws.on("open", () => {
        console.log("WebSocket connection established");
        this.isConnected = true;
        this.emit("connected");
        this.subscribeToNewTokens();
        this.resubscribeToTokens();
      });

      this.ws.on("error", (error) => {
        console.error("WebSocket error:", error);
        this.emit("error", error);
      });

      this.ws.on("close", () => {
        console.log("WebSocket connection closed");
        this.isConnected = false;
        this.emit("disconnected");
        if (process.env.NODE_ENV !== "test") {
          setTimeout(() => {
            console.log("Attempting to reconnect...");
            this.connect();
          }, config.WEBSOCKET.RECONNECT_TIMEOUT);
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
        }, config.WEBSOCKET.RECONNECT_TIMEOUT);
      }
    }
  }

  handleMessage(message) {
    if (!message) {
      return;
    }

    // Handle subscription confirmation messages silently
    if (
      message.message &&
      message.message.includes("Successfully subscribed")
    ) {
      return;
    }

    // Handle token creation messages
    if (message.txType === "create") {
      // Ignore tokens that are already above our heating up threshold
      const marketCapUSD = this.priceManager.solToUSD(message.marketCapSol);
      if (marketCapUSD > config.THRESHOLDS.HEATING_UP_USD) {
        console.log(
          `Ignoring new token ${message.name} (${
            message.mint
          }) - Market cap too high: $${marketCapUSD.toFixed(
            2
          )} (${message.marketCapSol.toFixed(2)} SOL)`
        );
        return;
      }

      this.emit("newToken", message);
      this.tokenTracker.handleNewToken(message);
      // Subscribe to trades for the new token
      this.subscribeToToken(message.mint);
      return;
    }

    // Handle trade messages
    if (message.txType === "buy" || message.txType === "sell") {
      this.emit("trade", message);
      this.tokenTracker.handleTokenUpdate(message);
      return;
    }

    console.debug("Unknown message format:", message);
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
