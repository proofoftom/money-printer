const PositionManager = require('../PositionManager');
const Position = require('../Position');
const Token = require('../Token');
const STATES = require('../constants/STATES');

jest.mock('../Position');

describe('PositionManager', () => {
  let positionManager;
  let mockToken;
  let mockSafetyChecker;

  beforeEach(() => {
    jest.useFakeTimers();
    process.env.NODE_ENV = 'test';
    
    // Reset Position mock
    Position.mockClear();
    Position.mockImplementation((token) => ({
      token,
      open: jest.fn().mockResolvedValue(true),
      close: jest.fn().mockResolvedValue(true),
      priceCheckInterval: null,
      entryPrice: 1.0,
      once: jest.fn()
    }));

    positionManager = new PositionManager({ MAX_POSITIONS: 3 });

    // Initialize mockToken
    mockToken = createMockToken('test-mint');
    mockToken.setState = jest.fn();
    mockToken.checkSafetyConditions = jest.fn().mockResolvedValue({ safe: true });
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.NODE_ENV;
  });

  const createMockToken = (mint) => {
    // Mock SafetyChecker
    mockSafetyChecker = {
      checkToken: jest.fn().mockResolvedValue({ safe: true }),
      validatePrice: jest.fn().mockReturnValue(true),
      validateVolume: jest.fn().mockReturnValue(true)
    };

    // Mock minimal config
    const mockConfig = {
      PUMP_DETECTION_THRESHOLD: 20,
      DIP_DETECTION_THRESHOLD: 15,
      RECOVERY_THRESHOLD: 10,
      MAX_RECOVERY_THRESHOLD: 30,
      SAFETY_CHECK_TTL: 300000,
      UNSAFE_CHECK_TTL: 60000
    };

    const token = new Token({
      mint,
      symbol: 'TEST',
      vTokensInBondingCurve: 1000,
      vSolInBondingCurve: 100,
      marketCapSol: 10000
    }, {
      safetyChecker: mockSafetyChecker,
      logger: console,
      config: mockConfig
    });

    // Add price tracking properties
    token.currentPrice = 1.0;
    token.calculateTokenPrice = jest.fn().mockReturnValue(1.0);
    token.getCurrentPrice = jest.fn().mockReturnValue(1.0);

    // Mock OHLCV data
    token.ohlcvData = {
      secondly: [],
      fiveSeconds: [],
      thirtySeconds: [],
      minute: []
    };

    // Mock updateOHLCV to prevent timer issues
    token.updateOHLCV = jest.fn();

    return token;
  };

  describe('Position Queue Management', () => {
    test('respects maximum positions limit', async () => {
      // Fill up positions
      for (let i = 0; i < positionManager.config.MAX_POSITIONS; i++) {
        const token = createMockToken(`token-${i}`);
        const position = new Position(token);
        positionManager.positions.set(token.mint, position);
      }

      const extraToken = createMockToken('extra-token');
      const result = await positionManager.openPosition(extraToken);
      
      expect(result).toBe(false);
      expect(extraToken.state).toBe(STATES.SAFE_QUEUE);
    });

    test('processes queued tokens when slots become available', async () => {
      const queuedToken = createMockToken('queued-token');
      queuedToken.state = STATES.SAFE_QUEUE;
      queuedToken.lastSafetyCheck = {
        timestamp: Date.now(),
        result: { safe: true }
      };
      queuedToken.requiresSafetyCheck = jest.fn().mockReturnValue(false);
      
      positionManager.tokens.set(queuedToken.mint, queuedToken);
      await positionManager.processQueuedTokens();
      
      expect(positionManager.positions.has(queuedToken.mint)).toBe(true);
      expect(queuedToken.state).toBe(STATES.ACTIVE);
    });
  });

  describe('Position Lifecycle', () => {
    test('updates token state and maturity on position close', async () => {
      const position = new Position(mockToken);
      
      positionManager.positions.set(mockToken.mint, position);
      await positionManager.closePosition(mockToken);
      
      expect(mockToken.setState).toHaveBeenCalledWith(STATES.UNSAFE, expect.any(String));
      expect(position.close).toHaveBeenCalled();
    });

    test('performs safety check before opening position', async () => {
      await positionManager.openPosition(mockToken);
      expect(mockToken.checkSafetyConditions).toHaveBeenCalled();
    });
  });

  describe('Time-based Tests', () => {
    test('monitors significant price movements', async () => {
      const token = createMockToken('test');
      const position = new Position(token);
      
      positionManager.positions.set(token.mint, position);
      positionManager.monitorPosition(position);
      
      const eventSpy = jest.spyOn(positionManager, 'emit');
      
      // Simulate price increase
      token.currentPrice = 1.6;
      token.getCurrentPrice = jest.fn().mockReturnValue(1.6);
      
      await jest.advanceTimersByTimeAsync(5000);
      
      expect(eventSpy).toHaveBeenCalledWith('significantPriceMovement', expect.any(Object));
    });

    test('prioritizes tokens with fewer failed attempts in queue', async () => {
      const token1 = createMockToken('test1');
      const token2 = createMockToken('test2');
      
      token1.attempts = [
        { result: { safe: false } },
        { result: { safe: false } }
      ];
      token2.attempts = [
        { result: { safe: false } }
      ];
      
      token1.state = STATES.SAFE_QUEUE;
      token2.state = STATES.SAFE_QUEUE;
      
      token1.requiresSafetyCheck = jest.fn().mockReturnValue(false);
      token2.requiresSafetyCheck = jest.fn().mockReturnValue(false);
      
      positionManager.tokens.set(token1.mint, token1);
      positionManager.tokens.set(token2.mint, token2);
      
      await positionManager.processQueuedTokens();
      
      expect(positionManager.positions.has(token2.mint)).toBe(true);
      expect(token2.state).toBe(STATES.ACTIVE);
    });

    test('starts cooldown period after position closes', async () => {
      const token = createMockToken('test');
      const position = new Position(token);
      
      positionManager.positions.set(token.mint, position);
      await positionManager.closePosition(token);
      
      expect(token.state).toBe(STATES.UNSAFE);
      expect(token.unsafePumpCooldown).toBeGreaterThan(0);
    });
  });
});
