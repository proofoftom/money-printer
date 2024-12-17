const { expect } = require('chai');
const ExitStrategies = require('../src/core/position/ExitStrategies');

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
        TAKE_PROFIT: {
          ENABLED: true,
          TIERS: [
            { THRESHOLD: 20, PORTION: 0.4 },
            { THRESHOLD: 40, PORTION: 0.4 },
            { THRESHOLD: 60, PORTION: 0.2 },
          ],
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
      const position = { entryPrice: 100 };
      const exitStrategies = new ExitStrategies(config);
      
      // First update at 20% profit to initialize
      exitStrategies.checkTrailingStop(position, 120);
      const initialStop = exitStrategies.trailingStopPrice;
      
      // Update with higher price
      exitStrategies.checkTrailingStop(position, 125);
      expect(exitStrategies.trailingStopPrice).to.be.above(initialStop);
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

    it.skip('should extend time limit on high profit', () => {
      const position = { entryPrice: 100 };
      const exitStrategies = new ExitStrategies(config);
      
      // Check with high profit but not enough time elapsed
      const result = exitStrategies.checkTimeBasedExit(position, 150); // 50% profit
      expect(result).to.be.false;
      expect(exitStrategies.timeExtended).to.be.true;
      
      // Fast forward past max time
      exitStrategies.entryTime -= config.EXIT_STRATEGIES.TIME_BASED.MAX_HOLD_TIME + 1;
      const finalResult = exitStrategies.checkTimeBasedExit(position, 150);
      expect(finalResult).to.be.true;
    });

    it('should exit after max time without extension', () => {
      // Simulate max time reached (35 minutes elapsed)
      exitStrategies.entryTime = Date.now() / 1000 - (35 * 60);
      const result = exitStrategies.shouldExit(position, 110, 0); // 10% profit
      expect(result.shouldExit).to.be.true;
      expect(result.reason).to.equal('TIME_LIMIT');
    });
  });

  describe('Take Profit', () => {
    beforeEach(() => {
      exitStrategies.reset();
    });

    it('should take first tier profit', () => {
      const result = exitStrategies.shouldExit(position, 120, 0); // 20% profit
      expect(result.shouldExit).to.be.true;
      expect(result.reason).to.equal('takeProfit_tier1');
      expect(result.portion).to.equal(0.4);
      expect(exitStrategies.remainingPosition).to.equal(0.6);
    });

    it('should take second tier profit', () => {
      // First take profit
      exitStrategies.shouldExit(position, 120, 0);
      
      // Second take profit
      const result = exitStrategies.shouldExit(position, 140, 0); // 40% profit
      expect(result.shouldExit).to.be.true;
      expect(result.reason).to.equal('takeProfit_tier2');
      expect(result.portion).to.equal(0.4);
      expect(exitStrategies.remainingPosition).to.equal(0.2);
    });

    it('should take final tier profit', () => {
      // First two take profits
      exitStrategies.shouldExit(position, 120, 0);
      exitStrategies.shouldExit(position, 140, 0);
      
      // Final take profit
      const result = exitStrategies.shouldExit(position, 160, 0); // 60% profit
      expect(result.shouldExit).to.be.true;
      expect(result.reason).to.equal('takeProfit_tier3');
      expect(result.portion).to.equal(0.2);
      expect(exitStrategies.remainingPosition).to.equal(0);
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
