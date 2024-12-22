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
    test('stays in current state when safe', () => {
      mockSafetyChecker.isTokenSafe.mockReturnValue({ safe: true, reasons: [] });
      token.state = STATES.NEW;
      token.checkSafetyConditions();
      expect(token.state).toBe(STATES.NEW);
    });

    test('transitions to UNSAFE only in READY state when not safe', () => {
      mockSafetyChecker.isTokenSafe.mockReturnValue({ safe: false, reasons: ['Test reason'] });
      
      // Should transition to UNSAFE in READY state
      token.state = STATES.READY;
      token.checkSafetyConditions();
      expect(token.state).toBe(STATES.UNSAFE);

      // Should not transition to UNSAFE in other states
      token.state = STATES.NEW;
      token.checkSafetyConditions();
      expect(token.state).toBe(STATES.NEW);
    });

    test('transitions to DEAD when drawdown exceeds 90% after pump', () => {
      token.pumpMetrics.firstPumpDetected = true;
      token.highestMarketCap = 1000;
      token.marketCapSol = 50; // 95% drawdown
      
      token.checkSafetyConditions();
      expect(token.state).toBe(STATES.DEAD);
    });

    test('does not transition to DEAD when drawdown exceeds 90% without pump', () => {
      token.pumpMetrics.firstPumpDetected = false;
      token.highestMarketCap = 1000;
      token.marketCapSol = 50; // 95% drawdown
      
      token.checkSafetyConditions();
      expect(token.state).not.toBe(STATES.DEAD);
    });
  });

  describe('State Transitions', () => {
    beforeEach(() => {
      // Mock Date.now() for consistent testing
      jest.spyOn(Date, 'now').mockImplementation(() => 1000);
      token.createdAt = 0; // Set creation time to 0 for easier testing
      
      // Mock volume spike and recovery metrics
      jest.spyOn(token, 'getRecentVolumeSpike').mockReturnValue(300); // 300% spike
      jest.spyOn(token, 'getDipVolumeQuality').mockReturnValue(0.8);
      jest.spyOn(token, 'getRecoveryStrength').mockReturnValue(0.9);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('transitions from UNSAFE back to appropriate state on volume spike', () => {
      // Test transition back to PUMPING on initial pump
      token.state = STATES.UNSAFE;
      token.initialPrice = 1;
      token.currentPrice = 1.5; // 50% increase
      token.volume = 2; // Above minimum threshold
      
      token.checkForInitialPump();
      expect(token.state).toBe(STATES.PUMPING);

      // Test transition during dip phase
      token.state = STATES.UNSAFE;
      token.pumpMetrics.firstPumpDetected = true;
      token.pumpMetrics.dipDetected = true;
      token.pumpMetrics.dipPrice = 1;
      token.currentPrice = 1.2; // 20% recovery
      
      token.checkForRecovery();
      expect(token.state).toBe(STATES.RECOVERING);
    });

    test('requires volume threshold for initial pump', () => {
      // Set up pump conditions without volume
      token.initialPrice = 1;
      token.currentPrice = 1.5; // 50% increase
      token.volume = 0.5; // Below minimum threshold
      
      token.checkForInitialPump();
      expect(token.state).toBe(STATES.NEW);

      // Add sufficient volume
      token.volume = 2; // Above minimum threshold
      token.checkForInitialPump();
      expect(token.state).toBe(STATES.PUMPING);
    });

    test('transitions to UNSAFE on timeout conditions', () => {
      // Test initial pump window timeout
      Date.now.mockReturnValue(31000); // Just over INITIAL_PUMP_WINDOW
      token.state = STATES.NEW;
      token.checkStateTransitions();
      expect(token.state).toBe(STATES.UNSAFE);

      // Test dip window timeout
      token = new Token(defaultTokenData, {
        priceManager: mockPriceManager,
        safetyChecker: mockSafetyChecker,
        logger: mockLogger,
        config: mockConfig
      });
      token.state = STATES.DIPPING;
      token.pumpMetrics.firstPumpDetected = true;
      token.pumpMetrics.dipTime = 0;
      Date.now.mockReturnValue(121000); // Just over MAX_DIP_WINDOW
      token.checkStateTransitions();
      expect(token.state).toBe(STATES.UNSAFE);

      // Test recovery window timeout
      token = new Token(defaultTokenData, {
        priceManager: mockPriceManager,
        safetyChecker: mockSafetyChecker,
        logger: mockLogger,
        config: mockConfig
      });
      token.state = STATES.RECOVERING;
      token.pumpMetrics.firstPumpDetected = true;
      token.pumpMetrics.recoveryStartTime = 0;
      Date.now.mockReturnValue(301000); // Just over MAX_RECOVERY_WINDOW
      token.checkStateTransitions();
      expect(token.state).toBe(STATES.UNSAFE);
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

  describe('State Transitions', () => {
    beforeEach(() => {
      // Mock Date.now() for consistent testing
      jest.spyOn(Date, 'now').mockImplementation(() => 1000);
      token.createdAt = 0; // Set creation time to 0 for easier testing
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('only transitions to UNSAFE when failing safety checks in READY state', () => {
      // Set up initial conditions
      token.state = STATES.READY;
      mockSafetyChecker.isTokenSafe.mockReturnValue({ safe: false, reasons: ['Test reason'] });
      
      // Run safety check
      token.checkSafetyConditions();
      expect(token.state).toBe(STATES.UNSAFE);

      // Reset state and run safety check in different state
      token.state = STATES.PUMPING;
      token.checkSafetyConditions();
      expect(token.state).toBe(STATES.PUMPING); // Should not transition to UNSAFE
    });

    test('transitions to DEAD only after pump and significant drawdown', () => {
      // Set up conditions for DEAD state
      token.pumpMetrics.firstPumpDetected = true;
      token.highestMarketCap = 1000;
      token.marketCapSol = 50; // 95% drawdown
      
      token.checkSafetyConditions();
      expect(token.state).toBe(STATES.DEAD);

      // Reset and test without pump
      token = new Token(defaultTokenData, {
        priceManager: mockPriceManager,
        safetyChecker: mockSafetyChecker,
        logger: mockLogger,
        config: mockConfig
      });
      token.highestMarketCap = 1000;
      token.marketCapSol = 50;
      token.pumpMetrics.firstPumpDetected = false;
      
      token.checkSafetyConditions();
      expect(token.state).not.toBe(STATES.DEAD);
    });

    test('transitions from UNSAFE back to appropriate state on volume spike', () => {
      // Mock volume spike detection
      jest.spyOn(token, 'getRecentVolumeSpike').mockReturnValue(300); // 300% spike
      
      // Test transition back to PUMPING on initial pump
      token.state = STATES.UNSAFE;
      token.initialPrice = 1;
      token.currentPrice = 1.5; // 50% increase
      token.checkStateTransitions();
      expect(token.state).toBe(STATES.PUMPING);

      // Test transition during dip phase
      token.state = STATES.UNSAFE;
      token.pumpMetrics.firstPumpDetected = true;
      token.pumpMetrics.dipDetected = true;
      token.pumpMetrics.dipPrice = 1;
      token.currentPrice = 1.2; // 20% recovery
      token.checkStateTransitions();
      expect(token.state).toBe(STATES.RECOVERING);
    });

    test('requires volume threshold for initial pump', () => {
      // Set up pump conditions without volume
      token.initialPrice = 1;
      token.currentPrice = 1.5; // 50% increase
      jest.spyOn(token, 'getRecentVolumeSpike').mockReturnValue(300);
      token.volume = 0.5; // Below minimum threshold
      
      token.checkForInitialPump();
      expect(token.state).toBe(STATES.NEW);

      // Add sufficient volume
      token.volume = 2; // Above minimum threshold
      token.checkForInitialPump();
      expect(token.state).toBe(STATES.PUMPING);
    });

    test('transitions to UNSAFE instead of DEAD on timeout conditions', () => {
      // Test initial pump window timeout
      Date.now.mockReturnValue(31000); // Just over INITIAL_PUMP_WINDOW
      token.state = STATES.NEW;
      token.checkStateTransitions();
      expect(token.state).toBe(STATES.UNSAFE);

      // Test dip window timeout
      token.state = STATES.DIPPING;
      token.pumpMetrics.firstPumpDetected = true;
      token.pumpMetrics.dipTime = 0;
      token.checkStateTransitions();
      expect(token.state).toBe(STATES.UNSAFE);

      // Test recovery window timeout
      token.state = STATES.RECOVERING;
      token.pumpMetrics.firstPumpDetected = true;
      token.pumpMetrics.recoveryStartTime = 0;
      token.checkStateTransitions();
      expect(token.state).toBe(STATES.UNSAFE);
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
