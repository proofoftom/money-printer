const { TokenStateManager, STATES } = require("../src/TokenStateManager");
const PositionManager = require("../src/PositionManager");
const Token = require("../src/Token");
const { scenarios } = require("./__fixtures__/websocket");

// Mock dependencies
const mockPriceFeed = {
  solToUSD: () => 100,
  getTokenPrice: () => 1,
  subscribeToPrice: jest.fn(),
  unsubscribeFromPrice: jest.fn()
};

describe("Token Lifecycle", () => {
  let token;
  let stateManager;

  beforeEach(() => {
    token = new Token("TEST123", mockPriceFeed);
    stateManager = new TokenStateManager();
    token.stateManager = stateManager;
  });

  describe("Successful Pump Lifecycle", () => {
    it("should transition through all states correctly", () => {
      const messages = scenarios.successfulPump(token.mint);
      
      // Process each message and check state transitions
      messages.forEach(msg => {
        token.processMessage(msg);
        
        // Verify state transitions based on message type and metrics
        switch (token.stateManager.state) {
          case STATES.NEW:
            expect(token.metrics.earlyTrading.uniqueBuyers.size).toBeLessThan(5);
            break;
            
          case STATES.ACCUMULATION:
            expect(token.metrics.earlyTrading.uniqueBuyers.size).toBeGreaterThanOrEqual(5);
            expect(token.metrics.earlyTrading.buyToSellRatio).toBeGreaterThan(1.5);
            break;
            
          case STATES.LAUNCHING:
            expect(token.metrics.earlyTrading.volumeAcceleration).toBeGreaterThan(2.0);
            expect(token.metrics.earlyTrading.creatorSells).toBeFalsy();
            break;
            
          case STATES.PUMPING:
            expect(token.getVolumeSpike()).toBeGreaterThan(3.0);
            break;
        }
      });

      // Final state should be PUMPING
      expect(token.stateManager.state).toBe(STATES.PUMPING);
    });
  });

  describe("Failed Launch Detection", () => {
    it("should detect and handle failed launches", () => {
      const messages = scenarios.failedLaunch(token.mint);
      
      messages.forEach(msg => {
        token.processMessage(msg);
      });

      // Should detect the failed launch
      expect(token.stateManager.state).toBe(STATES.DEAD);
      expect(token.metrics.earlyTrading.buyToSellRatio).toBeLessThan(1.5);
    });
  });

  describe("Creator Dump Detection", () => {
    it("should detect creator dumps", () => {
      const creatorKey = "creator_key";
      const messages = scenarios.creatorDump(token.mint, creatorKey);
      
      messages.forEach(msg => {
        token.processMessage(msg);
        
        // Check creator activity tracking
        if (msg.txType === "sell" && msg.traderPublicKey === creatorKey) {
          expect(token.metrics.earlyTrading.creatorActivity.sellCount).toBeGreaterThan(0);
          expect(token.stateManager.state).toBe(STATES.DEAD);
        }
      });
    });
  });

  describe("Wash Trading Detection", () => {
    it("should detect wash trading patterns", () => {
      const messages = scenarios.washTrading(token.mint);
      
      messages.forEach(msg => {
        token.processMessage(msg);
      });

      // Should have detected wash trading
      expect(token.metrics.earlyTrading.suspiciousActivity).toContain("wash_trading");
      expect(token.metrics.earlyTrading.tradingPatterns.rapidTraders.size).toBeGreaterThan(0);
    });
  });
});
