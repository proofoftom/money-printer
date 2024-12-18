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

    // Create mock TokenManager
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
    it('should handle create message', async () => {
      const createMessage = {
        txType: 'create',
        signature: 'mock-signature',
        mint: 'mock-mint',
        traderPublicKey: 'mock-trader',
        initialBuy: 100,
        marketCapSol: 50,
        name: 'Mock Token',
        symbol: 'MOCK',
        uri: 'mock-uri'
      };

      await wsManager.handleMessage(JSON.stringify(createMessage));
      expect(mockTokenManager.handleNewToken).toHaveBeenCalledWith(createMessage);
    });

    it('should handle trade message', async () => {
      const tradeMessage = {
        txType: 'buy',
        mint: 'mock-mint',
        tokenAmount: 100
      };

      await wsManager.handleMessage(JSON.stringify(tradeMessage));
      expect(mockTokenManager.handleTokenTrade).toHaveBeenCalledWith(expect.objectContaining({
        type: tradeMessage.txType,
        mint: tradeMessage.mint,
        amount: tradeMessage.tokenAmount
      }));
    });
  });

  describe('Cleanup', () => {
    it('should clean up resources', () => {
      wsManager.cleanup();
      expect(wsManager.messageQueue).toEqual([]);
      expect(wsManager.processingMessage).toBe(false);
    });
  });
});
