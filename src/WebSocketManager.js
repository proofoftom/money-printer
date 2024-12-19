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
    this.subscribedTokens = new Set();
    this.isSubscribedToNewTokens = false;

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      this.close();
      process.exit(0);
    });
  }

  async connect() {
    try {
      this.ws = new WebSocket('wss://pumpportal.fun/api/data');
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
      
      // Resubscribe to all active subscriptions
      this.resubscribeAll();
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        
        switch (message.txType) {
          case 'create':
            this.emit('newToken', {
              mint: message.mint,
              name: message.name,
              symbol: message.symbol,
              uri: message.uri,
              marketCapSol: message.marketCapSol,
              initialBuy: message.initialBuy,
              vTokensInBondingCurve: message.vTokensInBondingCurve,
              vSolInBondingCurve: message.vSolInBondingCurve
            });
            break;
          
          case 'buy':
          case 'sell':
            this.emit('tokenTrade', {
              type: message.txType,
              mint: message.mint,
              tokenAmount: message.tokenAmount,
              newTokenBalance: message.newTokenBalance,
              marketCapSol: message.marketCapSol,
              vTokensInBondingCurve: message.vTokensInBondingCurve,
              vSolInBondingCurve: message.vSolInBondingCurve
            });
            break;
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

  subscribeToNewTokens() {
    if (!this.isConnected || this.isSubscribedToNewTokens) return;
    
    this.ws.send(JSON.stringify({
      method: 'subscribeNewToken'
    }));
    
    this.isSubscribedToNewTokens = true;
  }

  unsubscribeFromNewTokens() {
    if (!this.isConnected || !this.isSubscribedToNewTokens) return;
    
    this.ws.send(JSON.stringify({
      method: 'unsubscribeNewToken'
    }));
    
    this.isSubscribedToNewTokens = false;
  }

  subscribeToToken(mint) {
    if (!this.isConnected || this.subscribedTokens.has(mint)) return;
    
    this.ws.send(JSON.stringify({
      method: 'subscribeTokenTrade',
      keys: [mint]
    }));
    
    this.subscribedTokens.add(mint);
  }

  unsubscribeFromToken(mint) {
    if (!this.isConnected || !this.subscribedTokens.has(mint)) return;
    
    this.ws.send(JSON.stringify({
      method: 'unsubscribeTokenTrade',
      keys: [mint]
    }));
    
    this.subscribedTokens.delete(mint);
  }

  resubscribeAll() {
    // Resubscribe to new tokens if previously subscribed
    if (this.isSubscribedToNewTokens) {
      this.ws.send(JSON.stringify({
        method: 'subscribeNewToken'
      }));
    }

    // Resubscribe to all tracked tokens
    if (this.subscribedTokens.size > 0) {
      this.ws.send(JSON.stringify({
        method: 'subscribeTokenTrade',
        keys: Array.from(this.subscribedTokens)
      }));
    }
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

    // Unsubscribe from all subscriptions
    if (this.isConnected) {
      this.unsubscribeFromNewTokens();
      this.subscribedTokens.forEach(mint => this.unsubscribeFromToken(mint));
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
