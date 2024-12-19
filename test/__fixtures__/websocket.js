// Mock WebSocket message factory for pump.fun tokens
const createMockMessage = (overrides = {}) => ({
  txType: "create",
  signature: "mock_signature",
  mint: "5yQxNHfrjLk5rP2xXh2a5ALqDvefDeHuBF4wnvtppump",
  traderPublicKey: "5UuNgYpE41pa7jKJbKvmqjKj4ipHaRHZTYjmDbKUzhyA",
  initialBuy: 60735849.056603,
  bondingCurveKey: "mock_curve_key",
  vTokensInBondingCurve: 1012264150.943397,
  vSolInBondingCurve: 31.799999999999976,
  marketCapSol: 31.414725069897433,
  name: "Test Token",
  symbol: "TEST",
  uri: "mock_uri",
  ...overrides
});

const createBuyMessage = (mint, amount, overrides = {}) => ({
  txType: "buy",
  signature: "mock_signature",
  mint,
  traderPublicKey: "mock_trader",
  tokenAmount: amount,
  newTokenBalance: amount,
  bondingCurveKey: "mock_curve_key",
  vTokensInBondingCurve: 897446022.342982,
  vSolInBondingCurve: 35.86845247356589,
  ...overrides
});

const createSellMessage = (mint, amount, overrides = {}) => ({
  txType: "sell",
  signature: "mock_signature",
  mint,
  traderPublicKey: "mock_trader",
  tokenAmount: amount,
  newTokenBalance: 0,
  bondingCurveKey: "mock_curve_key",
  vTokensInBondingCurve: 897446022.342982,
  vSolInBondingCurve: 35.86845247356589,
  ...overrides
});

// Common test scenarios
const scenarios = {
  successfulPump: (mint) => [
    // Initial creation
    createMockMessage({ mint }),
    
    // Accumulation phase (multiple small buys)
    ...Array(5).fill().map(() => createBuyMessage(mint, 50000)),
    
    // Launch phase (increasing buys)
    createBuyMessage(mint, 100000),
    createBuyMessage(mint, 150000),
    createBuyMessage(mint, 200000),
    
    // Pump phase (large buys)
    createBuyMessage(mint, 500000),
    createBuyMessage(mint, 750000),
    createBuyMessage(mint, 1000000)
  ],

  failedLaunch: (mint) => [
    // Initial creation
    createMockMessage({ mint }),
    
    // Few small buys
    createBuyMessage(mint, 50000),
    createBuyMessage(mint, 75000),
    
    // Early sells
    createSellMessage(mint, 40000),
    createSellMessage(mint, 60000)
  ],

  creatorDump: (mint, creatorKey) => [
    // Initial creation
    createMockMessage({ mint, traderPublicKey: creatorKey }),
    
    // Accumulation phase
    ...Array(3).fill().map(() => createBuyMessage(mint, 50000)),
    
    // Creator starts selling
    createSellMessage(mint, 30000, { traderPublicKey: creatorKey })
  ],

  washTrading: (mint) => {
    const trader = "wash_trader_key";
    return [
      // Initial creation
      createMockMessage({ mint }),
      
      // Rapid buy/sell pattern
      createBuyMessage(mint, 50000, { traderPublicKey: trader }),
      createSellMessage(mint, 50000, { traderPublicKey: trader }),
      createBuyMessage(mint, 60000, { traderPublicKey: trader }),
      createSellMessage(mint, 60000, { traderPublicKey: trader })
    ];
  }
};

module.exports = {
  createMockMessage,
  createBuyMessage,
  createSellMessage,
  scenarios
};
