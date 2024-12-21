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
      position.open(100, 1);
      
      expect(position.state).toBe(Position.STATES.OPEN);
      expect(position.entryPrice).toBe(100);
      expect(position.size).toBe(1);
      expect(position.trades).toHaveLength(1);
      expect(position.trades[0].type).toBe('ENTRY');
    });

    test('transitions from OPEN to CLOSED', () => {
      position.open(100, 1);
      position.close(150, 'TAKE_PROFIT');
      
      expect(position.state).toBe(Position.STATES.CLOSED);
      expect(position.trades).toHaveLength(2);
      expect(position.trades[1].type).toBe('EXIT');
    });

    test('throws on invalid state transitions', () => {
      expect(() => position.close(100)).toThrow();
      position.open(100, 1);
      expect(() => position.open(100, 1)).toThrow();
    });
  });

  describe('Price Updates and P&L Calculations', () => {
    beforeEach(() => {
      position.open(100, 1); // Open position at 100 SOL with 1 SOL size
    });

    test('updates price and metrics', () => {
      position.updatePrice(120);
      
      expect(position.currentPrice).toBe(120);
      expect(position.unrealizedPnLSol).toBe(20); // 20 SOL profit
      expect(position.unrealizedPnLUsd).toBe(2000); // $2000 profit
      expect(position.roiPercentage).toBe(20); // 20% ROI
    });

    test('tracks highest and lowest prices', () => {
      position.updatePrice(120); // High
      position.updatePrice(90);  // Low
      position.updatePrice(110); // Middle
      
      expect(position.highestPrice).toBe(120);
      expect(position.lowestPrice).toBe(90);
    });

    test('tracks highest unrealized P&L', () => {
      position.updatePrice(120); // +20 SOL
      position.updatePrice(110); // +10 SOL
      
      expect(position.highestUnrealizedPnLSol).toBe(20);
    });

    test('calculates realized P&L on close', () => {
      // Close directly at 150 without updating price first to avoid auto-close from take profit
      position.close(150, 'TAKE_PROFIT');

      expect(position.realizedPnLSol).toBe(50); // 50 SOL profit
      expect(position.realizedPnLUsd).toBe(5000); // $5000 profit
      expect(position.unrealizedPnLSol).toBe(0);
      expect(position.unrealizedPnLUsd).toBe(0);
    });
  });

  describe('Position Metrics', () => {
    test('calculates average entry price', () => {
      position.open(100, 1);
      expect(position.getAverageEntryPrice()).toBe(100);
    });
  });

  describe('Configuration', () => {
    test('accepts custom settings', () => {
      const customConfig = {
        takeProfitLevel: 30,
        stopLossLevel: 5,
        TRANSACTION_FEES: {
          BUY: 0.1,
          SELL: 0.2
        }
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
      expect(json).toHaveProperty('state', 'OPEN');
      expect(json).toHaveProperty('unrealizedPnLSol', 20);
      expect(json).toHaveProperty('trades');
      expect(json).toHaveProperty('config');
    });
  });
});
