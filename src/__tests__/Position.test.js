const Position = require('../Position');

describe('Position', () => {
  let position;
  let mockToken;
  let mockPriceManager;

  beforeEach(() => {
    mockToken = {
      mint: 'test-mint',
      symbol: 'TEST',
      getCurrentPrice: jest.fn(() => 100)
    };

    mockPriceManager = {
      solToUSD: jest.fn(sol => sol * 100) // 1 SOL = $100
    };

    position = new Position(mockToken, mockPriceManager);
  });

  describe('State Management', () => {
    test('initializes in PENDING state', () => {
      expect(position.state).toBe(Position.STATES.PENDING);
    });

    test('transitions from PENDING to OPEN', () => {
      const openSpy = jest.fn();
      position.on('opened', openSpy);

      position.open(100, 1);
      
      expect(position.state).toBe(Position.STATES.OPEN);
      expect(position.entryPrice).toBe(100);
      expect(position.size).toBe(1);
      expect(openSpy).toHaveBeenCalled();
      expect(position.trades).toHaveLength(1);
      expect(position.trades[0].type).toBe('ENTRY');
    });

    test('transitions from OPEN to CLOSED', () => {
      const closeSpy = jest.fn();
      position.on('closed', closeSpy);

      position.open(100, 1);
      position.close(150, 'TAKE_PROFIT');
      
      expect(position.state).toBe(Position.STATES.CLOSED);
      expect(closeSpy).toHaveBeenCalled();
      expect(position.trades).toHaveLength(2);
      expect(position.trades[1].type).toBe('EXIT');
      expect(position.trades[1].reason).toBe('TAKE_PROFIT');
    });

    test('throws on invalid state transitions', () => {
      expect(() => position.close(100)).toThrow();
      
      position.open(100, 1);
      expect(() => position.open(100, 1)).toThrow();
      
      position.close(150, 'TAKE_PROFIT');
      expect(() => position.close(200)).toThrow();
    });
  });

  describe('Price Updates and P&L Calculations', () => {
    beforeEach(() => {
      position.open(100, 1); // Open position at $100 with 1 SOL
    });

    test('should correctly update price and track highest price', () => {
      const position = new Position(mockToken, mockPriceManager);
      position.open(100, 1);

      position.updatePrice(120);
      expect(position.currentPrice).toBe(120);
      expect(position.highestPrice).toBe(120);

      position.updatePrice(110);
      expect(position.currentPrice).toBe(110);
      expect(position.highestPrice).toBe(120); // Should maintain highest price

      position.updatePrice(130);
      expect(position.currentPrice).toBe(130);
      expect(position.highestPrice).toBe(130);
    });

    test('updates price and metrics', () => {
      const updateSpy = jest.fn();
      position.on('priceUpdated', updateSpy);

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

    test('calculates realized P&L on close', () => {
      position.updatePrice(150);
      position.close(150, 'TAKE_PROFIT');

      expect(position.realizedPnLSol).toBe(50); // 50 SOL profit
      expect(position.realizedPnLUsd).toBe(5000); // $5000 profit
      expect(position.unrealizedPnLSol).toBe(0);
      expect(position.unrealizedPnLUsd).toBe(0);
    });
  });

  describe('Metrics Calculation', () => {
    beforeEach(() => {
      position.open(100, 1); // Open position at 100 SOL with 1 SOL size
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
    test('calculates time in position', () => {
      const startTime = Date.now();
      position.open(100, 1);
      
      // Fast forward time
      jest.advanceTimersByTime(3600000); // 1 hour
      
      expect(position.getTimeInPosition()).toBeGreaterThan(0);
    });

    test('calculates average entry price', () => {
      expect(position.getAverageEntryPrice()).toBe(0); // No entries yet
      
      position.open(100, 1);
      expect(position.getAverageEntryPrice()).toBe(100);
    });
  });

  describe('Configuration', () => {
    test('accepts custom settings', () => {
      const customConfig = {
        takeProfitLevel: 30,
        stopLossLevel: 5
      };

      const positionWithConfig = new Position(mockToken, mockPriceManager, customConfig);
      expect(positionWithConfig.config.takeProfitLevel).toBe(30);
      expect(positionWithConfig.config.stopLossLevel).toBe(5);
    });
  });

  describe('Serialization', () => {
    test('serializes to JSON with all required fields', () => {
      position.open(100, 1);
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
});
