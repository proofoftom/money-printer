const Position = require('../../src/core/position/Position');
const EventEmitter = require('events');

// Mock dependencies
jest.mock('../../src/utils/config', () => ({
  POSITION: {
    STOP_LOSS: 0.2,
    TAKE_PROFIT: 0.5,
    TRAILING_STOP: 0.1
  }
}));

describe('Position', () => {
  let position;
  let mockSimulationManager;
  let mockTraderManager;

  const mockPositionData = {
    mint: 'mock-mint',
    entryPrice: 100,
    size: 1000,
    symbol: 'MOCK',
    traderPublicKey: 'mock-trader'
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock managers
    mockSimulationManager = new EventEmitter();
    mockSimulationManager.handlePositionClose = jest.fn();

    mockTraderManager = new EventEmitter();
    mockTraderManager.handlePositionUpdate = jest.fn();

    // Create position instance
    position = new Position({
      ...mockPositionData,
      simulationManager: mockSimulationManager,
      traderManager: mockTraderManager
    });
  });

  describe('State Management', () => {
    it('should initialize with correct state', () => {
      expect(position.mint).toBe(mockPositionData.mint);
      expect(position.entryPrice).toBe(mockPositionData.entryPrice);
      expect(position.size).toBe(mockPositionData.size);
      expect(position.remainingSize).toBe(1.0);
      expect(position.currentPrice).toBe(mockPositionData.entryPrice);
    });

    it('should update price and track history', () => {
      const newPrice = 120;
      position.updatePrice(newPrice);

      expect(position.currentPrice).toBe(newPrice);
      expect(position.priceHistory).toContain(newPrice);
      expect(position.highestPrice).toBe(newPrice);
    });

    it('should calculate drawdown correctly', () => {
      position.updatePrice(80); // 20% drawdown
      
      expect(position.maxDrawdown).toBe(0.2);
      expect(position.currentDrawdown).toBe(0.2);
    });

    it('should track volume correctly', () => {
      position.updateVolume(100);
      
      expect(position.volume).toBe(100);
      expect(position.volumeHistory.length).toBeGreaterThan(0);
    });
  });

  describe('Event Flow', () => {
    it('should emit position update events', () => {
      const updateHandler = jest.fn();
      position.on('positionUpdate', updateHandler);

      position.updatePrice(120);

      expect(updateHandler).toHaveBeenCalled();
      expect(mockTraderManager.handlePositionUpdate).toHaveBeenCalled();
    });

    it('should emit close events when position is closed', () => {
      const closeHandler = jest.fn();
      position.on('positionClose', closeHandler);

      position.close('take_profit');

      expect(closeHandler).toHaveBeenCalled();
      expect(mockSimulationManager.handlePositionClose).toHaveBeenCalled();
    });

    it('should handle partial closes correctly', () => {
      const updateHandler = jest.fn();
      position.on('positionUpdate', updateHandler);

      position.partialClose(0.5); // Close 50% of position

      expect(position.remainingSize).toBe(0.5);
      expect(updateHandler).toHaveBeenCalled();
    });
  });

  describe('Risk Management', () => {
    it('should trigger stop loss when threshold is reached', () => {
      const closeHandler = jest.fn();
      position.on('positionClose', closeHandler);

      position.updatePrice(75); // 25% drawdown, above stop loss threshold

      expect(closeHandler).toHaveBeenCalledWith(expect.objectContaining({
        reason: 'stop_loss'
      }));
    });

    it('should trigger take profit when threshold is reached', () => {
      const closeHandler = jest.fn();
      position.on('positionClose', closeHandler);

      position.updatePrice(160); // 60% profit, above take profit threshold

      expect(closeHandler).toHaveBeenCalledWith(expect.objectContaining({
        reason: 'take_profit'
      }));
    });

    it('should handle trailing stops correctly', () => {
      const closeHandler = jest.fn();
      position.on('positionClose', closeHandler);

      // Price goes up, setting new high
      position.updatePrice(150);
      // Price drops more than trailing stop percentage
      position.updatePrice(130);

      expect(closeHandler).toHaveBeenCalledWith(expect.objectContaining({
        reason: 'trailing_stop'
      }));
    });
  });

  describe('Performance Metrics', () => {
    it('should calculate profit/loss correctly', () => {
      position.updatePrice(120);
      
      expect(position.currentProfit).toBe(0.2); // 20% profit
      expect(position.profitHistory.length).toBeGreaterThan(1);
    });

    it('should track time-based metrics', () => {
      const timeElapsed = position.getTimeElapsed();
      expect(typeof timeElapsed).toBe('number');
      expect(timeElapsed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Cleanup', () => {
    it('should clean up resources on close', () => {
      const cleanupHandler = jest.fn();
      position.on('cleanup', cleanupHandler);

      position.cleanup();

      expect(cleanupHandler).toHaveBeenCalled();
      expect(position.listenerCount('positionUpdate')).toBe(0);
      expect(position.listenerCount('positionClose')).toBe(0);
    });
  });
});
