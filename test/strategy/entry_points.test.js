const Position = require('../../src/core/position/Position');
const Token = require('../../src/core/token/Token');

describe('Strategy Entry Points', () => {
  let token;
  let position;

  beforeEach(() => {
    const mockTokenData = {
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
    };

    token = new Token(mockTokenData);
    position = new Position({
      token: token,
      mint: '0x123',
      symbol: 'TEST',
      entryPrice: 1.0,
      size: 100,
      priceHistory: [1.0]
    });
  });

  describe('Market Metrics', () => {
    test('should update price history', () => {
      position.priceHistory = [1.0];
      position.addPriceToHistory(1.1);
      position.addPriceToHistory(1.2);
      
      expect(position.priceHistory).toHaveLength(3);
      expect(position.priceHistory).toEqual([1.0, 1.1, 1.2]);
    });

    test('should calculate correct profit/loss', () => {
      position.priceHistory = [1.0];
      position.addPriceToHistory(1.1); // 10% up
      
      const profitLoss = position.calculateProfitLoss();
      expect(profitLoss).toBeCloseTo(0.1, 2); // 10% profit
    });
  });
});
