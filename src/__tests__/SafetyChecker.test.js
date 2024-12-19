const SafetyChecker = require('../SafetyChecker');
const config = require('../config');

describe('SafetyChecker', () => {
  let safetyChecker;
  let mockWallet;
  let mockPriceManager;
  let mockToken;
  
  beforeEach(() => {
    mockWallet = {
      getBalance: jest.fn(() => 10) // 10 SOL balance
    };
    
    mockPriceManager = {
      solToUSD: jest.fn(sol => sol * 100) // 1 SOL = $100
    };
    
    safetyChecker = new SafetyChecker(mockWallet, mockPriceManager);
    
    mockToken = {
      mint: 'test-mint',
      minted: Date.now() - (config.MIN_TOKEN_AGE_SECONDS * 1000 + 1000), // Old enough
      marketCapSol: 0.5, // $50 market cap
      getCurrentPrice: jest.fn(() => 0.1),
      vTokensInBondingCurve: 1000,
      vSolInBondingCurve: 100
    };
  });

  test('accepts token with valid parameters', () => {
    expect(safetyChecker.isTokenSafe(mockToken)).toBe(true);
  });

  test('rejects token that is too young', () => {
    mockToken.minted = Date.now() - 1000; // 1 second old
    expect(safetyChecker.isTokenSafe(mockToken)).toBe(false);
  });

  test('rejects token with market cap too high', () => {
    mockToken.marketCapSol = 2000; // $200k market cap
    expect(safetyChecker.isTokenSafe(mockToken)).toBe(false);
  });

  test('rejects token with unaffordable minimum position', () => {
    mockWallet.getBalance.mockReturnValue(0.0001); // Very low balance
    expect(safetyChecker.isTokenSafe(mockToken)).toBe(false);
  });

  test('rejects token with zero price', () => {
    mockToken.getCurrentPrice.mockReturnValue(0);
    expect(safetyChecker.isTokenSafe(mockToken)).toBe(false);
  });

  test('rejects token with no liquidity', () => {
    mockToken.vTokensInBondingCurve = 0;
    expect(safetyChecker.isTokenSafe(mockToken)).toBe(false);

    mockToken.vTokensInBondingCurve = 1000;
    mockToken.vSolInBondingCurve = 0;
    expect(safetyChecker.isTokenSafe(mockToken)).toBe(false);
  });
});
