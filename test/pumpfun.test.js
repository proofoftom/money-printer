const { expect } = require("chai");
const { TokenStateManager, STATES } = require("../src/TokenStateManager");
const PositionManager = require("../src/PositionManager");
const Token = require("../src/Token");

jest.mock("../src/config", () => ({
  SIMULATION_MODE: true,
  TRANSACTION: {
    SIMULATION_MODE: {
      ENABLED: true,
      AVG_BLOCK_TIME: 0.4,
      PRICE_IMPACT: {
        ENABLED: true,
        SLIPPAGE_BASE: 1,
        VOLUME_MULTIPLIER: 0.5
      }
    }
  },
  POSITION_MANAGER: {
    CLEAR_ON_STARTUP: false,
    BASE_POSITION_SIZE: 1.0,
    MIN_ENTRY_CONFIDENCE: 40,
    CONFIDENCE_MULTIPLIERS: {
      HIGH: 1.5,
      MEDIUM_HIGH: 1.25,
      MEDIUM: 1.0,
      MEDIUM_LOW: 0.75,
      LOW: 0.5
    },
    STATE_MULTIPLIERS: {
      ACCUMULATION: 1.0,
      LAUNCHING: 1.25,
      PUMPING: 1.5
    },
    PARTIAL_EXIT: {
      CREATOR_SELL: 0.25,
      SUSPICIOUS_TRADING: 0.5,
      BUY_PRESSURE_DROP: 0.25
    },
    STOP_LOSS: {
      PRICE_DROP: 0.3,
      TIME_WINDOW: 300
    }
  },
  SAFETY: {
    MIN_UNIQUE_BUYERS: 5,
    MIN_BUY_SELL_RATIO: 1.5,
    MIN_VOLUME_ACCELERATION: 2.0,
    MIN_BUY_PRESSURE: 0.6,
    PUMP_DETECTION: {
      MIN_GAIN_RATE: 2.0,
      MIN_PRICE_GAIN: 20,
      MIN_VOLUME_SPIKE: 3.0
    }
  }
}));

// Mock price feed
const mockPriceFeed = {
  solToUSD: () => 225,
  getTokenPrice: () => 1,
  subscribeToPrice: () => {},
  unsubscribeFromPrice: () => {},
  getPrice: jest.fn().mockResolvedValue(1.0),
  getVolume: jest.fn().mockResolvedValue(1000)
};

// Mock TransactionSimulator
const mockTransactionSimulator = {
  simulateTransactionDelay: async () => 100,
  calculatePriceImpact: () => 1.0,
  simulateTransactionDelay: jest.fn().mockResolvedValue(100),
  calculatePriceImpact: jest.fn().mockReturnValue(1.01)
};

describe("Pump.fun Token Sniping", () => {
  let token, stateManager, positionManager;

  beforeEach(() => {
    // Initialize token with mock price feed
    token = new Token("TEST123", mockPriceFeed, mockTransactionSimulator);
    token.currentPrice = { bodyPrice: 1.0 }; // Mock current price

    stateManager = new TokenStateManager();
    positionManager = new PositionManager({
      balance: 10,
      updateBalance: () => {},
      recordTrade: () => {},
    });
    positionManager.transactionSimulator = mockTransactionSimulator;

    // Initialize required metrics
    token.metrics = {
      earlyTrading: {
        uniqueBuyers: 0,
        buyToSellRatio: 0,
        volumeAcceleration: 0,
        suspiciousActivity: [],
        creatorSells: false,
        volumeProfile: {},
        buyPressure: { current: 0 },
        creatorActivity: { sellVolume: 0, sellCount: 0 },
        tradingPatterns: {
          rapidTraders: new Set(),
          alternatingTraders: new Set(),
        },
      },
    };
  });

  describe("Early Detection", () => {
    it("should detect accumulation phase", async () => {
      // Setup early trading metrics
      token.metrics.earlyTrading = {
        uniqueBuyers: 5 + 1,
        buyToSellRatio: 1.5 + 0.2,
        volumeAcceleration: 0,
        suspiciousActivity: [],
        creatorSells: false,
      };

      const accumulation = stateManager.detectAccumulation(token);
      expect(accumulation).to.be.true;
    });

    it("should detect launch phase", async () => {
      token.metrics.earlyTrading = {
        volumeAcceleration: 2.0 + 1,
        buyToSellRatio: 1.5 * 2,
        creatorSells: false,
      };

      const launching = stateManager.detectLaunch(token);
      expect(launching).to.be.true;
    });

    it("should reject suspicious activity", async () => {
      token.metrics.earlyTrading = {
        uniqueBuyers: 5 + 1,
        buyToSellRatio: 1.5 + 0.2,
        volumeAcceleration: 0,
        suspiciousActivity: ["wash_trading"],
        creatorSells: false,
      };

      const accumulation = stateManager.detectAccumulation(token);
      expect(accumulation).to.be.false;
    });
  });

  describe("Position Sizing", () => {
    it("should scale position size based on confidence", async () => {
      // Test different confidence levels
      const highConfidence = positionManager.calculateConfidenceMultiplier(95);
      const mediumConfidence =
        positionManager.calculateConfidenceMultiplier(75);
      const lowConfidence = positionManager.calculateConfidenceMultiplier(35);

      expect(highConfidence).to.equal(1.5);
      expect(mediumConfidence).to.equal(1.0);
      expect(lowConfidence).to.equal(0.5);
    });

    it("should adjust size based on token state", async () => {
      const accumulationSize =
        positionManager.calculateStateMultiplier("ACCUMULATION");
      const launchingSize =
        positionManager.calculateStateMultiplier("LAUNCHING");
      const pumpingSize = positionManager.calculateStateMultiplier("PUMPING");

      expect(accumulationSize).to.equal(1.0); 
      expect(launchingSize).to.equal(1.25); 
      expect(pumpingSize).to.equal(1.5); 
    });
  });

  describe("Exit Triggers", () => {
    let position;

    beforeEach(() => {
      position = {
        entryState: "LAUNCHING",
        metrics: {
          buyPressure: { current: 100 },
          tradingPatterns: {
            rapidTraders: new Set(["trader1"]),
          },
        },
        size: 1.0,
      };
    });

    it("should exit on creator dumping", async () => {
      token.metrics.earlyTrading = {
        creatorActivity: { sellVolume: position.size * 0.6 }, // 60% of position size
        buyPressure: { current: 100 },
        tradingPatterns: { rapidTraders: new Set(["trader1"]) },
      };

      const shouldExit = await positionManager.checkExitConditions(
        position,
        token
      );
      expect(shouldExit).to.be.true;
    });

    it("should exit on severe buy pressure decline", async () => {
      token.metrics.earlyTrading = {
        creatorActivity: { sellVolume: 0 },
        buyPressure: { current: 40 }, // 60% decline
        tradingPatterns: { rapidTraders: new Set(["trader1"]) },
      };

      const shouldExit = await positionManager.checkExitConditions(
        position,
        token
      );
      expect(shouldExit).to.be.true;
    });

    it("should trigger partial exit on moderate decline", async () => {
      token.metrics.earlyTrading = {
        buyPressure: { current: 65 }, // 35% decline
        creatorActivity: { sellCount: 0 },
        tradingPatterns: { rapidTraders: new Set(["trader1"]) },
      };

      const exitSize = positionManager.calculatePartialExitSize(
        position,
        token
      );
      expect(exitSize).to.equal(0.25); // 25% partial exit
    });
  });
});
