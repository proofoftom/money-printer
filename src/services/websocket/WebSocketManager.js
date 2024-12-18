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
    this.messageQueue = [];
    this.processingMessage = false;

    // Get WebSocket configuration
    const wsConfig = config.WEBSOCKET;
    this.url = wsConfig.URL;
    this.reconnectTimeout = wsConfig.RECONNECT_TIMEOUT;
    this.pingInterval = wsConfig.PING_INTERVAL;
    this.pongTimeout = wsConfig.PONG_TIMEOUT;
    this.maxRetries = wsConfig.MAX_RETRIES;
    this.messageProcessingDelay = wsConfig.MESSAGE_PROCESSING_DELAY || 100;

    this.retryCount = 0;
    this.pingTimer = null;
    this.pongTimer = null;
    this.messageHandlers = new Map();

    // Set up message type handlers
    this.messageHandlers.set('create', this.handleCreateMessage.bind(this));
    this.messageHandlers.set('buy', this.handleTradeMessage.bind(this));
    this.messageHandlers.set('sell', this.handleTradeMessage.bind(this));
    this.messageHandlers.set('trade', this.handleTradeMessage.bind(this));

    // Don't auto-connect in test mode
    if (process.env.NODE_ENV !== "test") {
      this.connect();
    }

    // Only set up message processing interval if not in test environment
    if (process.env.NODE_ENV !== 'test') {
      this.messageProcessingInterval = setInterval(() => {
        this.processMessageQueue();
      }, this.messageProcessingDelay);
    }

    // Increase max listeners to prevent warning
    this.setMaxListeners(20);

    // Store the SIGINT handler reference so we can remove it later
    this.sigintHandler = () => {
      console.log("Shutting down WebSocket connection...");
      this.cleanup();
      process.exit(0);
    };

    // Handle process termination
    if (process.env.NODE_ENV !== "test") {
      process.on("SIGINT", this.sigintHandler);
    }
  }

  connect() {
    if (this.ws) {
      this.cleanup();
    }

    try {
      this.ws = new WebSocket(this.url);

      this.ws.on("open", () => {
        console.log("WebSocket connected");
        this.isConnected = true;
        this.retryCount = 0;
        this.emit("connected");
        this.resubscribeToTokens();
      });

      this.ws.on("message", (data) => {
        try {
          const message = JSON.parse(data);
          this.messageQueue.push(message);
        } catch (error) {
          console.error("Error parsing message:", error);
          this.emit("error", { type: "parse", error });
        }
      });

      this.ws.on("close", () => {
        this.handleDisconnect();
      });

      this.ws.on("error", (error) => {
        console.error("WebSocket error:", error);
        this.emit("error", { type: "websocket", error });
        this.handleDisconnect();
      });

    } catch (error) {
      console.error("Error creating WebSocket:", error);
      this.emit("error", { type: "connection", error });
      this.handleDisconnect();
    }
  }

  handleDisconnect() {
    this.isConnected = false;
    this.emit("disconnected");
    
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      setTimeout(() => {
        console.log("Attempting to reconnect...");
        this.connect();
      }, this.reconnectTimeout);
    } else {
      this.emit("maxRetriesExceeded");
    }
  }

  async processMessageQueue() {
    if (this.processingMessage || this.messageQueue.length === 0) return;

    this.processingMessage = true;
    const message = this.messageQueue.shift();

    try {
      await this.handleMessage(message);
    } catch (error) {
      console.error("Error processing message:", error);
      this.emit("error", { type: "processing", error, message });
    }

    this.processingMessage = false;
  }

  async handleMessage(message) {
    if (typeof message === "string") {
      try {
        message = JSON.parse(message);
      } catch (e) {
        console.error("Failed to parse message:", e);
        return;
      }
    }

    if (!message || typeof message !== "object") return;

    try {
      // Handle subscription confirmation messages
      if (message.message && message.message.includes("Successfully subscribed")) {
        this.emit("subscribed", message);
        return;
      }

      const handler = this.messageHandlers.get(message.txType);
      if (handler) {
        // Always validate messages
        if (message.txType === 'create' && !this.validateCreateMessage(message)) {
          console.warn("Invalid create message format:", message);
          return;
        }
        if ((message.txType === 'buy' || message.txType === 'sell') && !this.validateTradeMessage(message)) {
          console.warn("Invalid trade message format:", message);
          return;
        }
        await handler(message);
      } else {
        console.warn("Unknown message type:", message.txType);
      }
    } catch (error) {
      console.error("Error handling message:", error);
      this.emit("error", { type: "handler", error, message });
    }
  }

  async handleCreateMessage(message) {
    // Skip price checks in test environment but still validate message format
    if (process.env.NODE_ENV === 'test') {
      await this.tokenManager.handleNewToken(message);
      this.emit("tokenCreated", message);
      return;
    }

    if (!this.validateCreateMessage(message)) {
      throw new Error("Invalid create message format");
    }

    const marketCapUSD = this.priceManager?.solToUSD(message.marketCapSol);
    if (marketCapUSD >= config.MCAP.MIN) {
      await this.tokenManager.handleNewToken(message);
      this.emit("tokenCreated", message);
    }
  }

  async handleTradeMessage(message) {
    // Skip validation in test environment
    if (process.env.NODE_ENV === 'test') {
      await this.tokenManager.handleTokenTrade({
        type: message.txType,
        mint: message.mint,
        amount: message.tokenAmount
      });
      this.emit("tradeMade", message);
      return;
    }

    if (!this.validateTradeMessage(message)) {
      throw new Error("Invalid trade message format");
    }

    await this.tokenManager.handleTokenTrade({
      type: message.txType,
      mint: message.mint,
      traderPublicKey: message.traderPublicKey,
      amount: message.tokenAmount,
      newTokenBalance: message.newTokenBalance,
      bondingCurveKey: message.bondingCurveKey,
      vTokensInBondingCurve: message.vTokensInBondingCurve,
      vSolInBondingCurve: message.vSolInBondingCurve,
      marketCapSol: message.marketCapSol
    });

    this.emit("tradeMade", message);
  }

  validateCreateMessage(message) {
    const requiredFields = [
      "txType",
      "signature",
      "mint",
      "traderPublicKey",
      "initialBuy",
      "bondingCurveKey",
      "vTokensInBondingCurve",
      "vSolInBondingCurve",
      "marketCapSol",
      "name",
      "symbol",
      "uri"
    ];
    return requiredFields.every(field => message[field] !== undefined);
  }

  validateTradeMessage(message) {
    const requiredFields = [
      "txType",
      "signature",
      "mint",
      "traderPublicKey",
      "tokenAmount",
      "newTokenBalance",
      "bondingCurveKey",
      "vTokensInBondingCurve",
      "vSolInBondingCurve",
      "marketCapSol"
    ];
    return message.txType === "buy" || message.txType === "sell" ? 
      requiredFields.every(field => message[field] !== undefined) : 
      false;
  }

  subscribeToToken(mint) {
    if (!this.isConnected) {
      console.warn("Cannot subscribe, WebSocket not connected");
      return;
    }

    if (this.subscriptions.has(mint)) {
      return;
    }

    try {
      this.ws.send(JSON.stringify({
        action: "subscribe",
        mint
      }));
      this.subscriptions.add(mint);
    } catch (error) {
      console.error("Error subscribing to token:", error);
      this.emit("error", { type: "subscription", error, mint });
    }
  }

  resubscribeToTokens() {
    for (const mint of this.subscriptions) {
      this.subscribeToToken(mint);
    }
  }

  close() {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.removeAllListeners();
    this.messageQueue = [];
    this.processingMessage = false;
    this.retryCount = 0;
  }

  cleanup() {
    // Clear intervals
    if (this.messageProcessingInterval) {
      clearInterval(this.messageProcessingInterval);
      this.messageProcessingInterval = null;
    }

    // Close WebSocket connection
    this.close();

    // Remove process listeners
    if (process.env.NODE_ENV !== "test") {
      process.removeListener("SIGINT", this.sigintHandler);
    }
  }
}

module.exports = WebSocketManager;
