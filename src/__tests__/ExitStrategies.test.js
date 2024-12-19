const ExitStrategies = require('../ExitStrategies');

describe('ExitStrategies', () => {
  let exitStrategies;
  let mockPosition;
  let mockToken;
  
  beforeEach(() => {
    exitStrategies = new ExitStrategies();
    
    mockToken = {
      getCurrentPrice: jest.fn(() => 1.0)
    };
    
    mockPosition = {
      token: mockToken,
      entryPrice: 1.0
    };
  });

  test('triggers stop loss at 10% drawdown', () => {
    mockToken.getCurrentPrice.mockReturnValue(0.89); // 11% drop
    const signal = exitStrategies.checkExitSignals(mockPosition);
    
    expect(signal).toEqual({
      reason: 'STOP_LOSS',
      portion: 1.0
    });
  });

  test('triggers take profit at 50% gain', () => {
    mockToken.getCurrentPrice.mockReturnValue(1.51); // 51% gain
    const signal = exitStrategies.checkExitSignals(mockPosition);
    
    expect(signal).toEqual({
      reason: 'TAKE_PROFIT',
      portion: 1.0
    });
  });

  test('updates and triggers trailing stop', () => {
    // Price rises but stays under take profit threshold
    mockToken.getCurrentPrice.mockReturnValue(1.4); // 40% gain
    let signal = exitStrategies.checkExitSignals(mockPosition);
    expect(signal).toBe(null);
    expect(exitStrategies.trailingStopPrice).toBe(1.4);

    // Price drops 21% from peak
    mockToken.getCurrentPrice.mockReturnValue(1.1);
    signal = exitStrategies.checkExitSignals(mockPosition);
    
    expect(signal).toEqual({
      reason: 'TRAILING_STOP',
      portion: 1.0
    });
  });

  test('returns null when no exit conditions met', () => {
    mockToken.getCurrentPrice.mockReturnValue(1.05); // 5% gain
    const signal = exitStrategies.checkExitSignals(mockPosition);
    
    expect(signal).toBe(null);
  });

  test('trailing stop updates with new highs below take profit', () => {
    // Set initial high
    mockToken.getCurrentPrice.mockReturnValue(1.2); // 20% gain
    exitStrategies.checkExitSignals(mockPosition);
    expect(exitStrategies.trailingStopPrice).toBe(1.2);

    // Set new high
    mockToken.getCurrentPrice.mockReturnValue(1.3); // 30% gain
    exitStrategies.checkExitSignals(mockPosition);
    expect(exitStrategies.trailingStopPrice).toBe(1.3);

    // Lower price shouldn't update trailing stop
    mockToken.getCurrentPrice.mockReturnValue(1.25);
    exitStrategies.checkExitSignals(mockPosition);
    expect(exitStrategies.trailingStopPrice).toBe(1.3);
  });

  test('take profit takes precedence over trailing stop', () => {
    // Set trailing stop
    mockToken.getCurrentPrice.mockReturnValue(1.3); // 30% gain
    let signal = exitStrategies.checkExitSignals(mockPosition);
    expect(signal).toBe(null);
    expect(exitStrategies.trailingStopPrice).toBe(1.3);

    // Hit take profit
    mockToken.getCurrentPrice.mockReturnValue(1.6); // 60% gain
    signal = exitStrategies.checkExitSignals(mockPosition);
    expect(signal).toEqual({
      reason: 'TAKE_PROFIT',
      portion: 1.0
    });
  });
});
