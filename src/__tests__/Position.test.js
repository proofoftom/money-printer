const Position = require('../Position');
const ExitStrategies = require('../ExitStrategies');

jest.mock('../ExitStrategies');

describe('Position', () => {
  let position;
  let mockToken;
  let mockPriceManager;
  let mockWallet;
  let mockExitStrategies;

  beforeEach(() => {
    // Mock ExitStrategies
    mockExitStrategies = {
      checkExitSignals: jest.fn()
    };
    ExitStrategies.mockImplementation(() => mockExitStrategies);

    // Mock dependencies
    mockToken = {
      mint: 'test-mint',
      symbol: 'TEST',
      getCurrentPrice: jest.fn().mockReturnValue(100),
      createdAt: Date.now() - 3600000,
      indicators: {
        volumeProfile: new Map([
          ['relativeVolume', 100],
          ['volumeMA', 1000]
        ]),
        priceVelocity: 0,
        volatility: 0.2,
        safetyScore: 80
      },
      ohlcvData: {
        secondly: [{
          timestamp: Date.now(),
          open: 100,
          high: 100,
          low: 100,
          close: 100,
          volume: 1000,
          trades: 10
        }]
      },
      getHighestPrice: jest.fn().mockReturnValue(100),
      getHighestPriceTime: jest.fn().mockReturnValue(Date.now() - 1800000),
      getVolumeSinceCreation: jest.fn().mockReturnValue(10000),
      getTradeCount: jest.fn().mockReturnValue(100),
      getVolumeProfile: jest.fn().mockReturnValue({
        relativeVolume: 1.5,
        volumeMA: 1000
      }),
      getPriceVelocity: jest.fn().mockReturnValue(0.01),
      getVolatility: jest.fn().mockReturnValue(0.2),
      getSafetyScore: jest.fn().mockReturnValue(80),
      getInitialPumpPeak: jest.fn().mockReturnValue({
        price: 120,
        timestamp: Date.now() - 1800000
      })
    };

    mockPriceManager = {
      getCurrentPrice: jest.fn().mockReturnValue(100),
      solToUSD: jest.fn().mockImplementation(sol => sol * 100) // 1 SOL = $100
    };

    mockWallet = {
      getBalance: jest.fn().mockReturnValue(1000),
      canAffordTrade: jest.fn().mockReturnValue(true),
      processTrade: jest.fn().mockResolvedValue(true)
    };

    // Create position instance
    position = new Position(mockToken, mockPriceManager, mockWallet, {});
  });

  describe('State Management', () => {
    test('initializes in PENDING state', () => {
      expect(position.state).toBe(Position.STATES.PENDING);
    });

    test('transitions from PENDING to OPEN', async () => {
      const openSpy = jest.fn();
      position.on('opened', openSpy);

      await position.open(100, 1);
      
      expect(position.state).toBe(Position.STATES.OPEN);
      expect(position.entryPrice).toBe(100);
      expect(position.size).toBe(1);
      expect(openSpy).toHaveBeenCalled();
      expect(position.trades).toHaveLength(1);
      expect(position.trades[0].type).toBe('ENTRY');
    });

    test('transitions from OPEN to CLOSED', async () => {
      const closeSpy = jest.fn();
      position.on('closed', closeSpy);

      await position.open(100, 1);
      await position.close(150, 'TAKE_PROFIT');
      
      expect(position.state).toBe(Position.STATES.CLOSED);
      expect(closeSpy).toHaveBeenCalled();
      expect(position.trades).toHaveLength(2);
      expect(position.trades[1].type).toBe('EXIT');
      expect(position.trades[1].reason).toBe('TAKE_PROFIT');
    });

    test('throws on invalid state transitions', async () => {
      // Should throw when trying to close a PENDING position
      await expect(position.close(100)).rejects.toThrow();
      
      // Open the position
      await position.open(100, 1);
      
      // Should throw when trying to open an already OPEN position
      await expect(position.open(100, 1)).rejects.toThrow();
      
      // Close the position
      await position.close(150, 'TAKE_PROFIT');
      
      // Should throw when trying to close an already CLOSED position
      await expect(position.close(200)).rejects.toThrow();
    });
  });

  describe('Price Updates and P&L Calculations', () => {
    beforeEach(async () => {
      await position.open(100, 1); // Open position at $100 with 1 SOL
    });

    test('should correctly update price and track highest price', async () => {
      await position.updatePrice(120);
      expect(position.currentPrice).toBe(120);
      expect(position.highestPrice).toBe(120);

      await position.updatePrice(110);
      expect(position.currentPrice).toBe(110);
      expect(position.highestPrice).toBe(120); // Should maintain highest price

      await position.updatePrice(130);
      expect(position.currentPrice).toBe(130);
      expect(position.highestPrice).toBe(130);
    });

    test('updates price and metrics', () => {
      const updateSpy = jest.fn();
      position.on('updated', updateSpy);

      position.updatePrice(120);
      
      expect(position.currentPrice).toBe(120);
      expect(position.unrealizedPnLSol).toBe(20); // 20 SOL profit
      expect(position.unrealizedPnLUsd).toBe(2000); // $2000 profit
      expect(position.roiPercentage).toBe(20); // 20% ROI
      expect(updateSpy).toHaveBeenCalled();
    });

    test('tracks highest and lowest prices', () => {
      position.updatePrice(120);
      position.updatePrice(90);
      position.updatePrice(110);

      expect(position.highestPrice).toBe(120);
      expect(position.lowestPrice).toBe(90);
    });

    test('tracks highest unrealized P&L', () => {
      position.updatePrice(120); // +20 SOL
      position.updatePrice(110); // +10 SOL
      
      expect(position.highestUnrealizedPnLSol).toBe(20);
    });

    test('calculates realized P&L on close', async () => {
      position.updatePrice(150);
      await position.close(150, 'TAKE_PROFIT');

      expect(position.realizedPnLSol).toBe(50); // 50 SOL profit
      expect(position.realizedPnLUsd).toBe(5000); // $5000 profit
      expect(position.unrealizedPnLSol).toBe(0);
      expect(position.unrealizedPnLUsd).toBe(0);
    });
  });

  describe('Metrics Calculation', () => {
    beforeEach(async () => {
      await position.open(100, 1); // Open position at 100 SOL with 1 SOL size
    });

    test('updates price extremes correctly', () => {
      position.updatePrice(120); // New high
      expect(position.highestPrice).toBe(120);
      expect(position.lowestPrice).toBe(100);

      position.updatePrice(90);  // New low
      expect(position.highestPrice).toBe(120);
      expect(position.lowestPrice).toBe(90);
    });

    test('calculates unrealized P&L correctly', () => {
      position.updatePrice(120);
      // 1 SOL position, price increased by 20 SOL
      expect(position.unrealizedPnLSol).toBe(20);
      expect(position.unrealizedPnLUsd).toBe(2000); // Using mock conversion rate
    });

    test('tracks highest unrealized P&L', () => {
      position.updatePrice(120); // +20 SOL P&L
      expect(position.highestUnrealizedPnLSol).toBe(20);

      position.updatePrice(110); // +10 SOL P&L
      expect(position.highestUnrealizedPnLSol).toBe(20); // Should keep highest

      position.updatePrice(130); // +30 SOL P&L
      expect(position.highestUnrealizedPnLSol).toBe(30); // Should update to new highest
    });

    test('calculates ROI percentage correctly', () => {
      position.updatePrice(120);
      // Price increased from 100 to 120 = 20% increase
      expect(position.roiPercentage).toBe(20);

      position.updatePrice(90);
      // Price decreased from 100 to 90 = -10% decrease
      expect(position.roiPercentage).toBe(-10);
    });

    test('emits update event with current metrics', () => {
      const updateSpy = jest.fn();
      position.on('updated', updateSpy);

      position.updatePrice(120);
      
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
        currentPrice: 120,
        unrealizedPnLSol: 20,
        roiPercentage: 20
      }));
    });
  });

  describe('Position Metrics', () => {
    test('calculates time in position', async () => {
      const startTime = Date.now();
      await position.open(100, 1);
      
      // Fast forward time
      jest.advanceTimersByTime(3600000); // 1 hour
      
      expect(position.getTimeInPosition()).toBeGreaterThan(0);
    });

    test('calculates average entry price', async () => {
      // A new position should have no entry price
      expect(position.getAverageEntryPrice()).toBe(0);
      
      // After opening, should return the entry price
      await position.open(100, 1);
      expect(position.getAverageEntryPrice()).toBe(100);
    });
  });

  describe('Configuration', () => {
    test('accepts custom settings', () => {
      const customConfig = {
        takeProfitLevel: 30,
        stopLossLevel: 5
      };

      const positionWithConfig = new Position(mockToken, mockPriceManager, mockWallet, customConfig);
      expect(positionWithConfig.config.takeProfitLevel).toBe(30);
      expect(positionWithConfig.config.stopLossLevel).toBe(5);
    });
  });

  describe('Serialization', () => {
    test('serializes to JSON with all required fields', async () => {
      await position.open(100, 1);
      position.updatePrice(120);

      const json = position.toJSON();
      
      expect(json).toHaveProperty('mint', 'test-mint');
      expect(json).toHaveProperty('symbol', 'TEST');
      expect(json).toHaveProperty('state', Position.STATES.OPEN);
      expect(json).toHaveProperty('size', 1);
      expect(json).toHaveProperty('entryPrice', 100);
      expect(json).toHaveProperty('currentPrice', 120);
      expect(json).toHaveProperty('unrealizedPnLSol', 20);
      expect(json).toHaveProperty('trades');
      expect(json).toHaveProperty('config');
    });
  });

  describe('Exit Strategy Integration', () => {
    beforeEach(async () => {
      // Open position
      await position.open(100, 1);
    });

    it('should initialize ExitStrategies with logger', () => {
      expect(position.exitStrategies).toBeDefined();
      expect(position.logger).toBeDefined();
    });

    it('should check exit signals on price update', () => {
      // Setup mock exit signal
      const mockExitSignal = {
        reason: 'STOP_LOSS',
        portion: 1.0
      };
      mockExitStrategies.checkExitSignals.mockReturnValue(mockExitSignal);

      // Update price
      position.updatePrice(90);

      // Verify exit signal check
      expect(mockExitStrategies.checkExitSignals).toHaveBeenCalledWith(position);
    });

    it('should emit exitSignal event when signal is triggered', async () => {
      // Setup mock exit signal
      const mockExitSignal = {
        reason: 'TRAILING_STOP',
        portion: 0.5
      };
      mockExitStrategies.checkExitSignals.mockReturnValue(mockExitSignal);

      // Setup event listener
      const exitSignalHandler = jest.fn();
      position.on('exitSignal', exitSignalHandler);

      // Update price
      position.updatePrice(90);

      // Verify event emission
      expect(exitSignalHandler).toHaveBeenCalledWith(mockExitSignal);
    });

    it('should not emit exitSignal event when no signal is triggered', async () => {
      // Setup mock to return no exit signal
      mockExitStrategies.checkExitSignals.mockReturnValue(null);

      // Setup event listener
      const exitSignalHandler = jest.fn();
      position.on('exitSignal', exitSignalHandler);

      // Update price
      position.updatePrice(110);

      // Verify no event emission
      expect(exitSignalHandler).not.toHaveBeenCalled();
    });

    it('should handle error in exit signal check gracefully', async () => {
      // Setup mock to throw error
      mockExitStrategies.checkExitSignals.mockImplementation(() => {
        throw new Error('Test error');
      });

      // Setup event listener
      const exitSignalHandler = jest.fn();
      position.on('exitSignal', exitSignalHandler);

      // Update price (should not throw)
      expect(() => position.updatePrice(110)).not.toThrow();

      // Verify no event emission
      expect(exitSignalHandler).not.toHaveBeenCalled();
    });

    it('should update highest price for trailing stop calculation', async () => {
      // Update price to new high
      position.updatePrice(120);
      expect(position.highestPrice).toBe(120);

      // Update price to lower value
      position.updatePrice(110);
      expect(position.highestPrice).toBe(120); // Should maintain highest price
    });

    it('should not check exit signals when position is not open', async () => {
      // Close position
      await position.close(100);

      // Setup event listener
      const exitSignalHandler = jest.fn();
      position.on('exitSignal', exitSignalHandler);

      // Update price
      position.updatePrice(90);

      // Verify no exit signal check
      expect(mockExitStrategies.checkExitSignals).not.toHaveBeenCalled();
      expect(exitSignalHandler).not.toHaveBeenCalled();
    });

    it('should maintain proper price tracking for exit conditions', async () => {
      // Initial state
      expect(position.entryPrice).toBe(100);
      expect(position.currentPrice).toBe(100);
      expect(position.highestPrice).toBe(100);

      // Update to higher price
      position.updatePrice(120);
      expect(position.currentPrice).toBe(120);
      expect(position.highestPrice).toBe(120);

      // Update to lower price
      position.updatePrice(110);
      expect(position.currentPrice).toBe(110);
      expect(position.highestPrice).toBe(120); // Should maintain highest
    });

    it('should calculate price velocity correctly', async () => {
      // Mock time for consistent testing
      jest.useFakeTimers();
      const now = Date.now();

      // Update price after 1 second
      jest.advanceTimersByTime(1000);
      position.updatePrice(110); // 10% increase in 1 second

      // Verify price velocity calculation
      expect(position.priceVelocity).toBeCloseTo(0.1); // 10% per second

      // Cleanup
      jest.useRealTimers();
    });
  });
});
