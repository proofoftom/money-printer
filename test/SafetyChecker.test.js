const assert = require('assert');
const SafetyChecker = require('../src/SafetyChecker');
const config = require('../src/config');

describe('SafetyChecker', () => {
  let safetyChecker;
  let mockMarketData;
  let mockPriceManager;

  beforeEach(() => {
    // Mock PriceManager with realistic SOL price of $100
    mockPriceManager = {
      solToUSD: (sol) => sol * 100, // 1 SOL = $100 USD for testing
      usdToSOL: (usd) => usd / 100
    };

    safetyChecker = new SafetyChecker(mockPriceManager);
    mockMarketData = {
      mint: 'testMint',
      marketCapSol: 150, // $15k USD at $100/SOL
      createdAt: Date.now() - 3700000, // 1 hour and 100 seconds ago
      currentPrice: 1,
      initialPrice: 0.5,
      priceVolatility: 30,
      uniqueBuyers: 60,
      avgTradeSize: 2, // $200 USD at $100/SOL
      buyCount: 80,
      sellCount: 20,
      maxWalletVolumePercentage: 15,
      holderCount: 150,
      topHolderConcentration: 25,
      minHolderWalletAge: 10,
      volumePriceCorrelation: 0.7,
      suspectedWashTradePercentage: 10
    };
  });

  describe('Market Cap Checks', () => {
    it('should reject if market cap is too high', () => {
      mockMarketData.marketCapSol = 110000; // $11M USD at $100/SOL (above $10M limit)
      assert.strictEqual(safetyChecker.checkMarketCap(mockMarketData), false);
    });

    it('should reject if market cap is too low', () => {
      mockMarketData.marketCapSol = 50; // $5k USD at $100/SOL (below $10k limit)
      assert.strictEqual(safetyChecker.checkMarketCap(mockMarketData), false);
    });

    it('should accept valid market cap', () => {
      mockMarketData.marketCapSol = 200; // $20k USD at $100/SOL
      assert.strictEqual(safetyChecker.checkMarketCap(mockMarketData), true);
    });
  });

  describe('Time and Age Checks', () => {
    it('should reject if token is too new', () => {
      mockMarketData.createdAt = Date.now() - 15000; // 15 seconds ago
      assert.strictEqual(safetyChecker.checkTimeAndAge(mockMarketData), false);
    });

    it('should accept token with valid age', () => {
      assert.strictEqual(safetyChecker.checkTimeAndAge(mockMarketData), true);
    });
  });

  describe('Price Action Checks', () => {
    it('should reject if price pump is too high', () => {
      mockMarketData.currentPrice = mockMarketData.initialPrice * 11; // 11x pump (above 10x limit)
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
      mockMarketData.uniqueBuyers = 30;
      assert.strictEqual(safetyChecker.checkTradingPatterns(mockMarketData), false);
    });

    it('should reject if average trade size is too high', () => {
      mockMarketData.avgTradeSize = 60; // $6k USD at $100/SOL (above $5k limit)
      assert.strictEqual(safetyChecker.checkTradingPatterns(mockMarketData), false);
    });

    it('should reject if buy/sell ratio is too low', () => {
      mockMarketData.buyCount = 20;
      mockMarketData.sellCount = 80; // 20% buys (below 40% minimum)
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
      mockMarketData.holderCount = 50;
      assert.strictEqual(safetyChecker.checkHolderDistribution(mockMarketData), false);
    });

    it('should reject if holder concentration is too high', () => {
      mockMarketData.topHolderConcentration = 60; // 60% concentration (above 50% limit)
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
      mockMarketData.volumePriceCorrelation = 0.3;
      assert.strictEqual(safetyChecker.checkVolumePatterns(mockMarketData), false);
    });

    it('should reject if wash trading percentage is too high', () => {
      mockMarketData.suspectedWashTradePercentage = 35; // 35% wash trading (above 30% limit)
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
      mockMarketData.marketCapSol = 110000; // $11M USD at $100/SOL (above $10M limit)
      assert.strictEqual(safetyChecker.isTokenSafe(mockMarketData), false);
    });
  });
});
