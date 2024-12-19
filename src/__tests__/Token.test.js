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
    
    token = new Token(tokenData, {
      priceManager: mockPriceManager,
      safetyChecker: mockSafetyChecker
    });
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

  test('handles trade updates correctly', () => {
    const tradeData = {
      type: 'buy',
      tokenAmount: 100,
      vTokensInBondingCurve: 1100,
      vSolInBondingCurve: 150,
      marketCapSol: 150,
      newTokenBalance: 500
    };

    // Set up event listeners to test events
    const priceChangedHandler = jest.fn();
    const updatedHandler = jest.fn();
    token.on('priceChanged', priceChangedHandler);
    token.on('updated', updatedHandler);

    token.update(tradeData);

    // Check trade tracking properties
    expect(token.lastTradeType).toBe('buy');
    expect(token.lastTradeAmount).toBe(100);
    expect(token.lastTradeTime).toBeDefined();
    expect(token.tokenBalance).toBe(500);

    // Check core token data updates
    expect(token.vTokensInBondingCurve).toBe(1100);
    expect(token.vSolInBondingCurve).toBe(150);
    expect(token.marketCapSol).toBe(150);

    // Check if price changed event was emitted
    expect(priceChangedHandler).toHaveBeenCalledWith({
      token: token,
      oldPrice: 0.1, // 100/1000 from initial setup
      newPrice: token.calculateTokenPrice(), // 150/1100
      tradeType: 'buy'
    });

    // Check if updated event was emitted
    expect(updatedHandler).toHaveBeenCalledWith({
      token: token,
      tradeType: 'buy',
      tradeAmount: 100
    });
  });

  test('handles partial updates correctly', () => {
    const partialUpdate = {
      vTokensInBondingCurve: 1200
    };

    token.update(partialUpdate);
    expect(token.vTokensInBondingCurve).toBe(1200);
    expect(token.vSolInBondingCurve).toBe(100); // Should remain unchanged
    expect(token.marketCapSol).toBe(100); // Should remain unchanged
  });

  test('tracks highest market cap', () => {
    // Initial marketCapSol is 100
    token.update({ marketCapSol: 150 });
    expect(token.highestMarketCap).toBe(150);

    // Lower market cap shouldn't update highestMarketCap
    token.update({ marketCapSol: 120 });
    expect(token.highestMarketCap).toBe(150);

    // Higher market cap should update highestMarketCap
    token.update({ marketCapSol: 200 });
    expect(token.highestMarketCap).toBe(200);
  });
});
