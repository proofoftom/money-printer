const SafetyChecker = require('../SafetyChecker');
const Token = require('../Token').Token;
const EventEmitter = require('events');

// Mock the config module
jest.mock('../config', () => ({
  MIN_TOKEN_AGE_SECONDS: 30,
  MIN_LIQUIDITY_SOL: 5,
  MIN_HOLDER_COUNT: 10,
  MIN_TRANSACTIONS: 5,
  MIN_MCAP_POSITION: 0.001,
  MAX_MCAP_POSITION: 0.01
}));

describe('SafetyChecker', () => {
  let safetyChecker;
  let mockWallet;
  let mockPriceManager;
  let mockLogger;
  let mockToken;
  let mockConfig;

  beforeEach(() => {
    mockWallet = {
      balance: 100,
      getBalance: jest.fn().mockReturnValue(100)
    };

    mockPriceManager = {
      solToUSD: jest.fn().mockImplementation(sol => sol * 100)
    };

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      logSafetyCheck: jest.fn()
    };

    safetyChecker = new SafetyChecker(mockWallet, mockPriceManager, mockLogger);

    // Create a mock token with default safe values
    mockToken = {
      mint: 'test-mint',
      symbol: 'TEST',
      createdAt: Date.now() - 600000, // 10 minutes old
      liquiditySol: 10,
      holderCount: 20,
      transactionCount: 30,
      marketCapSol: 1000,
      volume: 15,
      tradeCount: 60,
      currentPrice: 1.0,
      pumpState: {
        firstDipDetected: true,
        inCooldown: false,
        firstDipPrice: 0.8
      },
      holderHistory: [
        { timestamp: Date.now() - 300000, count: 10 },
        { timestamp: Date.now() - 150000, count: 15 },
        { timestamp: Date.now(), count: 25 }
      ],
      ohlcvData: {
        secondly: Array(30).fill().map((_, i) => ({
          timestamp: Date.now() - (30 - i) * 1000,
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.0,
          volume: 1,
          buyCount: 3,
          sellCount: 2
        }))
      },
      calculateVolatility: jest.fn().mockReturnValue(0.3)
    };
  });

  describe('Basic Safety Checks', () => {
    test('should pass all basic safety checks with valid token', () => {
      const result = safetyChecker.isTokenSafe(mockToken);
      expect(result.safe).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });

    test('should fail if token is too new', () => {
      mockToken.createdAt = Date.now() - 20000; // Less than 30 seconds
      const result = safetyChecker.isTokenSafe(mockToken);
      expect(result.safe).toBe(false);
      expect(result.reasons[0]).toMatch(/Token too new/);
    });

    test('should fail if liquidity is too low', () => {
      mockToken.liquiditySol = 2;
      const result = safetyChecker.isTokenSafe(mockToken);
      expect(result.safe).toBe(false);
      expect(result.reasons[0]).toMatch(/Insufficient liquidity/);
    });

    test('should fail if holder count is too low', () => {
      mockToken.holderCount = 5;
      const result = safetyChecker.isTokenSafe(mockToken);
      expect(result.safe).toBe(false);
      expect(result.reasons[0]).toMatch(/Too few holders/);
    });
  });

  describe('Market Activity Checks', () => {
    test('should check market activity only in recovery phase', () => {
      mockToken.pumpState.firstDipDetected = false;
      const result = safetyChecker.isTokenSafe(mockToken);
      expect(result.safe).toBe(true); // Should not perform market activity checks
    });

    test('should fail if volume is insufficient during recovery', () => {
      mockToken.volume = 5; // Below MIN_VOLUME_SOL
      const result = safetyChecker.isTokenSafe(mockToken);
      expect(result.safe).toBe(false);
      expect(result.reasons[0]).toMatch(/Insufficient volume/);
    });

    test('should fail if trade count is too low during recovery', () => {
      mockToken.tradeCount = 30; // Below MIN_TRADES
      const result = safetyChecker.isTokenSafe(mockToken);
      expect(result.safe).toBe(false);
      expect(result.reasons[0]).toMatch(/Insufficient trades/);
    });

    test('should fail if token is too old during recovery', () => {
      mockToken.createdAt = Date.now() - 7200000; // 2 hours old
      const result = safetyChecker.isTokenSafe(mockToken);
      expect(result.safe).toBe(false);
      expect(result.reasons[0]).toMatch(/Token too old/);
    });

    test('should fail if holder growth is insufficient during recovery', () => {
      mockToken.holderHistory = [
        { timestamp: Date.now() - 300000, count: 10 },
        { timestamp: Date.now(), count: 12 } // Only 2 new holders
      ];
      const result = safetyChecker.isTokenSafe(mockToken);
      expect(result.safe).toBe(false);
      expect(result.reasons[0]).toMatch(/Insufficient holder growth/);
    });

    test('should fail if volatility is too high during recovery', () => {
      mockToken.calculateVolatility.mockReturnValue(0.6); // Above MAX_VOLATILITY
      const result = safetyChecker.isTokenSafe(mockToken);
      expect(result.safe).toBe(false);
      expect(result.reasons[0]).toMatch(/Excessive volatility/);
    });

    test('should fail if buy/sell ratio is too low during recovery', () => {
      mockToken.ohlcvData.secondly = mockToken.ohlcvData.secondly.map(candle => ({
        ...candle,
        buyCount: 1,
        sellCount: 2 // More sells than buys
      }));
      const result = safetyChecker.isTokenSafe(mockToken);
      expect(result.safe).toBe(false);
      expect(result.reasons[0]).toMatch(/Insufficient buy pressure/);
    });
  });

  describe('Position Opening', () => {
    test('should allow opening position when all checks pass', () => {
      const result = safetyChecker.canOpenPosition(mockToken, 1);
      expect(result.allowed).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });

    test('should prevent opening position when size is too small', () => {
      const result = safetyChecker.canOpenPosition(mockToken, 0.5);
      expect(result.allowed).toBe(false);
      expect(result.reasons[0]).toMatch(/Position size too small/);
    });

    test('should prevent opening position when size is too large', () => {
      const result = safetyChecker.canOpenPosition(mockToken, 20);
      expect(result.allowed).toBe(false);
      expect(result.reasons[0]).toMatch(/Position size too large/);
    });

    test('should emit safety check events', () => {
      const eventSpy = jest.fn();
      safetyChecker.on('safetyCheck', eventSpy);

      // Make the token fail safety checks by setting volume too low
      mockToken.volume = 5;
      mockToken.pumpState.firstDipDetected = true;
      mockToken.pumpState.inCooldown = false;

      const result = safetyChecker.canOpenPosition(mockToken, 1);

      expect(eventSpy).toHaveBeenCalled();
      const eventCall = eventSpy.mock.calls[0][0];
      expect(eventCall.token).toBe(mockToken);
      expect(eventCall.result.safe).toBe(false);
      expect(eventCall.type).toBe('tokenSafety');
    });
  });
});
