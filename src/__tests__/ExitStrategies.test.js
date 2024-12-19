const ExitStrategies = require('../ExitStrategies');
const Position = require('../Position');

describe('ExitStrategies', () => {
  let exitStrategies;
  let mockToken;
  let mockPriceManager;
  let position;

  beforeEach(() => {
    exitStrategies = new ExitStrategies();
    mockToken = {
      mint: 'test-mint',
      symbol: 'TEST',
      getCurrentPrice: jest.fn(() => 100)
    };
    mockPriceManager = {
      solToUSD: jest.fn(sol => sol * 100)
    };
  });

  describe('Default Configuration', () => {
    beforeEach(() => {
      position = new Position(mockToken, mockPriceManager, {
        takeProfitLevel: 100, // 100% for testing
        stopLossLevel: 10     // 10% for testing
      });
      position.open(100, 1);
    });

    test('should use default full exit portions', () => {
      // Stop Loss
      position.updatePrice(89);
      expect(exitStrategies.checkExitSignals(position)).toEqual({
        reason: 'STOP_LOSS',
        portion: 1.0
      });

      // Reset position
      position = new Position(mockToken, mockPriceManager, {
        takeProfitLevel: 100,
        stopLossLevel: 10
      });
      position.open(100, 1);

      // Take Profit
      position.updatePrice(201);
      expect(exitStrategies.checkExitSignals(position)).toEqual({
        reason: 'TAKE_PROFIT',
        portion: 1.0
      });

      // Reset position
      position = new Position(mockToken, mockPriceManager, {
        takeProfitLevel: 100,
        stopLossLevel: 10
      });
      position.open(100, 1);

      // Trailing Stop
      position.updatePrice(150);
      position.updatePrice(119);
      expect(exitStrategies.checkExitSignals(position)).toEqual({
        reason: 'TRAILING_STOP',
        portion: 1.0
      });
    });
  });

  describe('Custom Configuration', () => {
    beforeEach(() => {
      position = new Position(mockToken, mockPriceManager, {
        takeProfitLevel: 100,
        stopLossLevel: 10,
        stopLossPortion: 0.5,
        takeProfitPortion: 0.3,
        trailingStopLevel: 15,    // 15% drop instead of default 20%
        trailingStopPortion: 0.7
      });
      position.open(100, 1);
    });

    test('should respect custom exit portions', () => {
      // Stop Loss with 50% exit
      position.updatePrice(89);
      expect(exitStrategies.checkExitSignals(position)).toEqual({
        reason: 'STOP_LOSS',
        portion: 0.5
      });

      // Reset position
      position = new Position(mockToken, mockPriceManager, {
        takeProfitLevel: 100,
        stopLossLevel: 10,
        stopLossPortion: 0.5,
        takeProfitPortion: 0.3,
        trailingStopLevel: 15,
        trailingStopPortion: 0.7
      });
      position.open(100, 1);

      // Take Profit with 30% exit
      position.updatePrice(201);
      expect(exitStrategies.checkExitSignals(position)).toEqual({
        reason: 'TAKE_PROFIT',
        portion: 0.3
      });

      // Reset position
      position = new Position(mockToken, mockPriceManager, {
        takeProfitLevel: 100,
        stopLossLevel: 10,
        stopLossPortion: 0.5,
        takeProfitPortion: 0.3,
        trailingStopLevel: 15,
        trailingStopPortion: 0.7
      });
      position.open(100, 1);

      // Trailing Stop with custom 15% level and 70% exit
      position.updatePrice(150);
      position.updatePrice(128.5); // Just above 15% drop (14.33%)
      expect(exitStrategies.checkExitSignals(position)).toBeNull();

      position.updatePrice(127); // Just below 15% drop (15.33%)
      expect(exitStrategies.checkExitSignals(position)).toEqual({
        reason: 'TRAILING_STOP',
        portion: 0.7
      });
    });
  });

  test('should not process signals for closed positions', () => {
    position = new Position(mockToken, mockPriceManager);
    position.open(100, 1);
    position.updatePrice(85);
    position.close(85, 'MANUAL');
    const signal = exitStrategies.checkExitSignals(position);
    expect(signal).toBeNull();
  });
});
