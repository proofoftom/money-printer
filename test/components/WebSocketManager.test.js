const WebSocketManager = require('../../src/services/websocket/WebSocketManager');
const TokenManager = require('../../src/core/token/TokenManager');

// Mock config
jest.mock('../../src/utils/config', () => ({
  WEBSOCKET: {
    URL: 'wss://test.url',
    RECONNECT_TIMEOUT: 1000,
    PING_INTERVAL: 30000,
    PONG_TIMEOUT: 10000,
    MAX_RETRIES: 3,
    MESSAGE_PROCESSING_DELAY: 100
  }
}));

// Mock TokenManager
jest.mock('../../src/core/token/TokenManager');

describe('WebSocketManager', () => {
  let wsManager;
  let mockTokenManager;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';

    // Create mock TokenManager with handleTokenTrade method
    mockTokenManager = {
      handleNewToken: jest.fn(),
      handleTokenTrade: jest.fn()
    };

    wsManager = new WebSocketManager(mockTokenManager);
  });

  afterEach(() => {
    if (wsManager) {
      wsManager.cleanup();
    }
  });

  describe('Message Handling', () => {
    it('should handle token creation message', async () => {
      const createMessage = {
        txType: 'create',
        signature: 'mock-signature',
        mint: 'mock-mint',
        traderPublicKey: 'mock-trader',
        initialBuy: 100,
        marketCapSol: 50,
        name: 'Mock Token',
        symbol: 'MOCK',
        uri: 'mock-uri',
        timestamp: Date.now(),
        bondingCurveKey: 'mock-curve',
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 10
      };

      await wsManager.handleMessage(JSON.stringify(createMessage));
      expect(mockTokenManager.handleNewToken).toHaveBeenCalledWith(expect.objectContaining({
        mint: createMessage.mint,
        marketCapSol: createMessage.marketCapSol,
        name: createMessage.name,
        symbol: createMessage.symbol
      }));
    });

    it('should handle buy trade message', async () => {
      const buyMessage = {
        txType: 'buy',
        signature: 'mock-signature',
        mint: 'mock-mint',
        traderPublicKey: 'mock-trader',
        tokenAmount: 100,
        solAmount: 1.5,
        timestamp: Date.now(),
        newTokenBalance: 100,
        bondingCurveKey: 'mock-curve',
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 10,
        marketCapSol: 50
      };

      await wsManager.handleMessage(JSON.stringify(buyMessage));
      expect(mockTokenManager.handleTokenTrade).toHaveBeenCalledWith(expect.objectContaining({
        type: 'buy',
        mint: buyMessage.mint,
        amount: buyMessage.tokenAmount
      }));
    });

    it('should handle sell trade message', async () => {
      const sellMessage = {
        txType: 'sell',
        signature: 'mock-signature',
        mint: 'mock-mint',
        traderPublicKey: 'mock-trader',
        tokenAmount: 50,
        solAmount: 0.8,
        timestamp: Date.now(),
        newTokenBalance: 50,
        bondingCurveKey: 'mock-curve',
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 10,
        marketCapSol: 50
      };

      await wsManager.handleMessage(JSON.stringify(sellMessage));
      expect(mockTokenManager.handleTokenTrade).toHaveBeenCalledWith(expect.objectContaining({
        type: 'sell',
        mint: sellMessage.mint,
        amount: sellMessage.tokenAmount
      }));
    });

    it('should handle invalid messages', async () => {
      // Test invalid trade message
      const invalidTradeMessage = {
        txType: 'buy',
        // Missing required fields
        tokenAmount: 100
      };

      await wsManager.handleMessage(JSON.stringify(invalidTradeMessage));
      expect(mockTokenManager.handleTokenTrade).not.toHaveBeenCalled();

      // Test invalid create message
      const invalidCreateMessage = {
        txType: 'create',
        // Missing required fields
        name: 'Test Token'
      };

      await wsManager.handleMessage(JSON.stringify(invalidCreateMessage));
      expect(mockTokenManager.handleNewToken).not.toHaveBeenCalled();

      // Test unknown message type
      const unknownMessage = {
        txType: 'unknown',
        data: 'test'
      };

      await wsManager.handleMessage(JSON.stringify(unknownMessage));
      expect(mockTokenManager.handleTokenTrade).not.toHaveBeenCalled();
      expect(mockTokenManager.handleNewToken).not.toHaveBeenCalled();
    });
  });

  describe('Connection Management', () => {
    it('should clean up resources properly', () => {
      const mockWebSocket = {
        close: jest.fn(),
        removeAllListeners: jest.fn()
      };
      wsManager.ws = mockWebSocket;

      wsManager.cleanup();

      expect(mockWebSocket.close).toHaveBeenCalled();
      expect(mockWebSocket.removeAllListeners).toHaveBeenCalled();
      expect(wsManager.messageQueue).toEqual([]);
      expect(wsManager.processingMessage).toBe(false);
    });
  });
});
