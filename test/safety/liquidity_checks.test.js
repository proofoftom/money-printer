const SafetyChecker = require('../../src/services/safety/SafetyChecker');

describe('Liquidity Safety Checks', () => {
  let safetyChecker;
  let mockToken;
  let mockTraderManager;

  beforeEach(() => {
    jest.clearAllMocks();

    const safetyConfig = {
      MIN_LIQUIDITY_SOL: 10,
      MIN_VOLUME_24H: 1000,
      MIN_HOLDERS: 100,
      MAX_WALLET_CONCENTRATION: 0.2
    };

    mockToken = {
      mint: 'mock-mint',
      getLiquidity: jest.fn().mockReturnValue(20), // Above MIN_LIQUIDITY_SOL
      getVolume24h: jest.fn().mockReturnValue(2000), // Above MIN_VOLUME_24H
      getHolderCount: jest.fn().mockReturnValue(200), // Above MIN_HOLDERS
      getMaxWalletConcentration: jest.fn().mockReturnValue(0.1), // Below MAX_WALLET_CONCENTRATION
      getTraderCount: jest.fn().mockReturnValue(100),
      getTopHolderConcentration: jest.fn().mockReturnValue(0.3),
      getMarketCap: jest.fn().mockReturnValue(100),
      getCurrentPrice: jest.fn().mockReturnValue(10)
    };

    mockTraderManager = {
      getTraderCount: jest.fn().mockReturnValue(100),
      getActiveTraders: jest.fn().mockReturnValue(new Set(['trader1', 'trader2'])),
      getTraderActivity: jest.fn().mockReturnValue({
        trades: 50,
        volume: 1000
      })
    };

    safetyChecker = new SafetyChecker(mockTraderManager, null, safetyConfig);
  });

  describe('Liquidity Depth Analysis', () => {
    test('should calculate accurate liquidity depth', async () => {
      const result = await safetyChecker.runSecurityChecks(mockToken);
      expect(result.passed).toBeTruthy();
      expect(mockToken.getLiquidity).toHaveBeenCalled();
    });

    test('should detect dangerous liquidity conditions', async () => {
      mockToken.getLiquidity = jest.fn().mockReturnValue(5); // Below MIN_LIQUIDITY_SOL
      const result = await safetyChecker.runSecurityChecks(mockToken);
      expect(result.passed).toBeFalsy();
      expect(result.reason).toBe('Insufficient liquidity');
    });
  });

  describe('Position Size vs Liquidity', () => {
    test('should validate position size against available liquidity', async () => {
      const liquidity = mockToken.getLiquidity();
      const positionSize = 10; // Less than liquidity
      expect(positionSize).toBeLessThan(liquidity);
      const result = await safetyChecker.runSecurityChecks(mockToken);
      expect(result.passed).toBeTruthy();
    });

    test('should adjust position size based on liquidity constraints', async () => {
      mockToken.getLiquidity = jest.fn().mockReturnValue(5); // Low liquidity
      const result = await safetyChecker.runSecurityChecks(mockToken);
      expect(result.passed).toBeFalsy();
      expect(result.reason).toBe('Insufficient liquidity');
    });
  });

  describe('Liquidity Checks', () => {
    it('should pass when all liquidity metrics are good', async () => {
      const result = await safetyChecker.runSecurityChecks(mockToken);
      
      expect(result.passed).toBe(true);
      expect(mockToken.getTraderCount).toHaveBeenCalled();
      expect(mockToken.getHolderCount).toHaveBeenCalled();
    });

    it('should fail when trader count is too low', async () => {
      mockToken.getTraderCount.mockReturnValue(5);
      
      const result = await safetyChecker.runSecurityChecks(mockToken);
      
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('trader count');
    });

    it('should fail when holder concentration is too high', async () => {
      mockToken.getTopHolderConcentration.mockReturnValue(0.8);
      
      const result = await safetyChecker.runSecurityChecks(mockToken);
      
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('holder concentration');
    });

    it('should fail when market cap is too low', async () => {
      mockToken.getMarketCap.mockReturnValue(5);
      
      const result = await safetyChecker.runSecurityChecks(mockToken);
      
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('market cap');
    });
  });

  describe('Trading Activity Checks', () => {
    it('should pass when trading activity is healthy', async () => {
      const result = await safetyChecker.checkTradingActivity(mockToken);
      
      expect(result.passed).toBe(true);
      expect(mockToken.getVolume24h).toHaveBeenCalled();
    });

    it('should fail when volume is too low', async () => {
      mockToken.getVolume24h.mockReturnValue(10);
      
      const result = await safetyChecker.checkTradingActivity(mockToken);
      
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('volume');
    });
  });

  describe('Price Checks', () => {
    it('should pass when price metrics are healthy', async () => {
      const result = await safetyChecker.checkPriceMetrics(mockToken);
      
      expect(result.passed).toBe(true);
      expect(mockToken.getCurrentPrice).toHaveBeenCalled();
    });

    it('should fail when price is too low', async () => {
      mockToken.getCurrentPrice.mockReturnValue(0.1);
      
      const result = await safetyChecker.checkPriceMetrics(mockToken);
      
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('price');
    });
  });
});
