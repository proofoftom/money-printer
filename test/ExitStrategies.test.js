const { expect } = require('chai');
const ExitStrategies = require('../src/ExitStrategies');

describe('ExitStrategies', () => {
  let exitStrategies;
  
  beforeEach(() => {
    exitStrategies = new ExitStrategies({
      trailingStopLoss: {
        percentage: 30,
        enabled: true
      },
      trailingTakeProfit: {
        enabled: true,
        initialTrigger: 20, // Start trailing after 20% profit
        trailPercentage: 10 // Trail 10% behind highest price
      },
      tieredTakeProfit: {
        enabled: true,
        tiers: [
          { percentage: 30, portion: 0.4 },
          { percentage: 50, portion: 0.4 },
          { percentage: 100, portion: 0.2 }
        ]
      }
    });
  });

  describe('Trailing Stop Loss', () => {
    it('should trigger stop loss when price drops below trailing threshold', () => {
      const position = {
        entryPrice: 100,
        highestPrice: 150,
        currentPrice: 105
      };
      
      // Price dropped 30% from highest (150 -> 105)
      expect(exitStrategies.shouldStopLoss(position)).to.be.true;
    });

    it('should not trigger stop loss when price is above threshold', () => {
      const position = {
        entryPrice: 100,
        highestPrice: 150,
        currentPrice: 130
      };
      
      expect(exitStrategies.shouldStopLoss(position)).to.be.false;
    });
  });

  describe('Dynamic Trailing Take Profit', () => {
    it('should start trailing after initial trigger is hit', () => {
      const position = {
        entryPrice: 100,
        highestPrice: 125, // 25% up
        currentPrice: 120
      };
      
      expect(exitStrategies.shouldTakeProfit(position)).to.be.false;
    });

    it('should trigger take profit when price falls below trailing threshold', () => {
      const position = {
        entryPrice: 100,
        highestPrice: 150,
        currentPrice: 130 // Dropped more than 10% from high
      };
      
      expect(exitStrategies.shouldTakeProfit(position)).to.be.true;
    });
  });

  describe('Multi-Tier Take Profit', () => {
    it('should calculate correct exit portion for first tier', () => {
      const position = {
        entryPrice: 100,
        highestPrice: 150,
        currentPrice: 150,
        remainingSize: 1.0
      };
      
      const portion = exitStrategies.calculateTierExit(position);
      expect(portion).to.equal(0.4); // First tier at 30%
    });

    it('should return null if no tier is triggered', () => {
      const position = {
        entryPrice: 100,
        highestPrice: 120,
        currentPrice: 120,
        remainingSize: 1.0
      };
      
      const portion = exitStrategies.calculateTierExit(position);
      expect(portion).to.be.null;
    });

    it('should track remaining position size after partial exits', () => {
      const position = {
        entryPrice: 100,
        highestPrice: 160,
        currentPrice: 160,
        remainingSize: 0.6 // After first tier exit
      };
      
      const portion = exitStrategies.calculateTierExit(position);
      expect(portion).to.equal(0.4); // Second tier at 50%
    });

    it('should handle final tier correctly', () => {
      const position = {
        entryPrice: 100,
        highestPrice: 205,
        currentPrice: 205,
        remainingSize: 0.2 // After first two tier exits
      };
      
      const portion = exitStrategies.calculateTierExit(position);
      expect(portion).to.equal(0.2); // Final tier at 100%
    });
  });
});
