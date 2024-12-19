const WebSocket = require('ws');
const WebSocketManager = require('../WebSocketManager');
const config = require('../config');

jest.mock('ws');

describe('WebSocketManager', () => {
  let wsManager;
  let mockWs;
  let mockEmit;

  beforeEach(() => {
    jest.useFakeTimers('modern');
    
    mockWs = {
      on: jest.fn(),
      send: jest.fn(),
      removeAllListeners: jest.fn(),
      close: jest.fn()
    };
    WebSocket.mockImplementation(() => mockWs);
    
    wsManager = new WebSocketManager();
    mockEmit = jest.spyOn(wsManager, 'emit');
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Connection Management', () => {
    it('should establish WebSocket connection', async () => {
      await wsManager.connect();
      
      expect(WebSocket).toHaveBeenCalledWith('wss://pumpportal.fun/api/data');
      expect(mockWs.on).toHaveBeenCalledWith('open', expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should handle connection success and resubscribe', async () => {
      await wsManager.connect();
      wsManager.isSubscribedToNewTokens = true;
      wsManager.subscribedTokens.add('TEST1');
      wsManager.subscribedTokens.add('TEST2');
      
      // Simulate connection success
      const openHandler = mockWs.on.mock.calls.find(call => call[0] === 'open')[1];
      openHandler();
      
      expect(wsManager.isConnected).toBe(true);
      expect(wsManager.reconnectAttempts).toBe(0);
      expect(mockEmit).toHaveBeenCalledWith('connected');
      
      // Verify resubscriptions
      expect(mockWs.send).toHaveBeenNthCalledWith(1, JSON.stringify({
        method: 'subscribeNewToken'
      }));
      expect(mockWs.send).toHaveBeenNthCalledWith(2, JSON.stringify({
        method: 'subscribeTokenTrade',
        keys: ['TEST1', 'TEST2']
      }));
    });
  });

  describe('Subscription Management', () => {
    beforeEach(async () => {
      await wsManager.connect();
      const openHandler = mockWs.on.mock.calls.find(call => call[0] === 'open')[1];
      openHandler();
    });

    it('should subscribe to new tokens', () => {
      wsManager.subscribeToNewTokens();
      
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        method: 'subscribeNewToken'
      }));
      expect(wsManager.isSubscribedToNewTokens).toBe(true);
    });

    it('should unsubscribe from new tokens', () => {
      wsManager.subscribeToNewTokens();
      wsManager.unsubscribeFromNewTokens();
      
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        method: 'unsubscribeNewToken'
      }));
      expect(wsManager.isSubscribedToNewTokens).toBe(false);
    });

    it('should subscribe to token trades', () => {
      wsManager.subscribeToToken('TEST');
      
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        method: 'subscribeTokenTrade',
        keys: ['TEST']
      }));
      expect(wsManager.subscribedTokens.has('TEST')).toBe(true);
    });

    it('should unsubscribe from token trades', () => {
      wsManager.subscribeToToken('TEST');
      wsManager.unsubscribeFromToken('TEST');
      
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        method: 'unsubscribeTokenTrade',
        keys: ['TEST']
      }));
      expect(wsManager.subscribedTokens.has('TEST')).toBe(false);
    });
  });

  describe('Message Handling', () => {
    let messageHandler;

    beforeEach(async () => {
      await wsManager.connect();
      messageHandler = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];
    });

    it('should handle new token messages', () => {
      const mockTokenData = {
        txType: 'create',
        mint: 'TEST',
        name: 'Test Token',
        symbol: 'TEST',
        uri: 'test-uri',
        marketCapSol: 100,
        initialBuy: 1000,
        vTokensInBondingCurve: 10000,
        vSolInBondingCurve: 50
      };
      
      messageHandler(JSON.stringify(mockTokenData));
      
      expect(mockEmit).toHaveBeenCalledWith('newToken', {
        mint: 'TEST',
        name: 'Test Token',
        symbol: 'TEST',
        uri: 'test-uri',
        marketCapSol: 100,
        initialBuy: 1000,
        vTokensInBondingCurve: 10000,
        vSolInBondingCurve: 50
      });
    });

    it('should handle trade messages', () => {
      const mockTradeData = {
        txType: 'buy',
        mint: 'TEST',
        tokenAmount: 1000,
        newTokenBalance: 2000,
        marketCapSol: 150,
        vTokensInBondingCurve: 9000,
        vSolInBondingCurve: 60
      };
      
      messageHandler(JSON.stringify(mockTradeData));
      
      expect(mockEmit).toHaveBeenCalledWith('tokenTrade', {
        type: 'buy',
        mint: 'TEST',
        tokenAmount: 1000,
        newTokenBalance: 2000,
        marketCapSol: 150,
        vTokensInBondingCurve: 9000,
        vSolInBondingCurve: 60
      });
    });

    it('should handle invalid message data', () => {
      const invalidData = 'invalid json';
      const consoleSpy = jest.spyOn(console, 'error');
      
      messageHandler(invalidData);
      
      expect(consoleSpy).toHaveBeenCalledWith('Failed to parse WebSocket message:', expect.any(Error));
    });
  });

  describe('Cleanup', () => {
    it('should unsubscribe and close WebSocket connection', async () => {
      await wsManager.connect();
      const openHandler = mockWs.on.mock.calls.find(call => call[0] === 'open')[1];
      openHandler();
      
      wsManager.subscribeToNewTokens();
      wsManager.subscribeToToken('TEST1');
      wsManager.subscribeToToken('TEST2');
      
      wsManager.close();
      
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        method: 'unsubscribeNewToken'
      }));
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        method: 'unsubscribeTokenTrade',
        keys: ['TEST1']
      }));
      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({
        method: 'unsubscribeTokenTrade',
        keys: ['TEST2']
      }));
      expect(mockWs.removeAllListeners).toHaveBeenCalled();
      expect(mockWs.close).toHaveBeenCalled();
      expect(wsManager.ws).toBeNull();
      expect(wsManager.isConnected).toBe(false);
    });
  });
});
