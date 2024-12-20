const EventEmitter = require('events');
const { Token, STATES } = require('../Token');

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
    // Clean up intervals
    token.cleanup();
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
        vSolInBondingCurve: 110
      };

      token.update(tradeData);

      expect(token.lastTradeType).toBe(tradeData.txType);
      expect(token.lastTradeAmount).toBe(tradeData.tokenAmount);
      expect(token.lastTradeTime).toBeDefined();
      expect(token.marketCapSol).toBe(tradeData.marketCapSol);
      expect(token.vTokensInBondingCurve).toBe(tradeData.vTokensInBondingCurve);
      expect(token.vSolInBondingCurve).toBe(tradeData.vSolInBondingCurve);

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
        vSolInBondingCurve: 110
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
        vSolInBondingCurve: 110
      };

      token.update(tradeData);
      expect(token.volume).toBe(tradeData.tokenAmount);
      expect(token.tradeCount).toBe(1);

      token.update(tradeData);
      expect(token.volume).toBe(tradeData.tokenAmount * 2);
      expect(token.tradeCount).toBe(2);
    });
  });

  describe('Safety Checks', () => {
    test('transitions to READY when safe', () => {
      mockSafetyChecker.isTokenSafe.mockReturnValue({ safe: true, reasons: [] });
      token.state = STATES.NEW; // Ensure we start in NEW state
      token.checkSafetyConditions();
      
      expect(token.state).toBe(STATES.READY);
      expect(token.emit).toHaveBeenCalledWith('stateChanged', expect.any(Object));
      expect(token.emit).toHaveBeenCalledWith('readyForPosition', expect.any(Object));
      expect(mockLogger.info).toHaveBeenCalledWith('Token state changed', expect.any(Object));
    });

    test('transitions to UNSAFE when not safe', () => {
      const reasons = ['Market cap too low'];
      mockSafetyChecker.isTokenSafe.mockReturnValue({ 
        safe: false, 
        reasons 
      });
      
      token.state = STATES.NEW; // Ensure we start in NEW state
      token.checkSafetyConditions();
      expect(token.state).toBe(STATES.UNSAFE);
      expect(token.emit).toHaveBeenCalledWith('stateChanged', expect.objectContaining({
        reasons
      }));
      expect(mockLogger.info).toHaveBeenCalledWith('Token state changed', expect.any(Object));
    });

    test('transitions to DEAD on high drawdown', () => {
      token.update({ 
        txType: 'sell',
        tokenAmount: 100,
        marketCapSol: 10,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 10
      }); // 90% drawdown
      token.checkSafetyConditions();
      
      expect(token.state).toBe(STATES.DEAD);
      expect(token.emit).toHaveBeenCalledWith('stateChanged', expect.any(Object));
      expect(mockLogger.info).toHaveBeenCalledWith('Token state changed', expect.any(Object));
    });

    test('handles safety checker errors gracefully', () => {
      mockSafetyChecker.isTokenSafe.mockImplementation(() => {
        throw new Error('Safety check failed');
      });

      token.checkSafetyConditions();
      expect(mockLogger.error).toHaveBeenCalledWith('Error checking safety conditions', expect.any(Object));
      // State should remain unchanged
      expect(token.state).toBe(STATES.NEW);
    });
  });

  describe('Cleanup', () => {
    test('cleans up resources properly', () => {
      token.cleanup();
      expect(mockLogger.debug).toHaveBeenCalledWith('Token cleaned up', expect.any(Object));
    });

    test('handles cleanup errors gracefully', () => {
      jest.spyOn(token, 'removeAllListeners').mockImplementation(() => {
        throw new Error('Cleanup failed');
      });

      token.cleanup();
      expect(mockLogger.error).toHaveBeenCalledWith('Error cleaning up token', expect.any(Object));
    });
  });

  describe('Metrics', () => {
    test('calculates drawdown percentage correctly', () => {
      token.update({ 
        txType: 'sell',
        tokenAmount: 100,
        marketCapSol: 80,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 80
      }); // 20% drawdown
      expect(token.getDrawdownPercentage()).toBe(20);

      token.update({ 
        txType: 'sell',
        tokenAmount: 100,
        marketCapSol: 50,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 50
      }); // 50% drawdown
      expect(token.getDrawdownPercentage()).toBe(50);
    });

    test('tracks price history', () => {
      token.update({ 
        txType: 'buy',
        tokenAmount: 100,
        marketCapSol: 120,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 120
      });
      token.update({ 
        txType: 'buy',
        tokenAmount: 100,
        marketCapSol: 150,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 150
      });
      token.update({ 
        txType: 'sell',
        tokenAmount: 100,
        marketCapSol: 130,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 130
      });

      expect(token.priceHistory.length).toBe(3);
      expect(token.priceHistory[0].marketCapSol).toBe(120);
      expect(token.priceHistory[1].marketCapSol).toBe(150);
      expect(token.priceHistory[2].marketCapSol).toBe(130);
    });
  });
});
