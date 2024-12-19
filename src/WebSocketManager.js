const WebSocket = require('ws');
const EventEmitter = require('events');
const config = require('./config');

class WebSocketManager extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectTimer = null;

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      this.close();
      process.exit(0);
    });
  }

  async connect() {
    try {
      this.ws = new WebSocket(config.WS_URL);
      this.setupEventHandlers();
    } catch (error) {
      console.error('Failed to connect to WebSocket:', error);
      await this.handleReconnect();
    }
  }

  setupEventHandlers() {
    this.ws.on('open', () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.emit('connected');
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        if (message.type === 'token') {
          this.emit('tokenData', message);
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    });

    this.ws.on('close', () => {
      this.isConnected = false;
      this.handleReconnect();
    });

    this.ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      this.isConnected = false;
    });
  }

  async handleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    
    // Clear any existing reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    // Use setTimeout for reconnect delay
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(error => {
        console.error('Reconnection attempt failed:', error);
      });
    }, config.RECONNECT_INTERVAL);
  }

  close() {
    // Clear any pending reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
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
