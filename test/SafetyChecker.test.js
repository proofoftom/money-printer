const { expect } = require('chai');
const SafetyChecker = require('../src/SafetyChecker');

describe('SafetyChecker', () => {
  let safetyChecker;

  beforeEach(() => {
    safetyChecker = new SafetyChecker({
      THRESHOLDS: {
        MIN_HOLDERS: 25,
        MAX_TOP_HOLDER_CONCENTRATION: 30,
        MAX_ENTRY_CAP: 250,
        DEAD: 5,
        MAX_INITIAL_PRICE_MULT: 3,
        MIN_TIME_SINCE_CREATION: 30,
      }
    });
  });

  describe('runSecurityChecks', () => {
    it('should fail initially due to insufficient holders', () => {
      const token = {
        getHolderCount: () => 1,
        getTopHolderConcentration: () => 20,
        hasCreatorFullyExited: () => false
      };
      expect(safetyChecker.runSecurityChecks(token)).to.be.false;
    });

    it('should pass with enough holders and good distribution', () => {
      const token = {
        getHolderCount: () => 30,
        getTopHolderConcentration: () => 20,
        hasCreatorFullyExited: () => true
      };
      expect(safetyChecker.runSecurityChecks(token)).to.be.true;
    });
  });

  describe('holder concentration checks', () => {
    it('should pass when holder concentration is below threshold', () => {
      const token = {
        getTopHolderConcentration: () => 20
      };
      expect(safetyChecker.isHolderConcentrationSafe(token)).to.be.true;
    });

    it('should fail when holder concentration is above threshold', () => {
      const token = {
        getTopHolderConcentration: () => 87
      };
      expect(safetyChecker.isHolderConcentrationSafe(token)).to.be.false;
    });
  });

  describe('creator exit checks', () => {
    it('should detect when creator has exited', () => {
      const token = {
        hasCreatorFullyExited: () => true
      };
      expect(safetyChecker.isCreatorFullyExited(token)).to.be.true;
    });

    it('should detect when creator still holds tokens', () => {
      const token = {
        hasCreatorFullyExited: () => false
      };
      expect(safetyChecker.isCreatorFullyExited(token)).to.be.false;
    });
  });

  describe('Market Cap Checks', () => {
    it('should fail if market cap exceeds maximum threshold', () => {
      const marketData = {
        marketCap: 300,
        creationTime: Date.now() - 60000,
        currentPrice: 1,
        initialPrice: 1
      };
      expect(safetyChecker.isTokenSafe(marketData)).to.be.false;
    });

    it('should fail if market cap is below minimum threshold', () => {
      const marketData = {
        marketCap: 3,
        creationTime: Date.now() - 60000,
        currentPrice: 1,
        initialPrice: 1
      };
      expect(safetyChecker.isTokenSafe(marketData)).to.be.false;
    });

    it('should pass if market cap is within thresholds', () => {
      const marketData = {
        marketCap: 100,
        creationTime: Date.now() - 60000,
        currentPrice: 1,
        initialPrice: 1
      };
      expect(safetyChecker.isTokenSafe(marketData)).to.be.true;
    });
  });

  describe('Time Since Creation Checks', () => {
    it('should fail if token is too new', () => {
      const marketData = {
        marketCap: 100,
        creationTime: Date.now() - 15000, // 15 seconds old
        currentPrice: 1,
        initialPrice: 1
      };
      expect(safetyChecker.isTokenSafe(marketData)).to.be.false;
    });

    it('should pass if token age is sufficient', () => {
      const marketData = {
        marketCap: 100,
        creationTime: Date.now() - 45000, // 45 seconds old
        currentPrice: 1,
        initialPrice: 1
      };
      expect(safetyChecker.isTokenSafe(marketData)).to.be.true;
    });
  });

  describe('Price Multiplier Checks', () => {
    it('should fail if price has pumped too much from initial', () => {
      const marketData = {
        marketCap: 100,
        creationTime: Date.now() - 60000,
        currentPrice: 4,
        initialPrice: 1
      };
      expect(safetyChecker.isTokenSafe(marketData)).to.be.false;
    });

    it('should pass if price multiplier is within threshold', () => {
      const marketData = {
        marketCap: 100,
        creationTime: Date.now() - 60000,
        currentPrice: 2,
        initialPrice: 1
      };
      expect(safetyChecker.isTokenSafe(marketData)).to.be.true;
    });
  });
});
