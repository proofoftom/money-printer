// WebSocketManager component

const EventEmitter = require('events');

class WebSocketManager extends EventEmitter {
  constructor() {
    super();
    this.pumpPortalWs = null;
    this.subscriptions = new Set();
    this.reconnectTimeout = 5000; // 5 seconds
    this.isConnected = false;
    this.tokens = new Map();
    this.connect();
  }

  connect() {
    try {
      // Use the global WebSocket (will be mocked in tests)
      this.pumpPortalWs = new WebSocket('wss://pumpportal.fun/data-api/real-time');
      this.setupWebSocketListeners();
    } catch (error) {
      console.error('Failed to connect to PumpPortal:', error);
      this.scheduleReconnect();
    }
  }

  setupWebSocketListeners() {
    if (!this.pumpPortalWs) return;

    this.pumpPortalWs.on('open', () => {
      this.isConnected = true;
      this.emit('connected');
      this.subscribeToNewTokens();
      this.resubscribeToTokens();
    });

    this.pumpPortalWs.on('message', (data) => {
      try {
        const message = typeof data === 'string' ? JSON.parse(data) : JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    });

    this.pumpPortalWs.on('close', () => {
      this.isConnected = false;
      this.emit('disconnected');
      this.scheduleReconnect();
    });

    this.pumpPortalWs.on('error', (error) => {
      console.error('WebSocket error:', error);
      this.isConnected = false;
      this.scheduleReconnect();
    });
  }

  scheduleReconnect() {
    setTimeout(() => this.connect(), this.reconnectTimeout);
  }

  handleMessage(message) {
    switch (message.txType) {
      case 'create':
        this.handleNewToken(message);
        break;
      case 'buy':
      case 'sell':
        this.handleTradeEvent(message);
        break;
      default:
        console.log('Unknown message type:', message);
    }
  }

  handleNewToken(tokenData) {
    this.tokens.set(tokenData.mint, tokenData);
    this.emit('newToken', tokenData);
  }

  handleTradeEvent(tradeData) {
    this.emit('trade', tradeData);
    const token = this.tokens.get(tradeData.mint);
    if (token) {
      token.vTokensInBondingCurve = tradeData.vTokensInBondingCurve;
      token.vSolInBondingCurve = tradeData.vSolInBondingCurve;
      token.marketCapSol = tradeData.marketCapSol;
    }
  }

  subscribeToNewTokens() {
    if (this.isConnected && this.pumpPortalWs) {
      this.pumpPortalWs.send(JSON.stringify({
        method: 'subscribeNewToken'
      }));
    }
  }

  subscribeToToken(mint) {
    if (!this.subscriptions.has(mint)) {
      this.subscriptions.add(mint);
      if (this.isConnected && this.pumpPortalWs) {
        this.pumpPortalWs.send(JSON.stringify({
          method: 'subscribeTokenTrade',
          keys: [mint]
        }));
      }
    }
  }

  unsubscribeFromToken(mint) {
    if (this.subscriptions.has(mint)) {
      this.subscriptions.delete(mint);
      if (this.isConnected && this.pumpPortalWs) {
        this.pumpPortalWs.send(JSON.stringify({
          method: 'unsubscribeTokenTrade',
          keys: [mint]
        }));
      }
    }
  }

  resubscribeToTokens() {
    if (this.subscriptions.size > 0 && this.isConnected && this.pumpPortalWs) {
      this.pumpPortalWs.send(JSON.stringify({
        method: 'subscribeTokenTrade',
        keys: Array.from(this.subscriptions)
      }));
    }
  }

  close() {
    if (this.pumpPortalWs) {
      this.pumpPortalWs.close();
      this.pumpPortalWs = null;
    }
  }
}

module.exports = WebSocketManager;
