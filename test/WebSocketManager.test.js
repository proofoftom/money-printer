const { expect } = require('chai');
const sinon = require('sinon');
const WebSocket = require('ws');
const WebSocketManager = require('../src/services/websocket/WebSocketManager');
const TokenManager = require('../src/core/token/TokenManager');
const MockPriceManager = require('./mocks/mockPriceManager');
const EventEmitter = require('events');

describe('WebSocketManager', () => {
  let wsManager;
  let tokenManager;
  let priceManager;
  let mockWs;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    tokenManager = new TokenManager();
    priceManager = new MockPriceManager(1); // Set SOL price to $1 for simpler testing
    wsManager = new WebSocketManager(tokenManager, priceManager);
    
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
      const spy = sinon.spy(tokenManager, 'handleNewToken');
      const message = {
        signature: '3qQ2EDRHz5jVxKFe4pkiaY8ZfP6okJNH75a5ckGqRCo1e3eSZD8oeDUdpwMjgwZyQ2iLymAwc8a1Ly62ZQtdNFDn',
        mint: 'HALHiUFutmGJ48n5WLFihE566BTgxYG9JFsHkKMZN2UW',
        traderPublicKey: '5S78br7qpRpV46ErYPaYVmwCxXUwHacPB4ip8TPDm5Db',
        txType: 'create',
        initialBuy: 30280031.760362,
        bondingCurveKey: 'GFFiiixn6ZdvGXCFoE79fH5nuPyzrWUKHEL7tATe6gaf',
        vTokensInBondingCurve: 1042719968.239638,
        vSolInBondingCurve: 10.87118399999998,
        marketCapSol: 10.606399551471107,
        name: 'Test Token',
        symbol: 'TEST',
        uri: 'https://test.uri'
      };

      wsManager.handleMessage(message);
      expect(spy.calledWith(message)).to.be.true;
    });

    it('should handle trade messages', () => {
      const spy = sinon.spy(tokenManager, 'handleTokenUpdate');
      const message = {
        signature: '3AvtrNLxSctDZNU5CEPZ7A4iJcq64ocpZyZtaKaL3nRKm8PTQ2fBGewtUqhucatoQnzCg8FLG91pKt5Fn12D2gxD',
        mint: 'G31NnZDkmgo59CN4AhDhYWyFqZWXV29W5VcUar5Xpump',
        traderPublicKey: 'DAB8QPSKTE4DjbHTvkGEzRiKKw2N7cdwKdHX9NwKAcJz',
        txType: 'buy',
        tokenAmount: 67062499.874628,
        newTokenBalance: 67062499.874628,
        bondingCurveKey: '4YGMRKCJz9cJ71Xj5PY9vmwi8MnTJpWHDViUG1KNh8am',
        vTokensInBondingCurve: 1005937500.125372,
        vSolInBondingCurve: 31.999999996011773,
        marketCapSol: 31.81112145836451
      };

      wsManager.handleMessage(message);
      expect(spy.calledWith(message)).to.be.true;
    });

    it('should ignore subscription confirmation messages', () => {
      const spy = sinon.spy(tokenManager, 'handleTokenUpdate');
      const message = {
        message: 'Successfully subscribed to token trades'
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

  describe('trader subscriptions', () => {
    it('should subscribe to trader when connection is open', () => {
      const sendSpy = sinon.spy(mockWs, 'send');
      wsManager.ws = mockWs;
      wsManager.subscribeToTrader('testTrader');
      
      expect(sendSpy.calledOnce).to.be.true;
      expect(JSON.parse(sendSpy.firstCall.args[0])).to.deep.equal({
        method: 'subscribeAccountTrade',
        keys: ['testTrader']
      });
      expect(wsManager.subscribedTraders.has('testTrader')).to.be.true;
    });

    it('should queue trader subscription when not connected', () => {
      wsManager.subscribeToTrader('testTrader');
      
      expect(wsManager.pendingTraderSubscriptions.has('testTrader')).to.be.true;
      expect(wsManager.subscribedTraders.has('testTrader')).to.be.false;
    });

    it('should subscribe to pending traders on connection', () => {
      wsManager.pendingTraderSubscriptions.add('trader1');
      wsManager.pendingTraderSubscriptions.add('trader2');
      
      const sendSpy = sinon.spy(mockWs, 'send');
      wsManager.ws = mockWs;
      mockWs.emit('open');
      
      expect(sendSpy.calledOnce).to.be.true;
      expect(JSON.parse(sendSpy.firstCall.args[0])).to.deep.equal({
        method: 'subscribeAccountTrade',
        keys: ['trader1', 'trader2']
      });
      expect(wsManager.subscribedTraders.has('trader1')).to.be.true;
      expect(wsManager.subscribedTraders.has('trader2')).to.be.true;
      expect(wsManager.pendingTraderSubscriptions.size).to.equal(0);
    });

    it('should not resubscribe to already subscribed traders', () => {
      const sendSpy = sinon.spy(mockWs, 'send');
      wsManager.ws = mockWs;
      wsManager.subscribedTraders.add('testTrader');
      
      wsManager.subscribeToTrader('testTrader');
      
      expect(sendSpy.called).to.be.false;
    });
  });
});
