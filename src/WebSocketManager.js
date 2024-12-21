const WebSocket = require("ws");
const EventEmitter = require("events");

class WebSocketManager extends EventEmitter {
  constructor(config, logger, analytics) {
    super();
    this.config = config;
    this.logger = logger;
    this.analytics = analytics;
    this.isConnected = false;
    this.subscribedTokens = new Set();
    this.ws = null;
    this.connectAttempts = 0;
    this.maxAttempts = 3;

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      this.close();
      process.exit(0);
    });
  }

  async connect() {
    try {
      this.connectAttempts++;
      this.logger.debug("Connecting to WebSocket:", { 
        endpoint: this.config.WS_ENDPOINT 
      });

      this.ws = new WebSocket(this.config.WS_ENDPOINT, {
        handshakeTimeout: 10000, // 10 second handshake timeout
        headers: {
          'User-Agent': 'MoneyPrinter/1.0',
          'Origin': 'https://pumpportal.fun'
        }
      });

      // Handle connection errors
      this.ws.on("unexpected-response", (request, response) => {
        this.logger.error("Unexpected WebSocket response:", {
          status: response.statusCode,
          headers: response.headers
        });
        this.emit("error", new Error(`Unexpected response: ${response.statusCode}`));
      });

      this.ws.on("upgrade", (response) => {
        if (response.statusCode !== 101) {
          this.logger.error("Unexpected WebSocket response:", {
            statusCode: response.statusCode,
            statusMessage: response.statusMessage
          });
          if (this.analytics) {
            this.analytics.trackError('websocket');
          }
          return;
        }

        this.logger.debug("WebSocket upgrade successful:", {
          headers: response.headers
        });
      });

      this.ws.on("open", () => {
        this.connectAttempts = 0;
        this.isConnected = true;
        this.logger.info("WebSocket connected");
        this.emit("connected");

        // Subscribe to new tokens immediately
        const payload = {
          method: "subscribeNewToken"
        };
        this.ws.send(JSON.stringify(payload));

        // Resubscribe to existing tokens if any
        if (this.subscribedTokens.size > 0) {
          const tradePayload = {
            method: "subscribeTokenTrade",
            keys: Array.from(this.subscribedTokens)
          };
          this.ws.send(JSON.stringify(tradePayload));
        }
      });

      this.ws.on("message", (data) => {
        try {
          const message = JSON.parse(data);
          const now = Date.now();

          if (message.timestamp) {
            const latency = now - message.timestamp;
            if (this.analytics) {
              this.analytics.trackLatency('websocket', latency);
            }
          }

          // Handle subscription acknowledgments
          if (message.type === "subscribed" || message.type === "unsubscribed") {
            this.logger.debug(`WebSocket subscription update: ${message.type}`);
            return;
          }
          
          if (message.txType === "create") {
            const marketCapStr = message.marketCapSol.toFixed(2);
            const initialBuyM = (message.initialBuy / 1_000_000).toFixed(2);
            const bondingCurveStr = message.vSolInBondingCurve.toFixed(2);
            
            this.logger.info(
              `New Token Created: ${message.name} (${message.symbol}) | ` +
              `MCap: ${marketCapStr} SOL | Init: ${initialBuyM}M tokens | ` +
              `Bond: ${bondingCurveStr} SOL | ${message.mint}`
            );
            this.emit("newToken", message);
          } else if (message.txType === "buy" || message.txType === "sell") {
            this.logger.debug("Token Trade:", message);
            this.emit("tokenTrade", message);
          }
        } catch (error) {
          this.logger.error("Failed to parse WebSocket message:", { error, data: data.toString() });
          if (this.analytics) {
            this.analytics.trackError('websocket');
          }
        }
      });

      this.ws.on("error", (error) => {
        this.logger.error("WebSocket error:", { error: error.message });
        if (this.analytics) {
          this.analytics.trackError('websocket');
        }
        this.emit("error", error);
      });

      this.ws.on("close", () => {
        this.isConnected = false;
        this.logger.info("WebSocket disconnected");
        this.emit("disconnected");
        
        // Attempt to reconnect after a delay if we haven't exceeded max attempts
        if (this.connectAttempts < this.maxAttempts) {
          setTimeout(() => {
            if (!this.isConnected) {
              this.connect();
            }
          }, this.config.RECONNECT_INTERVAL || 1000);
        } else {
          this.logger.error("Max reconnection attempts reached");
          this.emit("error", new Error("Max reconnection attempts reached"));
        }
      });
    } catch (error) {
      this.logger.error("Failed to connect to WebSocket:", { error: error.message });
      throw error;
    }
  }

  subscribeToToken(mint) {
    if (!mint) {
      this.logger.error("Cannot subscribe: mint address is required");
      return;
    }

    this.subscribedTokens.add(mint);

    if (this.isConnected) {
      const payload = {
        method: "subscribeTokenTrade",
        keys: [mint]
      };
      this.ws.send(JSON.stringify(payload));
    }
  }

  unsubscribeFromToken(mint) {
    if (!mint) {
      this.logger.error("Cannot unsubscribe: mint address is required");
      return;
    }

    this.subscribedTokens.delete(mint);

    if (this.isConnected) {
      const payload = {
        method: "unsubscribeTokenTrade",
        keys: [mint]
      };
      this.ws.send(JSON.stringify(payload));
    }
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }
}

module.exports = WebSocketManager;
