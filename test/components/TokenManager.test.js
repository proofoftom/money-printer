const TokenManager = require('../../src/core/token/TokenManager');
const Token = require('../../src/core/token/Token');
const TokenStateManager = require('../../src/core/token/TokenStateManager');
const PriceManager = require('../../src/services/price/PriceManager');
const EventEmitter = require('events');

// Mock dependencies
jest.mock('../../src/core/token/Token');
jest.mock('../../src/core/token/TokenStateManager');
jest.mock('../../src/services/price/PriceManager');
jest.mock('../../src/utils/config', () => ({
  MCAP: {
    MIN: 10,
    MAX: 1000
  },
  RECOVERY_MONITOR_INTERVAL: 1000
}));

describe('TokenManager', () => {
  let tokenManager;
  let mockToken;
  let mockStateManager;
  let mockPriceManager;
  let mockSafetyChecker;
  let mockPositionManager;
  let mockWebSocketManager;
  let mockTraderManager;

  const mockTokenData = {
    mint: 'mock-mint',
    traderPublicKey: 'mock-trader',
    initialBuy: 100,
    marketCapSol: 50,
    vTokensInBondingCurve: 1000,
    vSolInBondingCurve: 10,
    name: 'Mock Token',
    symbol: 'MOCK',
    uri: 'mock-uri'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';

    // Create mock token
    mockToken = {
      update: jest.fn(),
      updateTrade: jest.fn(),
      recordTrade: jest.fn().mockResolvedValue(true),
      cleanup: jest.fn()
    };
    Token.mockImplementation(() => mockToken);

    // Create mock state manager with event emitter functionality
    mockStateManager = new EventEmitter();
    mockStateManager.setState = jest.fn();
    mockStateManager.updateState = jest.fn();
    mockStateManager.cleanup = jest.fn();
    TokenStateManager.mockImplementation(() => mockStateManager);

    // Create mock price manager
    mockPriceManager = new EventEmitter();
    mockPriceManager.solToUSD = jest.fn().mockReturnValue(100);

    // Create other mock dependencies
    mockSafetyChecker = new EventEmitter();
    mockPositionManager = new EventEmitter();
    mockWebSocketManager = new EventEmitter();
    mockTraderManager = new EventEmitter();
    mockTraderManager.handleTrade = jest.fn();

    // Create TokenManager instance with all dependencies
    tokenManager = new TokenManager(
      mockSafetyChecker,
      mockPositionManager,
      mockPriceManager,
      mockWebSocketManager,
      mockTraderManager,
      mockStateManager
    );
  });

  afterEach(() => {
    if (tokenManager._cleanupInterval) {
      clearInterval(tokenManager._cleanupInterval);
    }
    if (tokenManager._recoveryInterval) {
      clearInterval(tokenManager._recoveryInterval);
    }
    tokenManager?.cleanup();
    mockStateManager?.removeAllListeners();
    mockPriceManager?.removeAllListeners();
  });

  describe('Core Token Operations', () => {
    it('should handle new token creation', async () => {
      await tokenManager.handleNewToken(mockTokenData);

      expect(Token).toHaveBeenCalledWith(mockTokenData);
      expect(tokenManager.tokens.has(mockTokenData.mint)).toBe(true);
      expect(mockStateManager.setState).toHaveBeenCalledWith(
        expect.anything(),
        'new',
        'Token created'
      );
    });

    it('should handle token trades', async () => {
      // Create token first
      await tokenManager.handleNewToken(mockTokenData);

      const tradeData = {
        type: 'buy',
        mint: mockTokenData.mint,
        amount: 100,
        price: 1.5,
        timestamp: Date.now()
      };

      await tokenManager.handleTrade(tradeData);
      expect(mockToken.updateTrade).toHaveBeenCalledWith({
        type: tradeData.type,
        amount: tradeData.amount,
        price: tradeData.price,
        timestamp: tradeData.timestamp
      });
      expect(mockTraderManager.handleTrade).toHaveBeenCalledWith(tradeData);
    });

    it('should handle token updates', async () => {
      // Create token first
      await tokenManager.handleNewToken(mockTokenData);

      const updateData = {
        mint: mockTokenData.mint,
        type: 'buy',
        tokenAmount: 100,
        vTokensInBondingCurve: 1100,
        vSolInBondingCurve: 12,
        marketCap: 60
      };

      await tokenManager.handleTokenUpdate(updateData);
      expect(mockStateManager.updateState).toHaveBeenCalledWith(
        expect.anything(),
        updateData
      );
    });

    it('should cleanup resources properly', () => {
      // Add a token to clean up
      tokenManager.tokens.set(mockTokenData.mint, mockToken);
      
      tokenManager.cleanup();
      expect(mockToken.cleanup).toHaveBeenCalled();
      expect(mockStateManager.cleanup).toHaveBeenCalled();
      expect(tokenManager.tokens.size).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle token creation errors', async () => {
      Token.mockImplementation(() => {
        throw new Error('Token creation failed');
      });

      const result = await tokenManager.handleNewToken(mockTokenData);
      expect(result).toBeNull();
      expect(tokenManager.tokens.has(mockTokenData.mint)).toBe(false);
    });

    it('should handle trade errors gracefully', async () => {
      await tokenManager.handleNewToken(mockTokenData);
      mockToken.updateTrade.mockImplementation(() => {
        throw new Error('Trade failed');
      });

      const tradeData = {
        type: 'buy',
        mint: mockTokenData.mint,
        amount: 100,
        price: 1.5,
        timestamp: Date.now()
      };

      // Should not throw
      await tokenManager.handleTrade(tradeData);
      expect(mockToken.updateTrade).toHaveBeenCalled();
    });
  });
});
