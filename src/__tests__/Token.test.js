const Token = require('../Token');
const { STATES } = require('../TokenStateManager');

describe('Token', () => {
  let token;
  let mockPriceManager;
  let mockSafetyChecker;
  
  beforeEach(() => {
    mockPriceManager = {
      solToUSD: jest.fn(sol => sol * 100) // Mock conversion rate: 1 SOL = $100
    };
    
    mockSafetyChecker = {
      isTokenSafe: jest.fn(() => true)
    };
    
    const tokenData = {
      mint: 'test-mint',
      name: 'Test Token',
      symbol: 'TEST',
      minted: Date.now(),
      traderPublicKey: 'trader-key',
      vTokensInBondingCurve: 1000,
      vSolInBondingCurve: 100,
      marketCapSol: 100,
      bondingCurveKey: 'curve-key'
    };
    
    token = new Token(tokenData, mockPriceManager, mockSafetyChecker);
  });

  test('initializes with correct properties', () => {
    expect(token.mint).toBe('test-mint');
    expect(token.symbol).toBe('TEST');
    expect(token.currentPrice).toBe(0.1); // 100 SOL / 1000 tokens
  });

  test('calculates token price correctly', () => {
    expect(token.calculateTokenPrice()).toBe(0.1);
    
    // Test with zero tokens
    token.vTokensInBondingCurve = 0;
    expect(token.calculateTokenPrice()).toBe(0);
  });

  test('calculates drawdown percentage correctly', () => {
    token.highestMarketCap = 100;
    token.marketCapSol = 90;
    expect(token.getDrawdownPercentage()).toBe(10);
    
    // Test with zero highest market cap
    token.highestMarketCap = 0;
    expect(token.getDrawdownPercentage()).toBe(0);
  });

  test('updates token data correctly', () => {
    const updateData = {
      vTokensInBondingCurve: 2000,
      vSolInBondingCurve: 300,
      marketCapSol: 150
    };
    
    token.update(updateData);
    
    expect(token.vTokensInBondingCurve).toBe(2000);
    expect(token.vSolInBondingCurve).toBe(300);
    expect(token.marketCapSol).toBe(150);
    expect(token.highestMarketCap).toBe(150);
  });

  test('transitions to DEAD state on high drawdown', () => {
    const stateChangeSpy = jest.spyOn(token, 'emit');
    
    token.update({
      vTokensInBondingCurve: 1000,
      vSolInBondingCurve: 50, // 50% drop
      marketCapSol: 50
    });
    
    expect(stateChangeSpy).toHaveBeenCalledWith('stateChanged', expect.any(Object));
    expect(token.stateManager.getCurrentState()).toBe(STATES.DEAD);
  });
});
