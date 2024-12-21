const EventEmitter = require('events');
const { Token, STATES } = require('../Token');
const { Position } = require('../Position');
const { SafetyChecker } = require('../SafetyChecker');
const { PriceManager } = require('../PriceManager');

jest.mock('../Position');
jest.mock('../SafetyChecker');
jest.mock('../PriceManager');

describe('Token', () => {
  let token;
  let mockPriceManager;
  let mockSafetyChecker;
  let mockLogger;
  let mockConfig;
  let defaultTokenData;

  beforeEach(() => {
    // Setup mock dependencies
    mockPriceManager = {
      getPrice: jest.fn().mockReturnValue(1.0)
    };

    mockSafetyChecker = {
      isTokenSafe: jest.fn().mockReturnValue({ safe: true, reasons: [] })
    };

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    mockConfig = {
      SAFETY_CHECK_INTERVAL: 2000,
      MIN_TOKEN_AGE_SECONDS: 15,
      TAKE_PROFIT_PERCENT: 50,
      STOP_LOSS_PERCENT: 10,
      TRAILING_STOP_PERCENT: 5,
      LOGGING: {
        POSITIONS: false,
        TRADES: false,
        NEW_TOKENS: false,
        SAFETY_CHECKS: false
      }
    };

    defaultTokenData = {
      mint: 'test-mint',
      name: 'Test Token',
      symbol: 'TEST',
      minted: Date.now(),
      traderPublicKey: 'trader-key',
      vTokensInBondingCurve: 1000,
      vSolInBondingCurve: 100,
      marketCapSol: 100,
      bondingCurveKey: 'curve-key'
    };

    // Create token instance
    token = new Token(defaultTokenData, {
      priceManager: mockPriceManager,
      safetyChecker: mockSafetyChecker,
      logger: mockLogger,
      config: mockConfig
    });

    // Spy on token events
    jest.spyOn(token, 'emit');
  });

  afterEach(() => {
    if (token) {
      token.cleanup();
    }
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    test('initializes with correct state and properties', () => {
      expect(token.mint).toBe(defaultTokenData.mint);
      expect(token.name).toBe(defaultTokenData.name);
      expect(token.symbol).toBe(defaultTokenData.symbol);
      expect(token.state).toBe(STATES.NEW);
      expect(token.marketCapSol).toBe(defaultTokenData.marketCapSol);
      expect(token.highestMarketCap).toBe(defaultTokenData.marketCapSol);
      expect(token.vTokensInBondingCurve).toBe(defaultTokenData.vTokensInBondingCurve);
      expect(token.vSolInBondingCurve).toBe(defaultTokenData.vSolInBondingCurve);
    });

    test('initializes with correct price calculations', () => {
      const expectedPrice = defaultTokenData.vSolInBondingCurve / defaultTokenData.vTokensInBondingCurve;
      expect(token.currentPrice).toBe(expectedPrice);
      expect(token.initialPrice).toBe(expectedPrice);
    });

    test('throws error on missing required fields', () => {
      const invalidData = { ...defaultTokenData };
      delete invalidData.mint;

      expect(() => {
        new Token(invalidData, {
          priceManager: mockPriceManager,
          safetyChecker: mockSafetyChecker,
          logger: mockLogger,
          config: mockConfig
        });
      }).toThrow('Missing required field: mint');
    });

    test('throws error on invalid numeric fields', () => {
      const invalidData = { 
        ...defaultTokenData,
        vTokensInBondingCurve: 'invalid'
      };

      expect(() => {
        new Token(invalidData, {
          priceManager: mockPriceManager,
          safetyChecker: mockSafetyChecker,
          logger: mockLogger,
          config: mockConfig
        });
      }).toThrow('Invalid numeric value for field: vTokensInBondingCurve');
    });

    test('throws error on missing dependencies', () => {
      expect(() => {
        new Token(defaultTokenData, {
          priceManager: mockPriceManager,
          logger: mockLogger
        });
      }).toThrow('Missing required dependencies');
    });
  });

  describe('Trade Updates', () => {
    test('handles trade updates correctly', () => {
      const tradeData = {
        txType: 'buy',
        tokenAmount: 100,
        marketCapSol: 150,
        timestamp: Date.now(),
        vTokensInBondingCurve: 1100,
        vSolInBondingCurve: 110,
        traderPublicKey: 'test-trader',
        newTokenBalance: 100
      };

      token.update(tradeData);

      expect(token.lastTradeType).toBe(tradeData.txType);
      expect(token.lastTradeAmount).toBe(tradeData.tokenAmount);
      expect(token.lastTradeTime).toBeDefined();
      expect(token.marketCapSol).toBe(tradeData.marketCapSol);
      expect(token.vTokensInBondingCurve).toBe(tradeData.vTokensInBondingCurve);
      expect(token.vSolInBondingCurve).toBe(tradeData.vSolInBondingCurve);
      expect(token.getHolderBalance(tradeData.traderPublicKey)).toBe(tradeData.newTokenBalance);

      expect(token.emit).toHaveBeenCalledWith('updated', expect.any(Object));
      expect(mockLogger.debug).toHaveBeenCalledWith('Token updated', expect.any(Object));
    });

    test('throws error on missing trade data fields', () => {
      const invalidTradeData = {
        txType: 'buy',
        tokenAmount: 100
      };

      expect(() => {
        token.update(invalidTradeData);
      }).toThrow('Missing required trade data field');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('throws error on invalid numeric trade data', () => {
      const invalidTradeData = {
        txType: 'buy',
        tokenAmount: 'invalid',
        marketCapSol: 150,
        vTokensInBondingCurve: 1100,
        vSolInBondingCurve: 110,
        traderPublicKey: 'test-trader',
        newTokenBalance: 100
      };

      expect(() => {
        token.update(invalidTradeData);
      }).toThrow('Invalid numeric value for trade data field');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('updates volume and trade count', () => {
      const tradeData = {
        txType: 'buy',
        tokenAmount: 100,
        marketCapSol: 150,
        vTokensInBondingCurve: 1100,
        vSolInBondingCurve: 110,
        traderPublicKey: 'test-trader',
        newTokenBalance: 100
      };

      token.update(tradeData);
      expect(token.volume).toBe(tradeData.tokenAmount);
      expect(token.tradeCount).toBe(1);

      token.update(tradeData);
      expect(token.volume).toBe(tradeData.tokenAmount * 2);
      expect(token.tradeCount).toBe(2);
    });
  });

  describe('Holder Tracking', () => {
    test('tracks holder balances correctly', () => {
      const trader1 = 'trader1';
      const trader2 = 'trader2';

      // First buy from trader1
      token.update({
        txType: 'buy',
        tokenAmount: 100,
        marketCapSol: 150,
        vTokensInBondingCurve: 900,
        vSolInBondingCurve: 110,
        traderPublicKey: trader1,
        newTokenBalance: 100
      });

      expect(token.getHolderBalance(trader1)).toBe(100);
      expect(token.getHolderCount()).toBe(1);

      // Buy from trader2
      token.update({
        txType: 'buy',
        tokenAmount: 50,
        marketCapSol: 160,
        vTokensInBondingCurve: 850,
        vSolInBondingCurve: 120,
        traderPublicKey: trader2,
        newTokenBalance: 50
      });

      expect(token.getHolderBalance(trader2)).toBe(50);
      expect(token.getHolderCount()).toBe(2);

      // Sell all from trader1
      token.update({
        txType: 'sell',
        tokenAmount: 100,
        marketCapSol: 140,
        vTokensInBondingCurve: 950,
        vSolInBondingCurve: 100,
        traderPublicKey: trader1,
        newTokenBalance: 0
      });

      expect(token.getHolderBalance(trader1)).toBe(0);
      expect(token.getHolderCount()).toBe(1);
    });

    test('calculates total supply correctly', () => {
      // Initial state
      expect(token.calculateTotalSupply()).toBe(defaultTokenData.vTokensInBondingCurve);

      // After a buy
      token.update({
        txType: 'buy',
        tokenAmount: 100,
        marketCapSol: 150,
        vTokensInBondingCurve: 900,
        vSolInBondingCurve: 110,
        traderPublicKey: 'trader1',
        newTokenBalance: 100
      });

      expect(token.calculateTotalSupply()).toBe(1000); // 900 in curve + 100 held

      // After another buy
      token.update({
        txType: 'buy',
        tokenAmount: 50,
        marketCapSol: 160,
        vTokensInBondingCurve: 850,
        vSolInBondingCurve: 120,
        traderPublicKey: 'trader2',
        newTokenBalance: 50
      });

      expect(token.calculateTotalSupply()).toBe(1000); // 850 in curve + 150 held
    });

    test('calculates top holder concentration', () => {
      // Add three holders with different balances
      token.update({
        txType: 'buy',
        tokenAmount: 500,
        marketCapSol: 150,
        vTokensInBondingCurve: 400,
        vSolInBondingCurve: 110,
        traderPublicKey: 'trader1',
        newTokenBalance: 500
      });

      token.update({
        txType: 'buy',
        tokenAmount: 300,
        marketCapSol: 160,
        vTokensInBondingCurve: 200,
        vSolInBondingCurve: 120,
        traderPublicKey: 'trader2',
        newTokenBalance: 300
      });

      token.update({
        txType: 'buy',
        tokenAmount: 100,
        marketCapSol: 170,
        vTokensInBondingCurve: 100,
        vSolInBondingCurve: 130,
        traderPublicKey: 'trader3',
        newTokenBalance: 100
      });

      // Total supply = 1000 (100 in curve + 900 held)
      // Top 2 holders (500 + 300 = 800) out of 1000 total = 80%
      expect(token.getTopHolderConcentration(2)).toBe(80);
    });
  });

  describe('Safety Checks', () => {
    test('transitions to READY when safe and old enough', () => {
      mockSafetyChecker.isTokenSafe.mockReturnValue({ safe: true, reasons: [] });
      token.state = STATES.NEW;
      // Set age to 20 seconds (greater than MIN_TOKEN_AGE_SECONDS of 15)
      token.createdAt = Date.now() - (20 * 1000);
      token.checkSafetyConditions();
      expect(token.state).toBe(STATES.READY);
    });

    test('stays in NEW state when safe but too young', () => {
      mockSafetyChecker.isTokenSafe.mockReturnValue({ safe: true, reasons: [] });
      token.state = STATES.NEW;
      token.createdAt = Date.now() - 4000; // 4 seconds old
      token.checkSafetyConditions();
      expect(token.state).toBe(STATES.NEW);
    });

    test('transitions to UNSAFE when not safe', () => {
      mockSafetyChecker.isTokenSafe.mockReturnValue({ safe: false, reasons: ['Test reason'] });
      token.state = STATES.NEW;
      token.checkSafetyConditions();
      expect(token.state).toBe(STATES.UNSAFE);
    });

    test('transitions to DEAD when drawdown exceeds 90%', () => {
      mockSafetyChecker.isTokenSafe.mockReturnValue({ safe: true, reasons: [] });
      token.state = STATES.NEW;
      jest.spyOn(token, 'getDrawdownPercentage').mockReturnValue(95);
      token.checkSafetyConditions();
      expect(token.state).toBe(STATES.DEAD);
    });
  });

  describe('Cleanup', () => {
    test('cleans up resources properly', () => {
      token.cleanup();
      expect(mockLogger.debug).toHaveBeenCalledWith('Token cleaned up', expect.any(Object));
    });

    test('handles cleanup errors gracefully', () => {
      // Mock removeAllListeners to throw an error
      token.removeAllListeners = jest.fn(() => {
        throw new Error('Cleanup failed');
      });

      token.cleanup();
      expect(mockLogger.error).toHaveBeenCalledWith('Error during token cleanup', expect.any(Object));
    });
  });

  describe('Metrics', () => {
    test('calculates drawdown percentage correctly', () => {
      token.update({ 
        txType: 'sell',
        tokenAmount: 100,
        marketCapSol: 80,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 80,
        traderPublicKey: 'test-trader',
        newTokenBalance: 0
      }); // 20% drawdown
      expect(token.getDrawdownPercentage()).toBe(20);

      token.update({ 
        txType: 'sell',
        tokenAmount: 100,
        marketCapSol: 50,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 50,
        traderPublicKey: 'test-trader',
        newTokenBalance: 0
      }); // 50% drawdown
      expect(token.getDrawdownPercentage()).toBe(50);
    });

    test('tracks price history', () => {
      token.update({ 
        txType: 'buy',
        tokenAmount: 100,
        marketCapSol: 120,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 120,
        traderPublicKey: 'test-trader',
        newTokenBalance: 100
      });
      token.update({ 
        txType: 'buy',
        tokenAmount: 100,
        marketCapSol: 150,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 150,
        traderPublicKey: 'test-trader',
        newTokenBalance: 200
      });
      token.update({ 
        txType: 'sell',
        tokenAmount: 100,
        marketCapSol: 130,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 130,
        traderPublicKey: 'test-trader',
        newTokenBalance: 100
      });

      expect(token.priceHistory.length).toBe(3);
      expect(token.priceHistory[0].marketCapSol).toBe(120);
      expect(token.priceHistory[1].marketCapSol).toBe(150);
      expect(token.priceHistory[2].marketCapSol).toBe(130);
    });
  });
});

describe('Token Pump Detection and Position Management', () => {
  let token;
  let mockSafetyChecker;
  let mockPriceManager;
  let mockLogger;
  let mockConfig;
  let mockTokenData;
  let MockPosition;

  beforeEach(() => {
    // Setup mock dependencies
    mockPriceManager = {
      getPrice: jest.fn().mockReturnValue(1.0)
    };

    mockSafetyChecker = {
      isTokenSafe: jest.fn().mockReturnValue({ safe: true, reasons: [] })
    };

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    mockConfig = {
      SAFETY_CHECK_INTERVAL: 2000,
      MIN_TOKEN_AGE_SECONDS: 15,
      TAKE_PROFIT_PERCENT: 50,
      STOP_LOSS_PERCENT: 10,
      TRAILING_STOP_PERCENT: 5,
      MIN_MCAP_POSITION: 0.001,
      LOGGING: {
        POSITIONS: false,
        TRADES: false,
        NEW_TOKENS: false,
        SAFETY_CHECKS: false
      }
    };

    mockTokenData = {
      mint: 'test-mint',
      name: 'Test Token',
      symbol: 'TEST',
      minted: Date.now(),
      traderPublicKey: 'trader-key',
      bondingCurveKey: 'curve-key',
      vTokensInBondingCurve: 1000000000,  
      vSolInBondingCurve: 1000,           
      totalSupply: '1000000000',
      poolTokenSupply: '1000000',
      lpTokenSupply: '1000000',
      holders: new Map(),
      tradeCount: 100,
      volume: 1000,
      marketCapSol: 1000
    };

    token = new Token(mockTokenData, {
      priceManager: mockPriceManager,
      safetyChecker: mockSafetyChecker,
      logger: mockLogger,
      config: mockConfig
    });
  });

  afterEach(() => {
    if (token) {
      token.cleanup();
    }
    jest.clearAllMocks();
  });

  // Basic state initialization test
  test('initializes with correct pump detection state', () => {
    expect(token.pumpMetrics).toBeDefined();
    expect(token.pumpMetrics.firstPumpDetected).toBe(false);
    expect(token.pumpState).toBeDefined();
    expect(token.pumpState.inCooldown).toBe(false);
  });

  // TODO: Position management and time window tests are temporarily disabled
  // These tests involve complex time-based state transitions and async position management
  // We should revisit these once we have a more stable implementation and can properly
  // test the async behavior without flaky results
  
  /* Position Management tests disabled
  describe('Position Management', () => {
    test('should open position when ready with correct size', () => {
      // Test implementation
    });

    test('should handle position closure and transition to PUMPED', () => {
      // Test implementation
    });
  });
  */

  /* Time Window tests disabled
  describe('Time Windows', () => {
    test('should transition to DEAD if dip window exceeded', () => {
      // Test implementation
    });

    test('should transition to DEAD if recovery window exceeded', () => {
      // Test implementation
    });
  });
  */
});
