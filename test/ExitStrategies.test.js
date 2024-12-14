const { expect } = require('chai');
const ExitStrategies = require('../src/ExitStrategies');

describe('ExitStrategies', () => {
  let exitStrategies;
  
  beforeEach(() => {
    exitStrategies = new ExitStrategies({
      trailingStopLoss: {
        enabled: true,
        percentage: 30,
        dynamicAdjustment: {
          enabled: true,
          volatilityMultiplier: 1.5, // Adjust trail % based on volatility
          minPercentage: 20,
          maxPercentage: 40
        }
      },
      trailingTakeProfit: {
        enabled: true,
        initialTrigger: 20,
        trailPercentage: 10,
        dynamicAdjustment: {
          enabled: true,
          volatilityMultiplier: 1.0,
          minPercentage: 5,
          maxPercentage: 15
        }
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

  describe('Dynamic Trail Adjustments', () => {
    it('should calculate volatility correctly', () => {
      const priceHistory = [
        { timestamp: Date.now() - 3600000, price: 100 },
        { timestamp: Date.now() - 2400000, price: 110 },
        { timestamp: Date.now() - 1200000, price: 90 },
        { timestamp: Date.now(), price: 105 }
      ];
      
      const volatility = exitStrategies.calculateVolatility(priceHistory);
      expect(volatility).to.be.a('number');
      expect(volatility).to.be.greaterThan(0);
    });

    it('should adjust stop loss based on volatility', () => {
      const position = {
        entryPrice: 100,
        highestPrice: 150,
        currentPrice: 120,
        priceHistory: [
          { timestamp: Date.now() - 3600000, price: 100 },
          { timestamp: Date.now() - 2400000, price: 150 },
          { timestamp: Date.now() - 1200000, price: 130 },
          { timestamp: Date.now(), price: 120 }
        ]
      };

      const adjustedStopLoss = exitStrategies.calculateDynamicStopLoss(position);
      expect(adjustedStopLoss).to.be.within(20, 40); // Within configured min/max
    });

    it('should adjust take profit trail based on volatility', () => {
      const position = {
        entryPrice: 100,
        highestPrice: 150,
        currentPrice: 140,
        priceHistory: [
          { timestamp: Date.now() - 3600000, price: 100 },
          { timestamp: Date.now() - 2400000, price: 150 },
          { timestamp: Date.now() - 1200000, price: 130 },
          { timestamp: Date.now(), price: 140 }
        ]
      };

      const adjustedTrail = exitStrategies.calculateDynamicTakeProfit(position);
      expect(adjustedTrail).to.be.within(5, 15); // Within configured min/max
    });

    it('should use static percentages when dynamic adjustment is disabled', () => {
      exitStrategies = new ExitStrategies({
        trailingStopLoss: {
          enabled: true,
          percentage: 30,
          dynamicAdjustment: {
            enabled: false
          }
        },
        trailingTakeProfit: {
          enabled: true,
          initialTrigger: 20,
          trailPercentage: 10,
          dynamicAdjustment: {
            enabled: false
          }
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

      const position = {
        entryPrice: 100,
        highestPrice: 150,
        currentPrice: 120,
        priceHistory: [
          { timestamp: Date.now() - 3600000, price: 100 },
          { timestamp: Date.now() - 2400000, price: 150 },
          { timestamp: Date.now() - 1200000, price: 130 },
          { timestamp: Date.now(), price: 120 }
        ]
      };

      expect(exitStrategies.shouldStopLoss(position)).to.be.false;
      position.currentPrice = 100; // 33% drop from 150
      expect(exitStrategies.shouldStopLoss(position)).to.be.true;
    });

    it('should handle missing price history gracefully', () => {
      const position = {
        entryPrice: 100,
        highestPrice: 150,
        currentPrice: 120
      };

      const adjustedStopLoss = exitStrategies.calculateDynamicStopLoss(position);
      expect(adjustedStopLoss).to.equal(30); // Falls back to default
    });
  });

  describe('Trailing Stop Loss', () => {
    it('should trigger stop loss when price drops below trailing threshold', () => {
      const position = {
        entryPrice: 100,
        highestPrice: 150,
        currentPrice: 105
      };
      
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
        highestPrice: 125,
        currentPrice: 120
      };
      
      expect(exitStrategies.shouldTakeProfit(position)).to.be.false;
    });

    it('should trigger take profit when price falls below trailing threshold', () => {
      const position = {
        entryPrice: 100,
        highestPrice: 150,
        currentPrice: 130
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
      expect(portion).to.equal(0.4);
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
        remainingSize: 0.6
      };
      
      const portion = exitStrategies.calculateTierExit(position);
      expect(portion).to.equal(0.4);
    });

    it('should handle final tier correctly', () => {
      const position = {
        entryPrice: 100,
        highestPrice: 205,
        currentPrice: 205,
        remainingSize: 0.2
      };
      
      const portion = exitStrategies.calculateTierExit(position);
      expect(portion).to.equal(0.2);
    });
  });
});
