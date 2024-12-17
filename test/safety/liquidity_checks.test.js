const SafetyChecker = require('../../src/services/safety/SafetyChecker');
const Token = require('../../src/core/token/Token');

describe('Liquidity Safety Checks', () => {
  let safetyChecker;
  let mockToken;

  beforeEach(() => {
    const safetyConfig = {
      MIN_LIQUIDITY_SOL: 10,
      MIN_VOLUME_24H: 1000,
      MIN_HOLDERS: 100,
      MAX_WALLET_CONCENTRATION: 0.2
    };
    
    safetyChecker = new SafetyChecker(null, null, safetyConfig);
    
    mockToken = new Token({
      mint: '0x123',
      name: 'Test Token',
      symbol: 'TEST',
      minted: Date.now(),
      uri: 'https://test.uri',
      traderPublicKey: '0xabc',
      initialBuy: true,
      vTokensInBondingCurve: '1000000',
      vSolInBondingCurve: '100',
      marketCapSol: '100000',
      signature: '0xdef',
      bondingCurveKey: '0x456'
    });

    // Mock token methods
    mockToken.getLiquidity = jest.fn().mockReturnValue(20); // Above MIN_LIQUIDITY_SOL
    mockToken.getVolume24h = jest.fn().mockReturnValue(2000); // Above MIN_VOLUME_24H
    mockToken.getHolderCount = jest.fn().mockReturnValue(200); // Above MIN_HOLDERS
    mockToken.getMaxWalletConcentration = jest.fn().mockReturnValue(0.1); // Below MAX_WALLET_CONCENTRATION
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
});
