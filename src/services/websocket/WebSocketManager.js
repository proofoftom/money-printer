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
    if (!message || typeof message !== 'object') {
      return;
    }

    try {
      // Handle subscription confirmation messages
      if (message.message && (
        message.message === 'Successfully subscribed to token creation events.' ||
        message.message === 'Successfully subscribed to keys.'
      )) {
        return;
      }

      // Validate and normalize trade messages
      if (message.txType === 'trade') {
        if (!this.validateTradeMessage(message)) {
          throw new Error('Invalid trade message format');
        }

        const normalizedTrade = this.normalizeTradeMessage(message);
        this.tokenManager.handleTokenUpdate(normalizedTrade);
        return;
      }

      // Handle new token creation
      if (message.txType === 'create') {
        if (!this.validateCreateMessage(message)) {
          throw new Error('Invalid create message format');
        }

        const marketCapUSD = this.priceManager.solToUSD(message.marketCapSol);
        if (marketCapUSD >= config.MCAP.MIN) {
          this.tokenManager.handleNewToken(message);
        }
      }
    } catch (error) {
      console.error('Error handling message:', error);
      this.emit('error', error);
    }
  }

  validateCreateMessage(message) {
    const requiredFields = [
      'mint',
      'traderPublicKey',
      'initialBuy',
      'bondingCurveKey',
      'vTokensInBondingCurve',
      'vSolInBondingCurve',
      'marketCapSol',
      'symbol'
    ];

    return requiredFields.every(field => message[field] !== undefined);
  }

  validateTradeMessage(message) {
    // Basic message validation
    if (!message || typeof message !== 'object') {
      console.error('Invalid message format:', message);
      return false;
    }

    const requiredFields = [
      'mint',
      'traderPublicKey',
      'tokenAmount',
      'newTokenBalance',
      'bondingCurveKey',
      'vTokensInBondingCurve',
      'vSolInBondingCurve',
      'marketCapSol'
    ];

    const missingFields = requiredFields.filter(field => message[field] === undefined);
    if (missingFields.length > 0) {
      console.error('Missing required fields:', missingFields);
      return false;
    }

    // Validate numeric fields
    const numericFields = ['tokenAmount', 'newTokenBalance', 'vTokensInBondingCurve', 'vSolInBondingCurve', 'marketCapSol'];
    const invalidNumericFields = numericFields.filter(field => typeof message[field] !== 'number' || isNaN(message[field]));
    if (invalidNumericFields.length > 0) {
      console.error('Invalid numeric fields:', invalidNumericFields);
      return false;
    }

    return true;
  }

  normalizeTradeMessage(message) {
    try {
      // Calculate price safely
      let price = 0;
      if (message.vTokensInBondingCurve > 0) {
        price = message.vSolInBondingCurve / message.vTokensInBondingCurve;
      }

      return {
        mint: message.mint,
        type: (message.txType || 'unknown').toUpperCase(),
        amount: message.tokenAmount || 0,
        price: price,
        timestamp: Date.now(),
        newBalance: message.newTokenBalance || 0,
        traderPublicKey: message.traderPublicKey,
        marketCap: message.marketCapSol || 0,
        bondingCurveKey: message.bondingCurveKey
      };
    } catch (error) {
      console.error('Error normalizing trade message:', error);
      throw error;
    }
  }

  subscribeToToken(mint) {
    if (!mint || typeof mint !== 'string') {
      console.error('Invalid mint address:', mint);
      return;
    }

    if (this.subscriptions.has(mint)) {
      console.log(`Already subscribed to token: ${mint}`);
      return;
    }

    if (!this.isConnected || !this.ws) {
      console.log(`WebSocket not connected. Adding ${mint} to pending subscriptions.`);
      this.subscriptions.add(mint);
      return;
    }

    try {
      const subscribeMessage = {
        op: 'subscribe',
        channel: 'trades',
        markets: [mint]
      };

      this.ws.send(JSON.stringify(subscribeMessage));
      this.subscriptions.add(mint);
      console.log(`Subscribed to token: ${mint}`);
    } catch (error) {
      console.error(`Error subscribing to token ${mint}:`, error);
      this.emit('error', error);
    }
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
    if (!this.isConnected || !this.ws) {
      console.log('WebSocket not connected. Will resubscribe when connected.');
      return;
    }

    try {
      const allMints = Array.from(this.subscriptions);
      if (allMints.length === 0) return;

      const subscribeMessage = {
        op: 'subscribe',
        channel: 'trades',
        markets: allMints
      };

      this.ws.send(JSON.stringify(subscribeMessage));
      console.log(`Resubscribed to ${allMints.length} tokens`);
    } catch (error) {
      console.error('Error resubscribing to tokens:', error);
      this.emit('error', error);
    }
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
