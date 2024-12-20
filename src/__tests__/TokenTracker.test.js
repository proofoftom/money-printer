const TokenTracker = require('../TokenTracker');
const Token = require('../Token');
const EventEmitter = require('events');

// Mock the Token module
jest.mock('../Token', () => {
  return jest.fn(() => ({
    mint: 'test-mint',
    symbol: 'TEST',
    update: jest.fn(),
    cleanup: jest.fn(),
    startSafetyChecks: jest.fn(),
    on: jest.fn((event, handler) => {
      // Store the handler for later use in tests
      if (event === 'readyForPosition') {
        mockReadyForPositionHandler = handler;
      } else if (event === 'stateChanged') {
        mockStateChangedHandler = handler;
      }
    }),
    emit: jest.fn(),
    removeAllListeners: jest.fn()
  }));
});

// Store event handlers for testing
let mockReadyForPositionHandler;
let mockStateChangedHandler;

describe('TokenTracker', () => {
  let tokenTracker;
  let mockWebSocketManager;
  let mockPositionManager;
  let mockLogger;
  let mockConfig;

  beforeEach(() => {
    // Clear all mocks and handlers
    jest.clearAllMocks();
    mockReadyForPositionHandler = null;
    mockStateChangedHandler = null;

    // Create a real EventEmitter instance for the WebSocket mock
    mockWebSocketManager = new EventEmitter();
    mockWebSocketManager.subscribeToNewTokens = jest.fn();
    mockWebSocketManager.subscribeToToken = jest.fn();
    mockWebSocketManager.unsubscribeFromToken = jest.fn();

    mockPositionManager = {
      openPosition: jest.fn().mockResolvedValue(undefined),
      closePosition: jest.fn()
    };

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    mockConfig = {
      TRADING: {
        ENABLED: true,
        MIN_MARKET_CAP: 1.0,
        MAX_MARKET_CAP: 100.0
      }
    };

    // Get reference to the mock token that will be created
    Token.mockClear();
    tokenTracker = new TokenTracker(
      mockConfig,
      mockLogger,
      mockWebSocketManager,
      mockPositionManager
    );
  });

  describe('Token Management', () => {
    test('adds token successfully', () => {
      const tokenData = {
        mint: 'test-mint',
        symbol: 'TEST',
        marketCapSol: 5.0
      };

      mockWebSocketManager.emit('newToken', tokenData);

      expect(Token).toHaveBeenCalledWith(tokenData, {
        logger: mockLogger,
        config: mockConfig
      });
      expect(mockLogger.info).toHaveBeenCalledWith('New token detected', {
        mint: 'test-mint',
        symbol: 'TEST'
      });
      expect(mockWebSocketManager.subscribeToToken).toHaveBeenCalledWith('test-mint');
      expect(Token.mock.results[0].value.startSafetyChecks).toHaveBeenCalled();
    });

    test('removes token successfully', () => {
      const tokenData = {
        mint: 'test-mint',
        symbol: 'TEST',
        marketCapSol: 5.0
      };

      mockWebSocketManager.emit('newToken', tokenData);
      const mockToken = Token.mock.results[0].value;

      tokenTracker.removeToken('test-mint');

      expect(mockToken.cleanup).toHaveBeenCalled();
      expect(mockWebSocketManager.unsubscribeFromToken).toHaveBeenCalledWith('test-mint');
    });
  });

  describe('Position Management', () => {
    test('does not open position when trading is disabled', async () => {
      tokenTracker.config.TRADING.ENABLED = false;

      const tokenData = {
        mint: 'test-mint',
        symbol: 'TEST',
        marketCapSol: 5.0
      };

      mockWebSocketManager.emit('newToken', tokenData);

      // Trigger readyForPosition event
      await mockReadyForPositionHandler();

      expect(mockPositionManager.openPosition).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith('Trading is disabled, skipping position opening');
    });

    test('handles failed position opening', async () => {
      const error = new Error('Failed to open position');
      mockPositionManager.openPosition.mockRejectedValueOnce(error);

      const tokenData = {
        mint: 'test-mint',
        symbol: 'TEST',
        marketCapSol: 5.0
      };

      mockWebSocketManager.emit('newToken', tokenData);

      // Trigger readyForPosition event
      await mockReadyForPositionHandler();

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to open position', error);
    });
  });

  describe('Token State Changes', () => {
    test('handles token state changes', () => {
      const tokenData = {
        mint: 'test-mint',
        symbol: 'TEST',
        marketCapSol: 5.0
      };

      mockWebSocketManager.emit('newToken', tokenData);

      // Simulate token state change
      mockStateChangedHandler({ oldState: 'INIT', newState: 'READY' });

      expect(mockLogger.debug).toHaveBeenCalledWith('Token state changed', {
        mint: 'test-mint',
        oldState: 'INIT',
        newState: 'READY'
      });
    });

    test('handles token updates', () => {
      const tokenData = {
        mint: 'test-mint',
        symbol: 'TEST',
        marketCapSol: 5.0
      };

      mockWebSocketManager.emit('newToken', tokenData);
      const mockToken = Token.mock.results[0].value;

      const tradeData = {
        mint: 'test-mint',
        txType: 'buy',
        tokenAmount: 1000000,
        marketCapSol: 6.0
      };

      mockWebSocketManager.emit('tokenTrade', tradeData);

      expect(mockToken.update).toHaveBeenCalledWith(tradeData);
      expect(mockLogger.debug).toHaveBeenCalledWith('Token trade detected', {
        mint: 'test-mint',
        txType: 'buy'
      });
    });
  });
});
