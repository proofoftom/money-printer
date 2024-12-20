const ExitStrategies = require('../ExitStrategies');

describe('ExitStrategies', () => {
  let exitStrategies;
  let mockLogger;
  let mockPosition;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    // Base mock position
    mockPosition = {
      mint: 'test-mint',
      symbol: 'TEST',
      state: 'OPEN',
      currentPrice: 100,
      entryPrice: 90,
      highestPrice: 110,
      openTime: Date.now() - 3600000,
      token: {
        symbol: 'TEST',
        currentPrice: 100,
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
            open: 90,
            high: 110,
            low: 85,
            close: 100,
            volume: 1000,
            timestamp: Date.now()
          }]
        }
      },
      config: {
        stopLossLevel: 10,
        takeProfitLevel: 50,
        trailingStopLevel: 20,
        volumeDropEnabled: true,
        volumeDropThreshold: 50,
        priceVelocityEnabled: true,
        priceVelocityThreshold: -0.1,
        scoreBasedEnabled: true,
        minimumScoreThreshold: 30
      }
    };

    exitStrategies = new ExitStrategies(mockLogger);
  });

  describe('Basic Exit Conditions', () => {
    it('should trigger stop loss when price drops below threshold', () => {
      mockPosition.currentPrice = 80;  // -20% from entry
      mockPosition.highestPrice = 90;  // Set highest price to entry price to avoid trailing stop
      const result = exitStrategies.checkExitSignals(mockPosition);
      expect(result).toBeTruthy();
      expect(result.reason).toBe('STOP_LOSS');
    });

    it('should trigger take profit when price rises above threshold', () => {
      mockPosition.currentPrice = 150;  // +50% from entry
      mockPosition.highestPrice = 150;  // Update highest price
      const result = exitStrategies.checkExitSignals(mockPosition);
      expect(result).toBeTruthy();
      expect(result.reason).toBe('TAKE_PROFIT');
    });

    it('should trigger trailing stop when price drops from highest', () => {
      mockPosition.highestPrice = 120;
      mockPosition.currentPrice = 90;  // -25% from highest
      const result = exitStrategies.checkExitSignals(mockPosition);
      expect(result).toBeTruthy();
      expect(result.reason).toBe('TRAILING_STOP');
    });
  });

  describe('OHLCV Exit Conditions', () => {
    it('should trigger volume drop exit when volume decreases significantly', () => {
      mockPosition.token.indicators.volumeProfile = new Map([
        ['relativeVolume', 30],  // 70% drop
        ['volumeMA', 1000]
      ]);
      
      const result = exitStrategies.checkExitSignals(mockPosition);
      expect(result).toBeTruthy();
      expect(result.reason).toBe('VOLUME_DROP');
    });

    it('should trigger price velocity exit on rapid decline', () => {
      mockPosition.token.indicators.priceVelocity = -0.2;
      const result = exitStrategies.checkExitSignals(mockPosition);
      expect(result).toBeTruthy();
      expect(result.reason).toBe('PRICE_VELOCITY');
    });
  });

  describe('Market Condition Tests', () => {
    it('should handle high volatility periods', () => {
      mockPosition.token.indicators.volatility = 0.5;
      mockPosition.token.ohlcvData.secondly = generateVolatileCandles(10);
      
      const result = exitStrategies.checkExitSignals(mockPosition);
      expect(result).toBeTruthy();
      expect(result.portion).toBeLessThan(1);
    });

    it('should handle low liquidity conditions', () => {
      mockPosition.token.indicators.volumeProfile = new Map([
        ['relativeVolume', 10],
        ['volumeMA', 1000]
      ]);
      
      const result = exitStrategies.checkExitSignals(mockPosition);
      expect(result).toBeTruthy();
      expect(result.reason).toBe('VOLUME_DROP');
    });
  });

  describe('Position Sizing', () => {
    it('should reduce size for high volatility', () => {
      const token = {
        symbol: 'TEST',
        indicators: {
          volatility: 0.6,
          volumeProfile: new Map([['relativeVolume', 100]]),
          priceVelocity: 0,
          safetyScore: 80
        }
      };
      
      const result = exitStrategies.calculatePositionSize(token, 1.0);
      expect(result.size).toBeLessThan(0.5);
      expect(result.reason).toBe('HIGH_VOLATILITY');
    });

    it('should handle missing indicators gracefully', () => {
      const token = {
        symbol: 'TEST',
        indicators: {}
      };
      
      const result = exitStrategies.calculatePositionSize(token, 1.0);
      expect(result.size).toBeLessThan(0.4);
      expect(result.riskFactors).toBeDefined();
    });

    it('should never return size larger than base size', () => {
      const token = {
        symbol: 'TEST',
        indicators: {
          volatility: 0,
          volumeProfile: new Map([['relativeVolume', 200]]),
          priceVelocity: 0.2,
          safetyScore: 100
        }
      };
      
      const result = exitStrategies.calculatePositionSize(token, 1.0);
      expect(result.size).toBeLessThanOrEqual(1.0);
    });
  });
});

function generateVolatileCandles(count) {
  const candles = [];
  for (let i = 0; i < count; i++) {
    const open = Math.random() * 100;
    const high = open + Math.random() * 20;
    const low = open - Math.random() * 20;
    const close = Math.random() * (high - low) + low;
    candles.push({ open, high, low, close, volume: Math.random() * 1000, timestamp: Date.now() - (i * 1000) });
  }
  return candles;
}
