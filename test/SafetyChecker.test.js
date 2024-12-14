const assert = require('assert');
const SafetyChecker = require('../src/SafetyChecker');

describe('SafetyChecker', () => {
  let safetyChecker;
  let mockMarketData;

  beforeEach(() => {
    safetyChecker = new SafetyChecker();
    mockMarketData = {
      marketCap: 100,
      creationTime: Date.now() - 60000, // 60 seconds ago
      currentPrice: 1,
      initialPrice: 0.5,
      priceVolatility: 30,
      uniqueBuyers: 20,
      avgTradeSize: 2,
      buyCount: 80,
      sellCount: 20,
      maxWalletVolumePercentage: 15,
      holderCount: 30,
      topHolderConcentration: 25,
      minHolderWalletAge: 10,
      volumePriceCorrelation: 0.7,
      suspectedWashTradePercentage: 10
    };
  });

  describe('Market Cap Checks', () => {
    it('should reject if market cap is too high', () => {
      mockMarketData.marketCap = 300;
      assert.strictEqual(safetyChecker.checkMarketCap(mockMarketData), false);
    });

    it('should reject if market cap is too low', () => {
      mockMarketData.marketCap = 3;
      assert.strictEqual(safetyChecker.checkMarketCap(mockMarketData), false);
    });

    it('should accept valid market cap', () => {
      assert.strictEqual(safetyChecker.checkMarketCap(mockMarketData), true);
    });
  });

  describe('Time and Age Checks', () => {
    it('should reject if token is too new', () => {
      mockMarketData.creationTime = Date.now() - 15000; // 15 seconds ago
      assert.strictEqual(safetyChecker.checkTimeAndAge(mockMarketData), false);
    });

    it('should accept token with valid age', () => {
      assert.strictEqual(safetyChecker.checkTimeAndAge(mockMarketData), true);
    });
  });

  describe('Price Action Checks', () => {
    it('should reject if price pump is too high', () => {
      mockMarketData.currentPrice = 2;
      mockMarketData.initialPrice = 0.5;
      assert.strictEqual(safetyChecker.checkPriceAction(mockMarketData), false);
    });

    it('should reject if volatility is too high', () => {
      mockMarketData.priceVolatility = 60;
      assert.strictEqual(safetyChecker.checkPriceAction(mockMarketData), false);
    });

    it('should accept valid price action', () => {
      assert.strictEqual(safetyChecker.checkPriceAction(mockMarketData), true);
    });
  });

  describe('Trading Pattern Checks', () => {
    it('should reject if not enough unique buyers', () => {
      mockMarketData.uniqueBuyers = 10;
      assert.strictEqual(safetyChecker.checkTradingPatterns(mockMarketData), false);
    });

    it('should reject if average trade size is too high', () => {
      mockMarketData.avgTradeSize = 6;
      assert.strictEqual(safetyChecker.checkTradingPatterns(mockMarketData), false);
    });

    it('should reject if buy/sell ratio is too low', () => {
      mockMarketData.buyCount = 40;
      mockMarketData.sellCount = 60;
      assert.strictEqual(safetyChecker.checkTradingPatterns(mockMarketData), false);
    });

    it('should reject if single wallet volume is too high', () => {
      mockMarketData.maxWalletVolumePercentage = 30;
      assert.strictEqual(safetyChecker.checkTradingPatterns(mockMarketData), false);
    });

    it('should accept valid trading patterns', () => {
      assert.strictEqual(safetyChecker.checkTradingPatterns(mockMarketData), true);
    });
  });

  describe('Holder Distribution Checks', () => {
    it('should reject if not enough holders', () => {
      mockMarketData.holderCount = 20;
      assert.strictEqual(safetyChecker.checkHolderDistribution(mockMarketData), false);
    });

    it('should reject if holder concentration is too high', () => {
      mockMarketData.topHolderConcentration = 35;
      assert.strictEqual(safetyChecker.checkHolderDistribution(mockMarketData), false);
    });

    it('should reject if holder wallet age is too low', () => {
      mockMarketData.minHolderWalletAge = 5;
      assert.strictEqual(safetyChecker.checkHolderDistribution(mockMarketData), false);
    });

    it('should accept valid holder distribution', () => {
      assert.strictEqual(safetyChecker.checkHolderDistribution(mockMarketData), true);
    });
  });

  describe('Volume Pattern Checks', () => {
    it('should reject if volume-price correlation is too low', () => {
      mockMarketData.volumePriceCorrelation = 0.4;
      assert.strictEqual(safetyChecker.checkVolumePatterns(mockMarketData), false);
    });

    it('should reject if wash trading percentage is too high', () => {
      mockMarketData.suspectedWashTradePercentage = 25;
      assert.strictEqual(safetyChecker.checkVolumePatterns(mockMarketData), false);
    });

    it('should accept valid volume patterns', () => {
      assert.strictEqual(safetyChecker.checkVolumePatterns(mockMarketData), true);
    });
  });

  describe('Overall Safety Check', () => {
    it('should accept token with all valid metrics', () => {
      assert.strictEqual(safetyChecker.isTokenSafe(mockMarketData), true);
    });

    it('should reject token with any invalid metric', () => {
      mockMarketData.marketCap = 300;
      assert.strictEqual(safetyChecker.isTokenSafe(mockMarketData), false);

      mockMarketData.marketCap = 100;
      mockMarketData.priceVolatility = 60;
      assert.strictEqual(safetyChecker.isTokenSafe(mockMarketData), false);

      mockMarketData.priceVolatility = 30;
      mockMarketData.uniqueBuyers = 10;
      assert.strictEqual(safetyChecker.isTokenSafe(mockMarketData), false);
    });
  });
});
