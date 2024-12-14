const { expect } = require('chai');
const WebSocket = require('ws');
const WebSocketManager = require('../src/WebSocketManager');
const sinon = require('sinon');
const EventEmitter = require('events');

describe('WebSocketManager', () => {
  let webSocketManager;
  let mockWebSocket;
  let clock;
  let originalWebSocket;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    mockWebSocket = new EventEmitter();
    mockWebSocket.send = sinon.spy();
    mockWebSocket.close = sinon.spy();

    // Store the original WebSocket
    originalWebSocket = global.WebSocket;
    // Replace WebSocket with our mock constructor
    global.WebSocket = function() {
      return mockWebSocket;
    };

    webSocketManager = new WebSocketManager();
  });

  afterEach(() => {
    clock.restore();
    // Restore the original WebSocket
    global.WebSocket = originalWebSocket;
    if (webSocketManager) {
      webSocketManager.close();
    }
  });

  it('should initialize correctly', () => {
    expect(webSocketManager).to.be.instanceOf(WebSocketManager);
    expect(webSocketManager.isConnected).to.be.false;
    expect(webSocketManager.subscriptions).to.be.instanceOf(Set);
    expect(webSocketManager.tokens).to.be.instanceOf(Map);
  });

  it('should emit connected event when websocket opens', (done) => {
    webSocketManager.on('connected', () => {
      expect(webSocketManager.isConnected).to.be.true;
      done();
    });
    mockWebSocket.emit('open');
  });

  it('should emit disconnected event when websocket closes', (done) => {
    webSocketManager.on('disconnected', () => {
      expect(webSocketManager.isConnected).to.be.false;
      done();
    });
    mockWebSocket.emit('close');
  });

  it('should handle new token creation messages', (done) => {
    const newTokenMessage = {
      txType: 'create',
      mint: 'testMint123',
      initialBuy: 100,
      marketCapSol: 50
    };

    webSocketManager.on('newToken', (token) => {
      expect(token).to.deep.equal(newTokenMessage);
      expect(webSocketManager.tokens.get('testMint123')).to.deep.equal(newTokenMessage);
      done();
    });

    mockWebSocket.emit('message', JSON.stringify(newTokenMessage));
  });

  it('should handle buy/sell event messages', (done) => {
    const tradeMessage = {
      txType: 'buy',
      mint: 'testMint123',
      tokenAmount: 50,
      marketCapSol: 75
    };

    webSocketManager.on('trade', (trade) => {
      expect(trade).to.deep.equal(tradeMessage);
      done();
    });

    mockWebSocket.emit('message', JSON.stringify(tradeMessage));
  });

  it('should subscribe to token trades when connected', () => {
    mockWebSocket.emit('open');
    webSocketManager.subscribeToToken('testMint123');
    
    expect(webSocketManager.subscriptions.has('testMint123')).to.be.true;
    sinon.assert.calledWith(mockWebSocket.send, JSON.stringify({
      method: 'subscribeTokenTrade',
      keys: ['testMint123']
    }));
  });

  it('should unsubscribe from token trades when connected', () => {
    mockWebSocket.emit('open');
    webSocketManager.subscriptions.add('testMint123');
    webSocketManager.unsubscribeFromToken('testMint123');
    
    expect(webSocketManager.subscriptions.has('testMint123')).to.be.false;
    sinon.assert.calledWith(mockWebSocket.send, JSON.stringify({
      method: 'unsubscribeTokenTrade',
      keys: ['testMint123']
    }));
  });

  it('should attempt to reconnect on connection close', () => {
    mockWebSocket.emit('close');
    expect(webSocketManager.isConnected).to.be.false;
    clock.tick(5000);
  });

  it('should subscribe to new tokens on connection', () => {
    mockWebSocket.emit('open');
    expect(webSocketManager.isConnected).to.be.true;
    sinon.assert.calledWith(mockWebSocket.send, JSON.stringify({
      method: 'subscribeNewToken'
    }));
  });

  it('should resubscribe to existing tokens on reconnection', () => {
    webSocketManager.subscriptions.add('testMint123');
    mockWebSocket.emit('open');
    
    sinon.assert.calledWith(mockWebSocket.send, JSON.stringify({
      method: 'subscribeTokenTrade',
      keys: ['testMint123']
    }));
  });
});
