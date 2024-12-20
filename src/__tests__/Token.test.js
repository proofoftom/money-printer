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
      // Set initial token supply
      token.vTokensInBondingCurve = 100; // 100 tokens in curve

      // Add three holders with different balances
      token.updateHolderBalance('trader1', 500);
      token.updateHolderBalance('trader2', 300);
      token.updateHolderBalance('trader3', 100);

      // Debug logging
      const totalSupply = token.vTokensInBondingCurve + token.totalSupplyOutsideCurve;
      console.log('Total supply:', totalSupply);
      console.log('Tokens in curve:', token.vTokensInBondingCurve);
      console.log('Total supply outside curve:', token.totalSupplyOutsideCurve);
      console.log('Holders:', Array.from(token.holders.entries()));
      console.log('Top 2 holdings:', Array.from(token.holders.values())
        .sort((a, b) => b - a)
        .slice(0, 2)
        .reduce((a, b) => a + b, 0));

      // Total supply = 1000 (100 in curve + 900 outside)
      // Top 2 holders (500 + 300 = 800) out of 1000 total = 80%
      expect(token.getTopHolderConcentration(2)).toBe(80);
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
        vSolInBondingCurve: 10,
        traderPublicKey: 'test-trader',
        newTokenBalance: 0
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

  describe('Token Lifecycle', () => {
    beforeEach(() => {
      // Initialize with OHLCV data
      token.ohlcvData = {
        secondly: [{
          timestamp: Date.now() - 30000,
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 100
        }]
      };
      
      // Initialize volume profile indicator
      token.indicators = {
        volumeProfile: {
          get: jest.fn().mockReturnValue(3) // Mock 3x relative volume
        }
      };

      token.currentPrice = 1;
      token.volume = 100;
      token.tradeCount = 1;
    });

    describe('State Transitions', () => {
      test('transitions through pump and dip cycle', () => {
        expect(token.state).toBe(STATES.NEW);

        // Simulate pump
        token.currentPrice = 1.3; // 30% increase
        expect(token.detectPump()).toBe(true);
        token.setState(STATES.PUMPING, 'Pump detected');
        expect(token.state).toBe(STATES.PUMPING);

        // Simulate dip
        token.currentPrice = 0.9; // 30% decrease from pump
        token.highestPrice = 1.3;
        expect(token.detectDip()).toBe(true);
        token.setState(STATES.DIPPING, 'Dip detected');
        expect(token.state).toBe(STATES.DIPPING);

        // Simulate recovery and attempt position
        token.currentPrice = 1.1; // 22% recovery from dip
        token.dipPrice = 0.9;
        
        const signalSpy = jest.spyOn(token, 'emit');
        expect(token.detectRecovery()).toBe(true);
        expect(signalSpy).toHaveBeenCalledWith('recoveryDetected', expect.any(Object));
      });

      test('maintains state history', () => {
        token.setState(STATES.PUMPING, 'Test transition');
        expect(token.stateHistory).toHaveLength(1);
        expect(token.stateHistory[0]).toMatchObject({
          from: STATES.NEW,
          to: STATES.PUMPING,
          reason: 'Test transition'
        });
      });
    });

    describe('Safety Checks', () => {
      test('respects different TTLs for UNSAFE state', () => {
        // Normal state TTL
        token.state = STATES.DIPPING;
        token.lastSafetyCheck.timestamp = Date.now() - 6000; // 6s ago
        expect(token.requiresSafetyCheck()).toBe(true);
        
        // UNSAFE state TTL
        token.state = STATES.UNSAFE;
        token.lastSafetyCheck.timestamp = Date.now() - 6000; // 6s ago
        expect(token.requiresSafetyCheck()).toBe(false); // Should still be valid
        
        token.lastSafetyCheck.timestamp = Date.now() - 11000; // 11s ago
        expect(token.requiresSafetyCheck()).toBe(true); // Should require check
      });

      test('prevents excessive recovery in UNSAFE state', async () => {
        token.state = STATES.UNSAFE;
        token.dipPrice = 1.0;
        token.currentPrice = 1.35; // 35% recovery
        
        expect(await token.detectRecovery()).toBe(false);
      });
    });

    describe('Maturity Tracking', () => {
      test('updates mature flag after completing cycles', () => {
        expect(token.isMature).toBe(false);
        
        token.completeCycle();
        expect(token.isMature).toBe(false);
        
        token.completeCycle();
        expect(token.isMature).toBe(true);
      });

      test('maintains cycle quality scores', () => {
        token.completeCycle();
        expect(token.cycleQualityScores).toHaveLength(1);
        expect(token.cycleQualityScores[0]).toMatchObject({
          cycle: 1,
          score: expect.any(Number),
          timestamp: expect.any(Number)
        });
      });
    });

    describe('Recovery Detection', () => {
      test('emits recovery event for position attempt', async () => {
        token.state = STATES.DIPPING;
        token.dipPrice = 1.0;
        token.currentPrice = 1.15; // 15% recovery
        
        const eventSpy = jest.spyOn(token, 'emit');
        await token.detectRecovery();
        
        expect(eventSpy).toHaveBeenCalledWith('recoveryDetected', expect.objectContaining({
          token: token,
          recoveryPercent: expect.any(Number),
          price: expect.any(Number)
        }));
      });

      test('includes volume and candle metrics in trading signal', async () => {
        token.state = STATES.DIPPING;
        token.dipPrice = 1.0;
        token.currentPrice = 1.15;
        
        const eventSpy = jest.spyOn(token, 'emit');
        await token.detectRecovery();
        
        expect(eventSpy).toHaveBeenCalledWith('tradingSignal', expect.objectContaining({
          type: 'recovery_confirmed',
          metrics: expect.objectContaining({
            volumeSpike: expect.any(Boolean),
            candleCount: expect.any(Number),
            recoveryPercent: expect.any(Number)
          })
        }));
      });
    });
  });

  describe('Attempt Tracking', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('records attempt details during safety checks', async () => {
      const eventSpy = jest.spyOn(token, 'emit');
      await token.checkSafetyConditions();
      
      expect(token.attempts).toHaveLength(1);
      expect(token.attempts[0]).toMatchObject({
        timestamp: expect.any(Number),
        state: token.state,
        price: token.currentPrice,
        volume: token.volume,
        cycle: token.pumpCycle,
        metrics: expect.any(Object)
      });
      
      expect(eventSpy).toHaveBeenCalledWith('attemptRecorded', expect.any(Object));
    });

    test('tracks failed attempts for missed opportunities', async () => {
      token.safetyChecker.isTokenSafe.mockResolvedValueOnce({ 
        safe: false, 
        reasons: ['Test failure'] 
      });
      
      await token.checkSafetyConditions();
      expect(token.activeTracking.size).toBe(1);
      
      // Simulate price increase
      token.currentPrice = token.currentPrice * 2.5; // 150% increase
      token.updatePriceTracking();
      
      const trackingEntry = Array.from(token.activeTracking.values())[0];
      expect(trackingEntry.maxGainPercent).toBeGreaterThan(100);
      expect(trackingEntry.significantGainReported).toBe(true);
    });

    test('adjusts cooldown periods based on failure patterns', async () => {
      const initialUnsafeCooldown = token.config.UNSAFE_PUMP_COOLDOWN;
      const initialSafetyTTL = token.config.SAFETY_CHECK_TTL;
      
      // Simulate multiple failures with same reason
      token.safetyChecker.isTokenSafe.mockResolvedValue({ 
        safe: false, 
        reasons: ['Consistent failure'] 
      });
      
      for (let i = 0; i < 6; i++) {
        await token.checkSafetyConditions();
      }
      
      expect(token.config.UNSAFE_PUMP_COOLDOWN).toBeGreaterThan(initialUnsafeCooldown);
      expect(token.config.SAFETY_CHECK_TTL).toBeGreaterThan(initialSafetyTTL);
    });

    test('respects unsafe pump cooldown', async () => {
      token.state = STATES.UNSAFE;
      token.unsafePumpCooldown = Date.now();
      
      const result = await token.checkSafetyConditions();
      expect(result.safe).toBe(false);
      expect(result.reasons).toContain('Unsafe pump cooldown active');
    });
  });

  describe('Opportunity Analysis', () => {
    test('records successful position outcomes', () => {
      const position = {
        entryPrice: 1.0,
        exitPrice: 1.5,
        entryTime: Date.now() - 1000,
        exitTime: Date.now(),
        realizedPnl: 0.5
      };
      
      const eventSpy = jest.spyOn(token, 'emit');
      token.recordPositionOutcome(position);
      
      expect(token.outcomes).toHaveLength(1);
      expect(token.outcomes[0]).toMatchObject({
        entryPrice: position.entryPrice,
        exitPrice: position.exitPrice,
        pnl: position.realizedPnl,
        attempts: expect.any(Array)
      });
      
      expect(eventSpy).toHaveBeenCalledWith('outcomeRecorded', expect.any(Object));
      expect(eventSpy).toHaveBeenCalledWith('analysisLogEntry', expect.objectContaining({
        type: 'successful_trades'
      }));
    });

    test('tracks missed opportunities over time', async () => {
      // Setup tracking
      const attempt = {
        timestamp: Date.now(),
        price: 1.0,
        state: STATES.UNSAFE,
        result: { safe: false, reasons: ['Test'] }
      };
      
      token.trackFailedAttempt(attempt);
      
      // Simulate price movement
      token.currentPrice = 2.1; // 110% increase
      token.updatePriceTracking();
      
      // Fast-forward to end of tracking period
      jest.advanceTimersByTime(token.config.MISSED_OPPORTUNITY_TRACKING_PERIOD);
      
      expect(token.missedOpportunities).toHaveLength(1);
      expect(token.missedOpportunities[0]).toMatchObject({
        maxGainPercent: expect.any(Number),
        timeToMaxGain: expect.any(Number),
        attempt: expect.objectContaining({
          price: 1.0
        })
      });
    });

    test('emits events for significant missed opportunities', async () => {
      const eventSpy = jest.spyOn(token, 'emit');
      
      // Setup tracking
      const attempt = {
        timestamp: Date.now(),
        price: 1.0,
        state: STATES.UNSAFE,
        result: { safe: false, reasons: ['Test'] }
      };
      
      token.trackFailedAttempt(attempt);
      
      // Simulate significant price increase
      token.currentPrice = 2.5; // 150% increase
      token.updatePriceTracking();
      
      expect(eventSpy).toHaveBeenCalledWith('significantMissedOpportunity', expect.objectContaining({
        mint: token.mint,
        gainPercent: expect.any(Number)
      }));
    });

    test('categorizes missed opportunities by failure reason', async () => {
      // Simulate failures with different reasons
      const reasons = ['liquidity', 'volume', 'price'];
      
      for (const reason of reasons) {
        token.safetyChecker.isTokenSafe.mockResolvedValueOnce({ 
          safe: false, 
          reasons: [reason] 
        });
        
        await token.checkSafetyConditions();
        token.currentPrice *= 2; // 100% increase each time
        token.updatePriceTracking();
      }
      
      // Check failure patterns
      for (const reason of reasons) {
        expect(token.failurePatterns.has(reason)).toBe(true);
        expect(token.failurePatterns.get(reason)).toMatchObject({
          count: 1,
          lastOccurrence: expect.any(Number)
        });
      }
    });
  });
});
