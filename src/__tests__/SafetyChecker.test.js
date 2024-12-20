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
    const result = safetyChecker.isTokenSafe(mockToken);
    expect(result.safe).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  test('rejects token that is too young', () => {
    mockToken.minted = Date.now() - 1000; // 1 second old
    const result = safetyChecker.isTokenSafe(mockToken);
    expect(result.safe).toBe(false);
    expect(result.reasons).toContainEqual(`Token too new (1s < ${config.MIN_TOKEN_AGE_SECONDS}s)`);
  });

  test('rejects token with market cap too high', () => {
    mockToken.marketCapSol = 2000; // $200k market cap
    const result = safetyChecker.isTokenSafe(mockToken);
    expect(result.safe).toBe(false);
    expect(result.reasons).toContainEqual('Market cap too high ($200000 > $100000)');
  });

  test('rejects token with unaffordable minimum position', () => {
    mockWallet.getBalance.mockReturnValue(0.0001); // Very low balance
    const result = safetyChecker.isTokenSafe(mockToken);
    expect(result.safe).toBe(false);
    expect(result.reasons).toContainEqual('Insufficient balance for min position (0.001 SOL needed)');
  });

  test('rejects token with zero price', () => {
    mockToken.getCurrentPrice.mockReturnValue(0);
    const result = safetyChecker.isTokenSafe(mockToken);
    expect(result.safe).toBe(false);
    expect(result.reasons).toContainEqual('Zero or negative price');
  });

  test('rejects token with no liquidity', () => {
    mockToken.vTokensInBondingCurve = 0;
    const result = safetyChecker.isTokenSafe(mockToken);
    expect(result.safe).toBe(false);
    expect(result.reasons).toContainEqual('Insufficient bonding curve liquidity');

    mockToken.vTokensInBondingCurve = 1000;
    mockToken.vSolInBondingCurve = 0;
    const result2 = safetyChecker.isTokenSafe(mockToken);
    expect(result2.safe).toBe(false);
    expect(result2.reasons).toContainEqual('Insufficient bonding curve liquidity');
  });
});
