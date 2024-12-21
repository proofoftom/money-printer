const SafetyChecker = require('../SafetyChecker');
const Token = require('../Token').Token;
const STATES = require('../constants/STATES');
const EventEmitter = require('events');

// Mock the config module with actual SafetyChecker values
jest.mock('../config', () => ({
  MIN_TOKEN_AGE_SECONDS: 30,
  MIN_VOLUME_SOL: 10,
  MIN_TRADES: 50,
  MAX_AGE_MS: 3600000,
  MIN_NEW_HOLDERS: 10,
  MIN_BUY_SELL_RATIO: 1.5,
  MAX_VOLATILITY: 0.5,
  HOLDER_CHECK_WINDOW_MS: 300000,
  MIN_CONFIDENCE_FOR_ENTRY: 0.7,
  MAX_HOLDER_CONCENTRATION: 50,
  MAX_TIME_SINCE_LAST_TRADE: 60000,
  MIN_CYCLE_QUALITY_SCORE: 0.6,
  MIN_MCAP_POSITION: 0.001,
  MAX_MCAP_POSITION: 0.01,
  MATURE_TOKEN_MULTIPLIERS: {
    safetyThreshold: 1.5,
    minConfidence: 0.8,
    minVolume: 1.2
  }
}));

describe('SafetyChecker', () => {
  let safetyChecker;
  let mockWallet;
  let mockPriceManager;
  let mockLogger;
  let mockToken;

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
    safetyChecker.config = require('../config'); // Use the mocked config
    jest.spyOn(safetyChecker, 'emit');

    // Create a mock token with default safe values
    mockToken = {
      mint: 'test-mint',
      symbol: 'TEST',
      state: STATES.NEW,
      createdAt: Date.now() - 600000, // 10 minutes old
      lastStateChange: Date.now() - 600000,
      consecutiveFailures: 0,
      liquiditySol: 10,
      holderCount: 20,
      transactionCount: 30,
      marketCapSol: 1000,
      volume: 15,
      tradeCount: 60,
      currentPrice: 1.0,
      confidence: 0.8,
      lastTradeTime: Date.now() - 1000, // 1 second ago
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
      calculateVolatility: jest.fn().mockReturnValue(0.3),
      getDrawdownPercentage: jest.fn().mockReturnValue(20),
      getTopHolderConcentration: jest.fn().mockReturnValue(30),
      requiresSafetyCheck: jest.fn().mockReturnValue(true),
      setState: jest.fn()
    };
  });

  describe('Basic Safety Checks', () => {
    it('should pass all basic safety checks with valid token', () => {
      const result = safetyChecker.isTokenSafe(mockToken);
      expect(result.safe).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });

    it('should fail if token is too new', () => {
      mockToken.createdAt = Date.now() - 20000; // Less than 30 seconds
      const result = safetyChecker.isTokenSafe(mockToken);
      expect(result.safe).toBe(false);
      expect(result.reasons[0]).toMatch(/Token too new/);
    });

    it('should fail if volume is too low', () => {
      mockToken.volume = 5; // Less than MIN_VOLUME_SOL
      const result = safetyChecker.isTokenSafe(mockToken);
      expect(result.safe).toBe(false);
      expect(result.reasons[0]).toMatch(/Volume too low/);
    });

    it('should fail if confidence is too low', () => {
      mockToken.confidence = 0.5;
      const result = safetyChecker.isTokenSafe(mockToken);
      expect(result.safe).toBe(false);
      expect(result.reasons[0]).toMatch(/Confidence too low/);
    });

    it('should fail if holder concentration is too high', () => {
      mockToken.getTopHolderConcentration.mockReturnValue(60);
      const result = safetyChecker.isTokenSafe(mockToken);
      expect(result.safe).toBe(false);
      expect(result.reasons[0]).toMatch(/holder concentration too high/);
    });

    it('should fail if drawdown is too high', () => {
      mockToken.getDrawdownPercentage.mockReturnValue(95);
      const result = safetyChecker.isTokenSafe(mockToken);
      expect(result.safe).toBe(false);
      expect(result.reasons[0]).toMatch(/drawdown/);
    });
  });

  describe('Market Activity Checks', () => {
    beforeEach(() => {
      mockToken.state = STATES.READY;
      mockToken.cycleQualityScores = [{ score: 0.7 }];
    });

    it('should check market activity only in READY or MATURE state', () => {
      mockToken.state = STATES.NEW;
      mockToken.lastTradeTime = Date.now() - 120000; // 2 minutes ago
      const result = safetyChecker.isTokenSafe(mockToken);
      expect(result.safe).toBe(true);
    });

    it('should fail if no recent trades in READY state', () => {
      mockToken.lastTradeTime = Date.now() - 120000; // 2 minutes ago
      const result = safetyChecker.isTokenSafe(mockToken);
      expect(result.safe).toBe(false);
      expect(result.reasons[0]).toMatch(/No recent trades/);
    });

    it('should check cycle quality for mature tokens', () => {
      mockToken.state = STATES.MATURE;
      mockToken.cycleQualityScores = [{ score: 0.5 }];
      const result = safetyChecker.isTokenSafe(mockToken);
      expect(result.safe).toBe(false);
      expect(result.reasons[0]).toMatch(/Cycle quality/);
    });

    it('should apply multipliers for mature tokens', () => {
      mockToken.state = STATES.MATURE;
      mockToken.volume = 11; // Above normal MIN_VOLUME but below mature threshold
      const result = safetyChecker.isTokenSafe(mockToken);
      expect(result.safe).toBe(false);
      expect(result.reasons[0]).toMatch(/Volume too low/);
    });
  });

  describe('Position Opening', () => {
    it('should allow opening position when all checks pass', () => {
      const size = 2; // Within allowed range
      const result = safetyChecker.canOpenPosition(mockToken, size);
      expect(result.allowed).toBe(true);
      expect(result.reasons).toHaveLength(0);
      expect(safetyChecker.emit).toHaveBeenCalledWith('safetyCheck', {
        token: mockToken,
        result: { allowed: true, reasons: [] },
        type: 'openPosition'
      });
    });

    it('should prevent opening position when size is too small', () => {
      const size = 0.5; // Below MIN_MCAP_POSITION
      const result = safetyChecker.canOpenPosition(mockToken, size);
      expect(result.allowed).toBe(false);
      expect(result.reasons[0]).toMatch(/Position size too small/);
      expect(safetyChecker.emit).toHaveBeenCalledWith('safetyCheck', {
        token: mockToken,
        result: expect.objectContaining({ allowed: false }),
        type: 'positionSize'
      });
    });

    it('should prevent opening position when size is too large', () => {
      const size = 15; // Above MAX_MCAP_POSITION
      const result = safetyChecker.canOpenPosition(mockToken, size);
      expect(result.allowed).toBe(false);
      expect(result.reasons[0]).toMatch(/Position size too large/);
      expect(safetyChecker.emit).toHaveBeenCalledWith('safetyCheck', {
        token: mockToken,
        result: expect.objectContaining({ allowed: false }),
        type: 'positionSize'
      });
    });

    it('should handle errors gracefully', () => {
      mockToken.getDrawdownPercentage.mockImplementation(() => {
        throw new Error('Test error');
      });
      const result = safetyChecker.isTokenSafe(mockToken);
      expect(result.safe).toBe(false);
      expect(result.reasons).toContain('Error checking token safety');
    });
  });
});
