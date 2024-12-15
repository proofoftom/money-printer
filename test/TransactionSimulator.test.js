const { expect } = require('chai');
const sinon = require('sinon');
const TransactionSimulator = require('../src/TransactionSimulator');

describe('TransactionSimulator', () => {
  let simulator;
  let clock;

  beforeEach(() => {
    simulator = new TransactionSimulator();
    clock = sinon.useFakeTimers();
  });

  afterEach(() => {
    clock.restore();
  });

  describe('simulateTransactionDelay', () => {
    it('should return 0 when simulation is disabled', async () => {
      simulator.config.ENABLED = false;
      const delay = await simulator.simulateTransactionDelay();
      expect(delay).to.equal(0);
    });

    it('should simulate delay within expected range when enabled', async () => {
      simulator.config.ENABLED = true;
      const promise = simulator.simulateTransactionDelay();
      
      // Fast-forward maximum possible time
      const maxDelay = simulator.config.NETWORK_DELAY.MAX_MS * simulator.config.NETWORK_DELAY.CONGESTION_MULTIPLIER + 
                      simulator.config.AVG_BLOCK_TIME * 1000;
      clock.tick(maxDelay);
      
      const delay = await promise;
      expect(delay).to.be.at.least(simulator.config.NETWORK_DELAY.MIN_MS);
      expect(delay).to.be.at.most(maxDelay);
    });
  });

  describe('calculatePriceImpact', () => {
    it('should return original price when simulation is disabled', () => {
      simulator.config.ENABLED = false;
      const price = simulator.calculatePriceImpact(1, 100, 1000);
      expect(price).to.equal(100);
    });

    it.skip('should calculate price impact based on trade size', () => {
      const tradeSizeSOL = 100;
      const currentPrice = 100;
      const volumeSOL = 1000;
      
      // Mock the config for consistent test results
      simulator.config.PRICE_IMPACT = {
        ENABLED: true,
        SLIPPAGE_BASE: 0.5, // 0.5% base slippage
        VOLUME_MULTIPLIER: 0.1 // 0.1% per unit of volume ratio
      };
      
      const price = simulator.calculatePriceImpact(tradeSizeSOL, currentPrice, volumeSOL);
      
      // Base slippage (0.5%) + Volume impact (100/1000 * 0.1) = 0.5% + 0.01% = 0.51%
      const expectedPrice = currentPrice * (1 + 0.0051);
      expect(price).to.be.closeTo(expectedPrice, 0.01);
    });
  });

  describe('calculateNetworkDelay', () => {
    it('should return delay within configured bounds', () => {
      const delay = simulator.calculateNetworkDelay();
      expect(delay).to.be.at.least(simulator.config.NETWORK_DELAY.MIN_MS);
      expect(delay).to.be.at.most(
        simulator.config.NETWORK_DELAY.MAX_MS * simulator.config.NETWORK_DELAY.CONGESTION_MULTIPLIER
      );
    });
  });
});
