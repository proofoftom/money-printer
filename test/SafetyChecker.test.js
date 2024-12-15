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
      marketCapSol: 100, // $10k USD at $100/SOL
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
      mockMarketData.marketCapSol = config.SAFETY.MAX_MARKET_CAP_USD / 100 + 100;
      assert.strictEqual(safetyChecker.checkMarketCap(mockMarketData), false);
    });

    it('should reject if market cap is too low', () => {
      mockMarketData.marketCapSol = config.SAFETY.MIN_MARKET_CAP_USD / 100 - 10;
      assert.strictEqual(safetyChecker.checkMarketCap(mockMarketData), false);
    });

    it('should accept valid market cap', () => {
      mockMarketData.marketCapSol = (config.SAFETY.MIN_MARKET_CAP_USD + 1000) / 100;
      assert.strictEqual(safetyChecker.checkMarketCap(mockMarketData), true);
    });
  });

  describe('Time and Age Checks', () => {
    it('should reject if token is too new', () => {
      mockMarketData.createdAt = Date.now() - (config.SAFETY.MIN_TOKEN_AGE_SECONDS * 500);
      assert.strictEqual(safetyChecker.checkTokenAge(mockMarketData), false);
    });

    it('should accept token with valid age', () => {
      mockMarketData.createdAt = Date.now() - (config.SAFETY.MIN_TOKEN_AGE_SECONDS * 2000);
      assert.strictEqual(safetyChecker.checkTokenAge(mockMarketData), true);
    });
  });

  describe('Price Action Checks', () => {
    it('should reject if price pump is too high', () => {
      mockMarketData.currentPrice = mockMarketData.initialPrice * (config.SAFETY.MAX_PUMP_MULTIPLE + 1);
      assert.strictEqual(safetyChecker.checkPriceAction(mockMarketData), false);
    });

    it('should reject if volatility is too high', () => {
      mockMarketData.priceVolatility = config.SAFETY.MAX_PRICE_VOLATILITY + 10;
      assert.strictEqual(safetyChecker.checkPriceAction(mockMarketData), false);
    });

    it('should accept valid price action', () => {
      mockMarketData.currentPrice = mockMarketData.initialPrice * (config.SAFETY.MAX_PUMP_MULTIPLE - 1);
      mockMarketData.priceVolatility = config.SAFETY.MAX_PRICE_VOLATILITY - 10;
      assert.strictEqual(safetyChecker.checkPriceAction(mockMarketData), true);
    });
  });

  describe('Trading Pattern Checks', () => {
    it('should reject if not enough unique buyers', () => {
      mockMarketData.uniqueBuyers = config.SAFETY.MIN_UNIQUE_BUYERS - 10;
      assert.strictEqual(safetyChecker.checkTradingPatterns(mockMarketData), false);
    });

    it('should reject if average trade size is too high', () => {
      mockMarketData.avgTradeSize = (config.SAFETY.MAX_AVG_TRADE_SIZE_USD / 100) + 1;
      assert.strictEqual(safetyChecker.checkTradingPatterns(mockMarketData), false);
    });

    it('should reject if buy/sell ratio is too low', () => {
      mockMarketData.buyCount = 40;
      mockMarketData.sellCount = 160;
      assert.strictEqual(safetyChecker.checkTradingPatterns(mockMarketData), false);
    });

    it('should reject if single wallet volume is too high', () => {
      mockMarketData.maxWalletVolumePercentage = config.SAFETY.MAX_SINGLE_WALLET_VOLUME + 5;
      assert.strictEqual(safetyChecker.checkTradingPatterns(mockMarketData), false);
    });

    it('should accept valid trading patterns', () => {
      mockMarketData.uniqueBuyers = config.SAFETY.MIN_UNIQUE_BUYERS + 10;
      mockMarketData.avgTradeSize = (config.SAFETY.MAX_AVG_TRADE_SIZE_USD / 100) - 1;
      mockMarketData.buyCount = 80;
      mockMarketData.sellCount = 20;
      mockMarketData.maxWalletVolumePercentage = config.SAFETY.MAX_SINGLE_WALLET_VOLUME - 5;
      assert.strictEqual(safetyChecker.checkTradingPatterns(mockMarketData), true);
    });
  });

  describe('Holder Distribution Checks', () => {
    it('should reject if not enough holders', () => {
      mockMarketData.holderCount = config.SAFETY.MIN_HOLDERS - 10;
      assert.strictEqual(safetyChecker.checkHolderDistribution(mockMarketData), false);
    });

    it('should reject if holder concentration is too high', () => {
      mockMarketData.topHolderConcentration = config.SAFETY.MAX_TOP_HOLDER_CONCENTRATION + 5;
      assert.strictEqual(safetyChecker.checkHolderDistribution(mockMarketData), false);
    });

    it('should reject if holder wallet age is too low', () => {
      mockMarketData.minHolderWalletAge = config.SAFETY.MIN_HOLDER_WALLET_AGE - 2;
      assert.strictEqual(safetyChecker.checkHolderDistribution(mockMarketData), false);
    });

    it('should accept valid holder distribution', () => {
      mockMarketData.holderCount = config.SAFETY.MIN_HOLDERS + 10;
      mockMarketData.topHolderConcentration = config.SAFETY.MAX_TOP_HOLDER_CONCENTRATION - 5;
      mockMarketData.minHolderWalletAge = config.SAFETY.MIN_HOLDER_WALLET_AGE + 3;
      assert.strictEqual(safetyChecker.checkHolderDistribution(mockMarketData), true);
    });
  });

  describe('Volume Pattern Checks', () => {
    it('should reject if volume-price correlation is too low', () => {
      mockMarketData.volumePriceCorrelation = config.SAFETY.MIN_VOLUME_PRICE_CORRELATION - 0.2;
      assert.strictEqual(safetyChecker.checkVolumePatterns(mockMarketData), false);
    });

    it('should reject if wash trading percentage is too high', () => {
      mockMarketData.suspectedWashTradePercentage = config.SAFETY.MAX_WASH_TRADE_PERCENTAGE + 5;
      assert.strictEqual(safetyChecker.checkVolumePatterns(mockMarketData), false);
    });

    it('should accept valid volume patterns', () => {
      mockMarketData.volumePriceCorrelation = config.SAFETY.MIN_VOLUME_PRICE_CORRELATION + 0.2;
      mockMarketData.suspectedWashTradePercentage = config.SAFETY.MAX_WASH_TRADE_PERCENTAGE - 5;
      assert.strictEqual(safetyChecker.checkVolumePatterns(mockMarketData), true);
    });
  });

  describe('Overall Safety Check', () => {
    it('should accept token with all valid metrics', () => {
      assert.strictEqual(safetyChecker.checkAll(mockMarketData), true);
    });

    it('should reject token with any invalid metric', () => {
      mockMarketData.suspectedWashTradePercentage = config.SAFETY.MAX_WASH_TRADE_PERCENTAGE + 5;
      assert.strictEqual(safetyChecker.checkAll(mockMarketData), false);
    });
  });
});
