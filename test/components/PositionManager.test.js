const PositionManager = require('../../src/core/position/PositionManager');
const Position = require('../../src/core/position/Position');
const EventEmitter = require('events');

// Mock dependencies
jest.mock('../../src/core/position/PositionStateManager', () => {
  return jest.fn().mockImplementation(() => ({
    getPosition: jest.fn().mockImplementation((mint) => null),
    getAllPositions: jest.fn().mockReturnValue([]),
    on: jest.fn()
  }));
});

jest.mock('../../src/core/position/ExitStrategies');
jest.mock('../../utils/TransactionSimulator');
jest.mock('../../utils/config', () => ({
  TESTING: {
    POSITION_MANAGER: {
      CLEAR_ON_STARTUP: false
    }
  },
  POSITION: {
    MAX_POSITIONS: 3,
    PRICE_IMPACT_THRESHOLD: 0.05
  },
  EXIT_STRATEGIES: {}
}));

// Simple mock for Position
jest.mock('../../src/core/position/Position', () => {
  return jest.fn().mockImplementation((data) => {
    const calculatePnL = jest.fn().mockReturnValue(0);
    return {
      mint: data.mint,
      entryPrice: data.entryPrice,
      size: data.size,
      remainingSize: data.size,
      currentPrice: data.entryPrice,
      currentValue: data.entryPrice * data.size,
      on: jest.fn(),
      calculatePnL,
      updatePrice: jest.fn(),
      open: jest.fn().mockResolvedValue(true),
      close: jest.fn().mockResolvedValue(true),
      update: jest.fn().mockImplementation((price) => {
        this.currentPrice = price;
        calculatePnL();
      })
    };
  });
});

describe('PositionManager', () => {
  let positionManager;
  let mockPriceManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPriceManager = new EventEmitter();
    mockPriceManager.solToUSD = jest.fn().mockReturnValue(100);
    
    positionManager = new PositionManager(
      { address: 'mock-wallet' }, // Simple wallet mock
      mockPriceManager,
      new EventEmitter() // Simple trader manager mock
    );
  });

  afterEach(() => {
    // Clean up interval
    if (positionManager._validateInterval) {
      clearInterval(positionManager._validateInterval);
    }
  });

  describe('Core Position Management', () => {
    it('should open and manage positions', async () => {
      // Open a position
      const positionData = {
        mint: 'test-mint',
        entryPrice: 100,
        size: 1.0
      };

      const position = await positionManager.openPosition(positionData);
      expect(position).toBeTruthy();
      expect(position.open).toHaveBeenCalled();
      expect(positionManager.positions.get('test-mint')).toBe(position);

      // Update position
      position.currentPrice = 110;
      positionManager.updatePosition('test-mint', 110);
      expect(position.update).toHaveBeenCalledWith(110, null, null);

      // Close position
      const closed = await positionManager.closePosition('test-mint');
      expect(closed).toBe(true);
      expect(positionManager.positions.has('test-mint')).toBe(false);
    });

    it('should enforce max positions limit', async () => {
      // Fill up positions
      for (let i = 0; i < positionManager.maxPositions; i++) {
        await positionManager.openPosition({
          mint: `test-mint-${i}`,
          entryPrice: 100,
          size: 1.0
        });
      }

      // Try to open one more
      const result = await positionManager.openPosition({
        mint: 'one-too-many',
        entryPrice: 100,
        size: 1.0
      });
      
      expect(result).toBeNull();
      expect(positionManager.positions.size).toBe(positionManager.maxPositions);
    });

    it('should calculate position profit/loss correctly', async () => {
      // Open a position
      const position = await positionManager.openPosition({
        mint: 'test-mint',
        entryPrice: 100,
        size: 1.0
      });

      // Update price to simulate profit
      position.currentPrice = 120;
      await positionManager.updatePosition('test-mint', 120);
      expect(position.calculatePnL).toHaveBeenCalled();

      // Close position
      await positionManager.closePosition('test-mint');
      expect(positionManager.positions.has('test-mint')).toBe(false);
    });
  });
});
