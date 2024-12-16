const WebSocket = require("ws");
const EventEmitter = require("events");
const config = require("./config");

class WebSocketManager extends EventEmitter {
  constructor(tokenTracker, priceManager) {
    super();
    this.tokenTracker = tokenTracker;
    this.priceManager = priceManager;
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
      if (!this.ws) {
        this.ws = new WebSocket(config.WEBSOCKET.URL);
      }

      this.ws.on("open", () => {
        console.log("WebSocket connected");
        this.isConnected = true;
        this.emit("connected");

        let payload = {
          method: "subscribeNewToken",
        };
        this.ws.send(JSON.stringify(payload));
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
            data: { rawMessage: data.toString() },
          });
        }
      });

      this.ws.on("close", () => {
        console.log("WebSocket disconnected");
        this.isConnected = false;
        this.emit("disconnected");

        // Implement exponential backoff for reconnection
        const backoffTime = Math.min(
          config.WEBSOCKET.RECONNECT_TIMEOUT *
            Math.pow(2, this.reconnectAttempts || 0),
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
          type: error.constructor.name,
        });
      });
    } catch (error) {
      console.error("Error creating WebSocket connection:", error.message);
      this.emit("error", {
        source: "WebSocketManager.connect",
        message: error.message,
        stack: error.stack,
        type: error.constructor.name,
      });

      // Attempt to reconnect
      setTimeout(() => {
        this.connect();
      }, config.WEBSOCKET.RECONNECT_TIMEOUT);
    }
  }

  setWebSocket(mockWebSocket) {
    this.ws = mockWebSocket;
  }

  handleMessage(message) {
    if (!message) {
      return;
    }

    try {
      // Handle token creation messages
      if (message.txType === "create") {
        if (!this.priceManager.isInitialized()) {
          console.warn(
            "Waiting for PriceManager to initialize before processing new tokens..."
          );
          return;
        }

        try {
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

          // Subscribe to trades for the new token
          this.subscribeToToken(message.mint);

          this.emit("newToken", message);
          this.tokenTracker.handleNewToken(message);
        } catch (error) {
          console.error("Error processing new token:", error.message);
          this.emit("error", {
            source: "WebSocketManager.handleTokenCreation",
            message: error.message,
            stack: error.stack,
            type: error.constructor.name,
            data: { mint: message.mint, name: message.name },
          });
        }
        return;
      }

      // Handle specific known info messages
      if (
        message.message === "Successfully subscribed to token creation events."
      ) {
        // console.info("Subscription to token creation events confirmed.");
        return;
      }

      if (message.message === "Successfully subscribed to keys.") {
        // console.info("Subscription to token confirmed.");
        return;
      }

      // Handle trade messages
      if (message.txType === "buy" || message.txType === "sell") {
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
        data: { message },
      });
    }
  }

  subscribeToToken(mint) {
    this.ws.send(
      JSON.stringify({
        method: "subscribeTokenTrade",
        keys: [mint],
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
