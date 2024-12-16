const { expect } = require('chai');
const sinon = require('sinon');
const Position = require('../src/Position');
const Token = require('../src/Token');
const PriceManager = require('../src/PriceManager');

describe('Position', () => {
  let position;
  let mockToken;
  let mockPriceManager;
  let mockConfig;

  beforeEach(() => {
    mockConfig = {
      POSITIONS: {
        MAX_SIZE: 1000000,
        MIN_SIZE: 0.1,
        MAX_SLIPPAGE: 0.02
      }
    };

    mockToken = {
      mint: 'test-mint',
      symbol: 'TEST',
      currentPrice: 100,
      getVolatility: sinon.stub().returns(0.2),
      getVolumeProfile: sinon.stub().returns({ trend: 'stable', dropPercentage: 0 }),
      getMarketConditions: sinon.stub().returns({ trend: 'neutral', strength: 0.5 }),
      on: sinon.stub(),
      emit: sinon.stub()
    };

    mockPriceManager = {
      solToUSD: sinon.stub().returns(100),
      usdToSOL: sinon.stub().returns(1),
      on: sinon.stub(),
      emit: sinon.stub()
    };

    position = new Position({
      mint: mockToken.mint,
      symbol: mockToken.symbol,
      entryPrice: 100,
      size: 10,
      token: mockToken,
      priceManager: mockPriceManager,
      config: mockConfig
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Position Creation', () => {
    it('should initialize with correct values', () => {
      expect(position.mint).to.equal(mockToken.mint);
      expect(position.symbol).to.equal(mockToken.symbol);
      expect(position.entryPrice).to.equal(100);
      expect(position.size).to.equal(10);
      expect(position.remainingSize).to.equal(1.0);
    });

    it('should validate position parameters', () => {
      expect(() => new Position({
        ...position,
        size: mockConfig.POSITIONS.MAX_SIZE + 1
      })).to.throw();

      expect(() => new Position({
        ...position,
        size: mockConfig.POSITIONS.MIN_SIZE - 0.01
      })).to.throw();
    });
  });

  describe('Price Updates', () => {
    it('should update price correctly', () => {
      position.updatePrice(150);
      expect(position.currentPrice).to.equal(150);
      expect(position.priceHistory).to.include(150);
    });

    it('should track highest and lowest prices', () => {
      position.updatePrice(150);
      position.updatePrice(80);
      position.updatePrice(120);
      expect(position.highestPrice).to.equal(150);
      expect(position.lowestPrice).to.equal(80);
    });

    it('should calculate drawdown correctly', () => {
      position.updatePrice(150);
      position.updatePrice(75);
      expect(position.maxDrawdown).to.equal(25);
    });

    it('should calculate upside correctly', () => {
      position.updatePrice(200);
      expect(position.maxUpside).to.equal(100);
    });
  });

  describe('Value Calculations', () => {
    it('should calculate current value in USD', () => {
      const value = position.getCurrentValueUSD();
      expect(mockPriceManager.solToUSD).to.have.been.called;
      expect(value).to.be.a('number');
    });

    it('should calculate entry value in USD', () => {
      const value = position.getEntryValueUSD();
      expect(mockPriceManager.solToUSD).to.have.been.called;
      expect(value).to.be.a('number');
    });

    it('should calculate PnL in USD', () => {
      position.updatePrice(150);
      const pnl = position.getPnLUSD();
      expect(pnl).to.be.a('number');
    });

    it('should calculate PnL percentage', () => {
      position.updatePrice(150);
      const pnlPercentage = position.getPnLPercentage();
      expect(pnlPercentage).to.equal(50);
    });
  });

  describe('Partial Exits', () => {
    it('should handle partial exits correctly', () => {
      position.recordPartialExit(0.5, 150);
      expect(position.remainingSize).to.equal(0.5);
      expect(position.partialExits).to.have.lengthOf(1);
    });

    it('should validate exit size', () => {
      expect(() => position.recordPartialExit(1.5, 150)).to.throw();
      expect(() => position.recordPartialExit(-0.1, 150)).to.throw();
    });

    it('should track cumulative realized PnL', () => {
      position.recordPartialExit(0.5, 150);
      expect(position.getRealizedPnL()).to.be.a('number');
    });
  });

  describe('Event Emission', () => {
    it('should emit update event on price change', (done) => {
      position.on('updated', (pos) => {
        expect(pos.currentPrice).to.equal(150);
        done();
      });
      position.updatePrice(150);
    });

    it('should emit exit event on partial exit', (done) => {
      position.on('partialExit', (data) => {
        expect(data.portion).to.equal(0.5);
        expect(data.price).to.equal(150);
        done();
      });
      position.recordPartialExit(0.5, 150);
    });
  });

  describe('Position Health', () => {
    it('should detect stale position', () => {
      const clock = sinon.useFakeTimers();
      const threshold = 300000; // 5 minutes
      
      expect(position.isStale(threshold)).to.be.false;
      
      clock.tick(threshold + 1000);
      expect(position.isStale(threshold)).to.be.true;
      
      clock.restore();
    });

    it('should track update frequency', () => {
      const updates = position.getUpdateFrequency();
      expect(updates).to.have.property('count');
      expect(updates).to.have.property('averageInterval');
    });
  });
});
