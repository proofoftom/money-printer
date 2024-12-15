const { expect } = require('chai');
const ExitStrategies = require('../src/ExitStrategies');

describe('ExitStrategies', () => {
  describe('TieredTakeProfitStrategy', () => {
    let strategy;
    
    beforeEach(() => {
      strategy = new ExitStrategies({
        entryPrice: 100,
        timestamp: Date.now()
      });
    });

    it('should not exit when profit is below first tier (20%)', () => {
      const currentPrice = 119; // 19% profit
      const result = strategy.shouldExit({ currentPrice });
      expect(result.exit).to.be.false;
    });

    it('should exit 40% of position at first tier (20% profit)', () => {
      const currentPrice = 120; // 20% profit
      const result = strategy.shouldExit({ currentPrice });
      expect(result.exit).to.be.true;
      expect(result.portion).to.equal(0.4);
    });

    it('should exit another 40% of position at second tier (40% profit)', () => {
      const currentPrice = 140; // 40% profit
      const result = strategy.shouldExit({ currentPrice });
      expect(result.exit).to.be.true;
      expect(result.portion).to.equal(0.4);
    });

    it('should exit remaining 20% of position at final tier (60% profit)', () => {
      const currentPrice = 160; // 60% profit
      const result = strategy.shouldExit({ currentPrice });
      expect(result.exit).to.be.true;
      expect(result.portion).to.equal(0.2);
    });

    it('should track remaining position after partial exits', () => {
      // First tier exit
      let result = strategy.shouldExit({ currentPrice: 120 });
      expect(result.exit).to.be.true;
      expect(result.portion).to.equal(0.4);
      expect(strategy.remainingPosition).to.equal(0.6);

      // Second tier exit
      result = strategy.shouldExit({ currentPrice: 140 });
      expect(result.exit).to.be.true;
      expect(result.portion).to.equal(0.4);
      expect(strategy.remainingPosition).to.equal(0.2);

      // Final tier exit
      result = strategy.shouldExit({ currentPrice: 160 });
      expect(result.exit).to.be.true;
      expect(result.portion).to.equal(0.2);
      expect(strategy.remainingPosition).to.equal(0);
    });
  });
});
