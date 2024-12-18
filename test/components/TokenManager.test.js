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
  RECOVERY_MONITOR_INTERVAL: 1000,
  SAFETY: {
    THRESHOLD: 0.1
  }
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

    // Create mock token with full functionality
    mockToken = {
      mint: mockTokenData.mint,
      update: jest.fn(),
      updateTrade: jest.fn(),
      recordTrade: jest.fn().mockResolvedValue(true),
      cleanup: jest.fn(),
      getState: jest.fn().mockReturnValue('new'),
      isPumping: jest.fn().mockReturnValue(false),
      isSafe: jest.fn().mockReturnValue(true),
      getMarketCap: jest.fn().mockReturnValue(mockTokenData.marketCapSol),
      getTokensInBondingCurve: jest.fn().mockReturnValue(mockTokenData.vTokensInBondingCurve),
      getSolInBondingCurve: jest.fn().mockReturnValue(mockTokenData.vSolInBondingCurve)
    };
    Token.mockImplementation(() => mockToken);

    // Create mock state manager with event emitter functionality
    mockStateManager = new EventEmitter();
    mockStateManager.setState = jest.fn();
    mockStateManager.updateState = jest.fn();
    mockStateManager.evaluateToken = jest.fn();
    mockStateManager.cleanup = jest.fn();
    TokenStateManager.mockImplementation(() => mockStateManager);

    // Create mock price manager
    mockPriceManager = new EventEmitter();
    mockPriceManager.solToUSD = jest.fn().mockReturnValue(100);
    mockPriceManager.getTokenPrice = jest.fn().mockReturnValue(0.1);

    // Create other mock dependencies
    mockSafetyChecker = new EventEmitter();
    mockSafetyChecker.isSafe = jest.fn().mockReturnValue(true);

    mockPositionManager = new EventEmitter();
    mockPositionManager.handleTrade = jest.fn();
    mockPositionManager.getCurrentPosition = jest.fn().mockReturnValue(null);

    mockWebSocketManager = new EventEmitter();
    mockWebSocketManager.subscribeToToken = jest.fn();

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
  });

  describe('Token Creation and Management', () => {
    it('should create and initialize a new token', async () => {
      await tokenManager.handleNewToken(mockTokenData);

      expect(Token).toHaveBeenCalledWith(
        expect.objectContaining({
          mint: mockTokenData.mint,
          marketCapSol: mockTokenData.marketCapSol
        })
      );
      expect(mockWebSocketManager.subscribeToToken).toHaveBeenCalledWith(mockTokenData.mint);
      expect(mockStateManager.setState).toHaveBeenCalledWith(mockToken, 'new');
    });

    it('should not create duplicate tokens', async () => {
      await tokenManager.handleNewToken(mockTokenData);
      await tokenManager.handleNewToken(mockTokenData);

      expect(Token).toHaveBeenCalledTimes(1);
    });
  });

  describe('Trade Handling', () => {
    beforeEach(async () => {
      await tokenManager.handleNewToken(mockTokenData);
    });

    it('should handle buy trades', async () => {
      const buyTrade = {
        type: 'buy',
        mint: mockTokenData.mint,
        amount: 50,
        price: 0.1
      };

      await tokenManager.handleTokenTrade(buyTrade);

      expect(mockToken.recordTrade).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'buy',
          amount: 50
        })
      );
      expect(mockStateManager.evaluateToken).toHaveBeenCalledWith(mockToken);
    });

    it('should handle sell trades', async () => {
      const sellTrade = {
        type: 'sell',
        mint: mockTokenData.mint,
        amount: 25,
        price: 0.1
      };

      await tokenManager.handleTokenTrade(sellTrade);

      expect(mockToken.recordTrade).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sell',
          amount: 25
        })
      );
      expect(mockStateManager.evaluateToken).toHaveBeenCalledWith(mockToken);
    });

    it('should ignore trades for unknown tokens', async () => {
      const unknownTrade = {
        type: 'buy',
        mint: 'unknown-mint',
        amount: 50
      };

      await tokenManager.handleTokenTrade(unknownTrade);

      expect(mockToken.recordTrade).not.toHaveBeenCalled();
      expect(mockStateManager.evaluateToken).not.toHaveBeenCalled();
    });

    it('should handle trades that affect token state', async () => {
      // Simulate a token that starts pumping after a trade
      mockToken.isPumping.mockReturnValue(true);
      mockToken.getMarketCap.mockReturnValue(100);

      const buyTrade = {
        type: 'buy',
        mint: mockTokenData.mint,
        amount: 100,
        price: 0.2
      };

      await tokenManager.handleTokenTrade(buyTrade);

      expect(mockStateManager.evaluateToken).toHaveBeenCalledWith(mockToken);
      expect(mockToken.recordTrade).toHaveBeenCalled();
    });
  });

  describe('Token State Transitions', () => {
    beforeEach(async () => {
      await tokenManager.handleNewToken(mockTokenData);
    });

    it('should handle token becoming unsafe', async () => {
      // Simulate token becoming unsafe
      mockToken.isSafe.mockReturnValue(false);
      mockSafetyChecker.isSafe.mockReturnValue(false);

      const sellTrade = {
        type: 'sell',
        mint: mockTokenData.mint,
        amount: 500,
        price: 0.05
      };

      await tokenManager.handleTokenTrade(sellTrade);

      expect(mockStateManager.evaluateToken).toHaveBeenCalledWith(mockToken);
    });

    it('should handle token entering recovery', async () => {
      // Simulate conditions for recovery
      mockToken.getState.mockReturnValue('drawdown');
      mockToken.isSafe.mockReturnValue(true);
      mockToken.getMarketCap.mockReturnValue(30);

      const buyTrade = {
        type: 'buy',
        mint: mockTokenData.mint,
        amount: 50,
        price: 0.15
      };

      await tokenManager.handleTokenTrade(buyTrade);

      expect(mockStateManager.evaluateToken).toHaveBeenCalledWith(mockToken);
    });
  });

  describe('Error Handling', () => {
    it('should handle token creation errors', async () => {
      // Mock Token constructor to throw
      Token.mockImplementation(() => {
        throw new Error('Token creation failed');
      });

      // Expect handleNewToken to throw
      await expect(async () => {
        await tokenManager.handleNewToken(mockTokenData);
      }).rejects.toThrow('Token creation failed');

      // Verify token was not added
      expect(tokenManager.tokens.has(mockTokenData.mint)).toBe(false);
    });

    it('should handle trade recording errors', async () => {
      await tokenManager.handleNewToken(mockTokenData);
      mockToken.recordTrade.mockRejectedValue(new Error('Trade recording failed'));

      const trade = {
        type: 'buy',
        mint: mockTokenData.mint,
        amount: 50
      };

      await expect(tokenManager.handleTokenTrade(trade))
        .rejects
        .toThrow('Trade recording failed');
    });
  });

  describe('Cleanup', () => {
    it('should clean up resources properly', async () => {
      await tokenManager.handleNewToken(mockTokenData);
      tokenManager.cleanup();

      expect(mockToken.cleanup).toHaveBeenCalled();
      expect(mockStateManager.cleanup).toHaveBeenCalled();
    });
  });
});
