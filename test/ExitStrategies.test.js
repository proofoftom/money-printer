const { expect } = require('chai');
const sinon = require('sinon');
const ExitStrategies = require('../src/ExitStrategies');
const Position = require('../src/Position');
const Token = require('../src/Token');
const PriceManager = require('../src/PriceManager');

describe('ExitStrategies', () => {
  let exitStrategies;
  let mockPosition;
  let mockToken;
  let mockPriceManager;
  let mockConfig;

  beforeEach(() => {
    mockConfig = {
      EXIT_STRATEGIES: {
        USD_BASED_THRESHOLDS: true,
        STOP_LOSS: {
          ENABLED: true,
          THRESHOLD: -0.1,
          USD_THRESHOLD: -100
        },
        TRAILING_STOP: {
          ENABLED: true,
          ACTIVATION_THRESHOLD: 0.05,
          BASE_PERCENTAGE: 0.02,
          DYNAMIC_ADJUSTMENT: {
            ENABLED: true,
            VOLATILITY_MULTIPLIER: 1.5,
            VOLUME_MULTIPLIER: 1.2,
            CORRELATION_MULTIPLIER: 1.1,
            MIN_PERCENTAGE: 0.01,
            MAX_PERCENTAGE: 0.05,
            CORRELATION_THRESHOLD: 0.7
          }
        },
        TAKE_PROFIT: {
          ENABLED: true,
          TIERS: [
            { THRESHOLD: 0.1, PORTION: 0.3 },
            { THRESHOLD: 0.2, PORTION: 0.5 },
            { THRESHOLD: 0.3, PORTION: 1.0 }
          ],
          DYNAMIC_ADJUSTMENT: {
            BULL_MARKET_MULTIPLIER: 1.2,
            BEAR_MARKET_MULTIPLIER: 0.8,
            VOLATILITY_THRESHOLD: 0.3,
            VOLATILITY_MULTIPLIER: 1.1
          }
        },
        VOLUME_BASED: {
          ENABLED: true,
          VOLUME_DROP_THRESHOLD: 0.5
        },
        TIME_BASED: {
          ENABLED: true,
          MAX_HOLD_TIME: 3600,
          EXTENSION_TIME: 1800,
          EXTENSION_THRESHOLD: 0.15,
          BULL_MARKET_MULTIPLIER: 1.5,
          BEAR_MARKET_MULTIPLIER: 0.7
        }
      }
    };

    mockToken = {
      getVolatility: sinon.stub().returns(0.2),
      getVolumeProfile: sinon.stub().returns({ trend: 'stable', dropPercentage: 0 }),
      getMarketCorrelation: sinon.stub().returns(0.5),
      getMarketConditions: sinon.stub().returns({ trend: 'neutral', strength: 0.5 }),
      volume: 1000,
      on: sinon.stub(),
      emit: sinon.stub()
    };

    mockPosition = {
      entryPrice: 100,
      currentPrice: 100,
      size: 10,
      remainingSize: 1.0,
      getCurrentValueUSD: sinon.stub().returns(1000),
      getEntryValueUSD: sinon.stub().returns(1000),
      getPnLUSD: sinon.stub().returns(0),
      getPnLPercentage: sinon.stub().returns(0),
      calculatePnLPercent: sinon.stub().returns(0),
      on: sinon.stub(),
      emit: sinon.stub()
    };

    mockPriceManager = {
      solToUSD: sinon.stub().returns(100),
      usdToSOL: sinon.stub().returns(1),
      on: sinon.stub(),
      emit: sinon.stub()
    };

    exitStrategies = new ExitStrategies({
      config: mockConfig,
      position: mockPosition,
      token: mockToken,
      priceManager: mockPriceManager
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Stop Loss', () => {
    it('should trigger stop loss at threshold', () => {
      mockPosition.getPnLPercentage.returns(-15);
      const result = exitStrategies.checkStopLoss(85);
      expect(result).to.be.true;
    });

    it('should trigger USD-based stop loss', () => {
      mockPosition.getPnLUSD.returns(-150);
      const result = exitStrategies.checkStopLoss(85);
      expect(result).to.be.true;
    });
  });

  describe('Trailing Stop', () => {
    it('should initialize trailing stop', () => {
      mockPosition.calculatePnLPercent.returns(0.06);
      exitStrategies.checkTrailingStop(106);
      expect(exitStrategies.trailingStopPrice).to.be.a('number');
    });

    it('should update trailing stop on new highs', () => {
      mockPosition.calculatePnLPercent.returns(0.06);
      exitStrategies.checkTrailingStop(106);
      const initialStop = exitStrategies.trailingStopPrice;
      
      mockPosition.calculatePnLPercent.returns(0.08);
      exitStrategies.checkTrailingStop(108);
      expect(exitStrategies.trailingStopPrice).to.be.greaterThan(initialStop);
    });

    it('should trigger trailing stop', () => {
      mockPosition.calculatePnLPercent.returns(0.06);
      exitStrategies.checkTrailingStop(106);
      
      mockPosition.calculatePnLPercent.returns(-0.02);
      const result = exitStrategies.checkTrailingStop(95);
      expect(result).to.be.true;
    });
  });

  describe('Take Profit', () => {
    it('should trigger take profit at tiers', () => {
      mockPosition.getPnLPercentage.returns(15);
      const result = exitStrategies.checkTakeProfit(115);
      expect(result.shouldExit).to.be.true;
      expect(result.portion).to.equal(0.3);
    });

    it('should adjust thresholds based on market conditions', () => {
      mockToken.getMarketConditions.returns({ trend: 'bullish', strength: 0.8 });
      mockPosition.getPnLPercentage.returns(25);
      const result = exitStrategies.checkTakeProfit(125);
      expect(result.shouldExit).to.be.true;
    });

    it('should track triggered tiers', () => {
      mockPosition.getPnLPercentage.returns(15);
      exitStrategies.checkTakeProfit(115);
      expect(exitStrategies.triggeredTiers.size).to.equal(1);
    });
  });

  describe('Volume-Based Exit', () => {
    it('should trigger on volume drop', () => {
      mockToken.getVolumeProfile.returns({ trend: 'decreasing', dropPercentage: 0.6 });
      const result = exitStrategies.checkVolumeBasedExit(400);
      expect(result).to.be.true;
    });

    it('should not trigger on stable volume', () => {
      mockToken.getVolumeProfile.returns({ trend: 'stable', dropPercentage: 0.2 });
      const result = exitStrategies.checkVolumeBasedExit(800);
      expect(result).to.be.false;
    });
  });

  describe('Time-Based Exit', () => {
    it('should trigger after max hold time', () => {
      const clock = sinon.useFakeTimers();
      clock.tick(mockConfig.EXIT_STRATEGIES.TIME_BASED.MAX_HOLD_TIME * 1000 + 1000);
      const result = exitStrategies.checkTimeBasedExit(100);
      expect(result).to.be.true;
      clock.restore();
    });

    it('should extend time on profit', () => {
      mockPosition.getPnLPercentage.returns(20);
      const clock = sinon.useFakeTimers();
      
      const initialResult = exitStrategies.checkTimeBasedExit(120);
      expect(initialResult).to.be.false;
      expect(exitStrategies.timeExtended).to.be.true;
      
      clock.tick(mockConfig.EXIT_STRATEGIES.TIME_BASED.MAX_HOLD_TIME * 1000);
      const extendedResult = exitStrategies.checkTimeBasedExit(120);
      expect(extendedResult).to.be.false;
      
      clock.restore();
    });
  });

  describe('Event Handling', () => {
    it('should handle volume updates', (done) => {
      exitStrategies.on('exit', (data) => {
        expect(data).to.have.property('reason');
        expect(data).to.have.property('portion');
        done();
      });

      mockToken.getVolumeProfile.returns({ trend: 'decreasing', dropPercentage: 0.6 });
      exitStrategies.handleVolumeUpdate({ volume: 400 });
    });

    it('should handle price updates', (done) => {
      exitStrategies.on('exit', (data) => {
        expect(data).to.have.property('reason');
        expect(data).to.have.property('portion');
        done();
      });

      mockPosition.getPnLPercentage.returns(-15);
      exitStrategies.handlePriceUpdate({ price: 85 });
    });

    it('should handle SOL price updates', () => {
      const newSolPrice = 120;
      exitStrategies.handleSolPriceUpdate({ newPrice: newSolPrice });
      // Verify USD thresholds are updated
      expect(mockConfig.EXIT_STRATEGIES.STOP_LOSS.THRESHOLD).to.be.a('number');
    });
  });
});
