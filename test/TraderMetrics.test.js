const { Token } = require('../src/Token');
const { TokenTracker } = require('../src/TokenTracker');
const { expect } = require('chai');

describe('Trader Metrics', () => {
  let token;
  let tokenTracker;
  const mint = 'test-token-mint';
  const trader1 = 'trader1';
  const trader2 = 'trader2';

  beforeEach(() => {
    token = new Token(mint, 'Test Token');
    tokenTracker = new TokenTracker();
    tokenTracker.addToken(token);
  });

  describe('Token Trader Metrics', () => {
    it('should track basic trader statistics', () => {
      // Add some trades
      token.update({
        traderPublicKey: trader1,
        tokenAmount: 100,
        price: 1.0,
        timestamp: Date.now(),
        type: 'buy'
      });

      token.update({
        traderPublicKey: trader2,
        tokenAmount: 200,
        price: 1.1,
        timestamp: Date.now(),
        type: 'buy'
      });

      const metrics = token.getTraderMetrics();
      expect(metrics.totalTraders).to.equal(2);
      expect(metrics.activeTraders).to.equal(2);
      expect(metrics.tradingVolume24h).to.be.greaterThan(0);
    });

    it('should identify whale traders', () => {
      // Add a whale trade (large amount)
      token.update({
        traderPublicKey: trader1,
        tokenAmount: 1000000,
        price: 1.0,
        timestamp: Date.now(),
        type: 'buy'
      });

      const metrics = token.getTraderMetrics();
      expect(metrics.whaleTraders).to.be.greaterThan(0);
    });

    it('should calculate price impact', () => {
      // Add trades with price changes
      token.update({
        traderPublicKey: trader1,
        tokenAmount: 100,
        price: 1.0,
        timestamp: Date.now(),
        type: 'buy'
      });

      token.update({
        traderPublicKey: trader2,
        tokenAmount: 200,
        price: 1.1,
        timestamp: Date.now(),
        type: 'buy'
      });

      const metrics = token.getTraderMetrics();
      expect(metrics.priceImpact.average).to.not.equal(0);
    });
  });

  describe('TokenTracker Trader Metrics', () => {
    it('should track cross-token trading activity', () => {
      const token2 = new Token('test-token-2', 'Test Token 2');
      tokenTracker.addToken(token2);

      // Add trades for both tokens
      token.update({
        traderPublicKey: trader1,
        tokenAmount: 100,
        price: 1.0,
        timestamp: Date.now(),
        type: 'buy'
      });

      token2.update({
        traderPublicKey: trader1,
        tokenAmount: 200,
        price: 1.0,
        timestamp: Date.now(),
        type: 'buy'
      });

      const metrics = tokenTracker.getTraderMetrics();
      expect(metrics.basic.crossTokenTraders).to.equal(1);
    });

    it('should identify correlated traders', () => {
      const timestamp = Date.now();

      // Add similar trading patterns for two traders
      [token].forEach(tok => {
        [trader1, trader2].forEach(trader => {
          tok.update({
            traderPublicKey: trader,
            tokenAmount: 100,
            price: 1.0,
            timestamp: timestamp,
            type: 'buy'
          });

          tok.update({
            traderPublicKey: trader,
            tokenAmount: 100,
            price: 1.1,
            timestamp: timestamp + 1000,
            type: 'sell'
          });
        });
      });

      const metrics = tokenTracker.getTraderMetrics();
      expect(metrics.behavior.correlatedTraders.length).to.be.greaterThan(0);
    });

    it('should calculate risk metrics', () => {
      // Add some trades to generate risk metrics
      token.update({
        traderPublicKey: trader1,
        tokenAmount: 1000000,
        price: 1.0,
        timestamp: Date.now(),
        type: 'buy'
      });

      const metrics = tokenTracker.getTraderMetrics();
      expect(metrics.risk.whaleConcentration).to.be.greaterThan(0);
      expect(metrics.risk.volatilityImpact).to.not.be.undefined;
    });
  });
});
