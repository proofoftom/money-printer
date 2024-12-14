const { expect } = require('chai');
const sinon = require('sinon');
const WebSocket = require('ws');
const WebSocketManager = require('../src/WebSocketManager');
const TokenTracker = require('../src/TokenTracker');
const EventEmitter = require('events');

describe('WebSocketManager', () => {
  let wsManager;
  let tokenTracker;
  let mockWs;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    tokenTracker = new TokenTracker();
    wsManager = new WebSocketManager(tokenTracker);
    
    // Create a mock WebSocket with all necessary methods
    mockWs = new EventEmitter();
    mockWs.readyState = WebSocket.OPEN;
    mockWs.send = sinon.spy();
    mockWs.close = sinon.spy();
    mockWs.removeAllListeners = sinon.spy();

    // Add event listeners
    mockWs.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        wsManager.handleMessage(message);
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    });
    
    // Set the mock WebSocket
    wsManager.setWebSocket(mockWs);
  });

  afterEach(() => {
    process.env.NODE_ENV = undefined;
    sinon.restore();
    wsManager.close();
  });

  describe('connect', () => {
    it('should establish WebSocket connection and set up event handlers', () => {
      expect(wsManager.isConnected).to.be.true;
      expect(mockWs.listenerCount('message')).to.be.at.least(1);
      expect(mockWs.listenerCount('error')).to.be.at.least(0);
      expect(mockWs.listenerCount('close')).to.be.at.least(0);
    });

    it('should handle connection open event correctly', () => {
      expect(wsManager.isConnected).to.be.true;
    });

    it('should handle connection close event correctly', () => {
      wsManager.close();
      expect(wsManager.isConnected).to.be.false;
      expect(wsManager.ws).to.be.null;
    });
  });

  describe('message handling', () => {
    it('should handle new token messages', () => {
      const spy = sinon.spy(tokenTracker, 'handleNewToken');
      const message = {
        type: 'newToken',
        data: { mint: 'testMint', name: 'TestToken' }
      };

      wsManager.handleMessage(message);
      expect(spy.calledWith(message.data)).to.be.true;
    });

    it('should handle trade messages', () => {
      const spy = sinon.spy(tokenTracker, 'handleTokenUpdate');
      const message = {
        type: 'trade',
        data: { mint: 'testMint', price: 1.0 }
      };

      wsManager.handleMessage(message);
      expect(spy.calledWith(message.data)).to.be.true;
    });

    it('should ignore subscription confirmation messages', () => {
      const spy = sinon.spy(tokenTracker, 'handleTokenUpdate');
      const message = {
        message: 'Successfully subscribed to testMint'
      };

      wsManager.handleMessage(message);
      expect(spy.called).to.be.false;
    });
  });

  describe('subscription management', () => {
    it('should subscribe to token trades', () => {
      const result = wsManager.subscribeToToken('testMint');
      expect(result).to.be.true;
      expect(mockWs.send.calledOnce).to.be.true;
      expect(wsManager.subscriptions.has('testMint')).to.be.true;
    });

    it('should unsubscribe from token trades', () => {
      wsManager.subscribeToToken('testMint');
      const result = wsManager.unsubscribeFromToken('testMint');
      expect(result).to.be.true;
      expect(mockWs.send.calledTwice).to.be.true;
      expect(wsManager.subscriptions.has('testMint')).to.be.false;
    });

    it('should subscribe to new tokens', () => {
      const result = wsManager.subscribeToNewTokens();
      expect(result).to.be.true;
      expect(mockWs.send.calledOnce).to.be.true;
    });

    it('should resubscribe to all tokens', () => {
      wsManager.subscribeToToken('testMint1');
      wsManager.subscribeToToken('testMint2');
      mockWs.send.resetHistory();

      const result = wsManager.resubscribeToTokens();
      expect(result).to.be.true;
      expect(mockWs.send.calledOnce).to.be.true;
    });

    it('should not subscribe when WebSocket is not connected', () => {
      wsManager.isConnected = false;
      expect(wsManager.subscribeToToken('testMint')).to.be.false;
      expect(mockWs.send.called).to.be.false;
    });

    it('should not subscribe when WebSocket is not open', () => {
      mockWs.readyState = WebSocket.CLOSING;
      expect(wsManager.subscribeToToken('testMint')).to.be.false;
      expect(mockWs.send.called).to.be.false;
    });
  });
});
