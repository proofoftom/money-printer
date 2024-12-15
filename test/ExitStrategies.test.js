const { expect } = require('chai');
const ExitStrategies = require('../src/ExitStrategies');

describe('ExitStrategies', () => {
  let config;
  let exitStrategies;
  let position;

  beforeEach(() => {
    config = {
      EXIT_STRATEGIES: {
        STOP_LOSS: {
          ENABLED: true,
          THRESHOLD: -5,
        },
        TRAILING_STOP: {
          ENABLED: true,
          ACTIVATION_THRESHOLD: 15,
          BASE_PERCENTAGE: 10,
          DYNAMIC_ADJUSTMENT: {
            ENABLED: true,
            VOLATILITY_MULTIPLIER: 0.5,
            MIN_PERCENTAGE: 5,
            MAX_PERCENTAGE: 20,
          },
        },
        VOLUME_BASED: {
          ENABLED: true,
          VOLUME_DROP_THRESHOLD: 50,
          MEASUREMENT_PERIOD: 300,
          MIN_PEAK_VOLUME: 1000,
        },
        TIME_BASED: {
          ENABLED: true,
          MAX_HOLD_TIME: 1800, // 30 minutes in seconds
          EXTENSION_THRESHOLD: 40,
          EXTENSION_TIME: 900,
        },
      },
    };
    
    exitStrategies = new ExitStrategies(config);
    position = { entryPrice: 100 };
  });

  describe('Stop Loss', () => {
    it('should exit when loss exceeds threshold', () => {
      const result = exitStrategies.shouldExit(position, 94); // 6% loss
      expect(result.shouldExit).to.be.true;
      expect(result.reason).to.equal('STOP_LOSS');
    });

    it('should not exit when loss is within threshold', () => {
      const result = exitStrategies.shouldExit(position, 96); // 4% loss
      expect(result.shouldExit).to.be.false;
    });
  });

  describe('Trailing Stop', () => {
    it('should initialize trailing stop when profit threshold is reached', () => {
      // Price rises to activation threshold
      exitStrategies.shouldExit(position, 115); // 15% profit
      expect(exitStrategies.trailingStopPrice).to.be.closeTo(103.5, 0.1); // 115 * 0.9
    });

    it('should update trailing stop on new highs', () => {
      // Initialize trailing stop
      exitStrategies.shouldExit(position, 115);
      const initialStop = exitStrategies.trailingStopPrice;

      // Price continues to rise
      exitStrategies.shouldExit(position, 120);
      expect(exitStrategies.trailingStopPrice).to.be.greaterThan(initialStop);
    });

    it('should exit when price falls below trailing stop', () => {
      // Initialize trailing stop
      exitStrategies.shouldExit(position, 115);
      const stopPrice = exitStrategies.trailingStopPrice;

      // Price falls below stop
      const result = exitStrategies.shouldExit(position, stopPrice - 1);
      expect(result.shouldExit).to.be.true;
      expect(result.reason).to.equal('TRAILING_STOP');
    });
  });

  describe('Volume-Based Exit', () => {
    beforeEach(() => {
      exitStrategies.reset();
    });

    it('should track peak volume', () => {
      exitStrategies.shouldExit(position, 100, 1500);
      expect(exitStrategies.peakVolume).to.equal(1500);
    });

    it('should detect significant volume drops', () => {
      // Set up initial volume state
      exitStrategies.peakVolume = 2000;
      exitStrategies.volumeHistory = [
        { timestamp: Date.now() - 2000, volume: 2000 },
        { timestamp: Date.now() - 1000, volume: 1900 }
      ];

      // Test significant volume drop
      const result = exitStrategies.shouldExit(position, 100, 500);
      expect(result.shouldExit).to.be.true;
      expect(result.reason).to.equal('VOLUME_DROP');
    });

    it('should ignore volume drops within threshold', () => {
      // Set up initial volume state
      exitStrategies.peakVolume = 2000;
      exitStrategies.volumeHistory = [
        { timestamp: Date.now() - 2000, volume: 2000 },
        { timestamp: Date.now() - 1000, volume: 1800 }
      ];

      // Test moderate volume drop
      const result = exitStrategies.shouldExit(position, 100, 1500);
      expect(result.shouldExit).to.be.false;
    });
  });

  describe('Time-Based Exit', () => {
    beforeEach(() => {
      exitStrategies.reset();
    });

    it('should extend time limit on high profit', () => {
      // Simulate high profit scenario (25 minutes elapsed)
      exitStrategies.entryTime = Date.now() / 1000 - (25 * 60);
      const result = exitStrategies.shouldExit(position, 150, 0); // 50% profit
      expect(result.shouldExit).to.be.false;
      expect(exitStrategies.timeExtended).to.be.true;
    });

    it('should exit after max time without extension', () => {
      // Simulate max time reached (35 minutes elapsed)
      exitStrategies.entryTime = Date.now() / 1000 - (35 * 60);
      const result = exitStrategies.shouldExit(position, 110, 0); // 10% profit
      expect(result.shouldExit).to.be.true;
      expect(result.reason).to.equal('TIME_LIMIT');
    });
  });

  describe('Reset', () => {
    it('should reset all tracking variables', () => {
      // Set up some state
      exitStrategies.shouldExit(position, 115, 1500);
      
      // Reset
      exitStrategies.reset();
      
      expect(exitStrategies.trailingStopPrice).to.be.null;
      expect(exitStrategies.volumeHistory).to.be.empty;
      expect(exitStrategies.peakVolume).to.equal(0);
    });
  });
});
