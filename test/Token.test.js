const { expect } = require('chai');
const sinon = require('sinon');
const Token = require('../src/Token');

describe('Token', () => {
  let token;
  let mockConfig;
  let mockPriceManager;
  let mockStatsLogger;

  beforeEach(() => {
    mockConfig = {
      TOKENS: {
        VOLATILITY_WINDOW: 24,
        VOLUME_WINDOW: 12,
        CORRELATION_THRESHOLD: 0.7
      }
    };

    mockPriceManager = {
      solToUSD: sinon.stub().returns(100),
      usdToSOL: sinon.stub().returns(1),
      on: sinon.stub(),
      emit: sinon.stub()
    };

    mockStatsLogger = {
      logTokenMetrics: sinon.stub(),
      logMarketMetrics: sinon.stub()
    };

    token = new Token({
      mint: 'test-mint',
      symbol: 'TEST',
      config: mockConfig,
      priceManager: mockPriceManager,
      statsLogger: mockStatsLogger
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Price Management', () => {
    it('should update price correctly', () => {
      const newPrice = 150;
      token.updatePrice(newPrice);
      expect(token.currentPrice).to.equal(newPrice);
      expect(token.priceHistory).to.include(newPrice);
    });

    it('should calculate volatility', () => {
      const prices = [100, 110, 90, 105, 95];
      prices.forEach(price => token.updatePrice(price));
      const volatility = token.getVolatility();
      expect(volatility).to.be.a('number');
      expect(volatility).to.be.greaterThan(0);
    });

    it('should maintain price history within window', () => {
      const prices = Array.from({ length: 30 }, (_, i) => 100 + i);
      prices.forEach(price => token.updatePrice(price));
      expect(token.priceHistory.length).to.be.at.most(mockConfig.TOKENS.VOLATILITY_WINDOW);
    });
  });

  describe('Volume Management', () => {
    it('should update volume correctly', () => {
      const volumeData = {
        volume: 1000,
        volume1m: 5000,
        volume5m: 20000,
        volume30m: 100000
      };
      token.updateVolume(volumeData);
      expect(token.volume).to.equal(volumeData.volume);
      expect(token.volumeHistory).to.have.lengthOf(1);
    });

    it('should get volume profile', () => {
      const volumes = [1000, 900, 800, 700, 600];
      volumes.forEach(vol => token.updateVolume({ volume: vol }));
      const profile = token.getVolumeProfile();
      expect(profile).to.have.property('trend');
      expect(profile).to.have.property('dropPercentage');
    });

    it('should maintain volume history within window', () => {
      const volumes = Array.from({ length: 20 }, () => ({ volume: 1000 }));
      volumes.forEach(vol => token.updateVolume(vol));
      expect(token.volumeHistory.length).to.be.at.most(mockConfig.TOKENS.VOLUME_WINDOW);
    });
  });

  describe('Market Analysis', () => {
    it('should get market conditions', () => {
      // Simulate bullish trend
      const prices = Array.from({ length: 10 }, (_, i) => 100 + i * 10);
      prices.forEach(price => token.updatePrice(price));
      
      const conditions = token.getMarketConditions();
      expect(conditions).to.have.property('trend');
      expect(conditions).to.have.property('strength');
    });

    it('should calculate market correlation', () => {
      const correlation = token.getMarketCorrelation();
      expect(correlation).to.be.a('number');
      expect(correlation).to.be.within(-1, 1);
    });
  });

  describe('Event Emission', () => {
    it('should emit priceUpdate event', (done) => {
      token.on('priceUpdate', (data) => {
        expect(data).to.have.property('price');
        expect(data).to.have.property('timestamp');
        done();
      });
      token.updatePrice(150);
    });

    it('should emit volumeUpdate event', (done) => {
      token.on('volumeUpdate', (data) => {
        expect(data).to.have.property('volume');
        expect(data).to.have.property('timestamp');
        done();
      });
      token.updateVolume({ volume: 1000 });
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid price updates', () => {
      expect(() => token.updatePrice(-100)).to.throw();
      expect(() => token.updatePrice(0)).to.throw();
      expect(() => token.updatePrice(null)).to.throw();
    });

    it('should handle invalid volume updates', () => {
      expect(() => token.updateVolume({ volume: -1000 })).to.throw();
      expect(() => token.updateVolume({ volume: null })).to.throw();
    });
  });
});
