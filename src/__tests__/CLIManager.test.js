const CLIManager = require("../CLIManager");
const { EventEmitter } = require("events");
const chalk = require("chalk");

// Mock dependencies
class MockTokenTracker extends EventEmitter {
  constructor() {
    super();
    this.priceManager = {
      solToUSD: (amount) => amount * 100
    };
  }

  getTokenStats() {
    return {
      total: 3,
      new: 1,
      ready: 1,
      dead: 1,
      avgMarketCapUSD: 200000,
      totalMarketCapUSD: 600000
    };
  }
}

// Mock console.log
console.log = jest.fn();

// Mock process.stdin methods instead of replacing the object
jest.spyOn(process.stdin, 'setRawMode').mockImplementation(() => {});
jest.spyOn(process.stdin, 'resume').mockImplementation(() => {});
jest.spyOn(process.stdin, 'on').mockImplementation(() => {});

describe("CLIManager", () => {
  let cli;
  let mockConfig;
  let mockTokenTracker;

  beforeEach(() => {
    mockConfig = {
      RISK_PER_TRADE: 0.1,
      NOTIFICATIONS: {
        POSITIONS: {
          EXIT: {
            minProfitPercent: 10
          }
        }
      },
      KEYBOARD_SHORTCUTS: {
        TRADING: {
          PAUSE_RESUME: { key: 'space' },
          EMERGENCY_STOP: { key: 'x', requiresConfirmation: true }
        },
        DISPLAY: {
          CLEAR_SCREEN: { key: 'l' },
          TOGGLE_AUTOSCROLL: { key: 'a' },
          TOGGLE_CHARTS: { key: 'c' }
        }
      }
    };
    mockTokenTracker = new MockTokenTracker();
    cli = new CLIManager(mockConfig, mockTokenTracker);
    // Reset isRunning to false for testing
    cli.isRunning = false;
  });

  describe("Trading Controls", () => {
    it("should toggle trading state", () => {
      expect(cli.isRunning).toBe(false);
      
      cli.toggleTrading();
      expect(cli.isRunning).toBe(true);
      
      cli.toggleTrading();
      expect(cli.isRunning).toBe(false);
    });
  });

  describe("Token Management", () => {
    const mockToken = {
      mint: "mock-token-123",
      symbol: "MOCK",
      marketCapSol: 1000,
      volume: 100,
      age: "1m",
      isSafe: true,
      stateManager: {
        getCurrentState: () => "READY"
      }
    };

    it("should update token list when token is added", () => {
      cli.updateToken(mockToken);
      expect(cli.tokenList.has(mockToken.mint)).toBe(true);
      expect(cli.tokenList.get(mockToken.mint)).toBe(mockToken);
    });

    it("should remove token from list when token is removed", () => {
      // First add the token
      cli.updateToken(mockToken);
      expect(cli.tokenList.has(mockToken.mint)).toBe(true);

      // Then remove it
      cli.removeToken(mockToken);
      expect(cli.tokenList.has(mockToken.mint)).toBe(false);
    });

    it("should render token list with correct formatting", () => {
      cli.tokenTracker = mockTokenTracker;
      cli.updateToken(mockToken);
      const tokenList = cli.renderTokenList();
      
      // Check that the token list contains our mock token's data
      expect(tokenList).toContain(mockToken.symbol);
      expect(tokenList).toContain(mockToken.age);
      expect(tokenList).toContain(mockToken.volume.toFixed(3));
      expect(tokenList).toContain("SAFE");
      expect(tokenList).toContain("READY");
    });

    it("should sort tokens by market cap", () => {
      cli.tokenTracker = mockTokenTracker;
      const tokens = [
        { ...mockToken, mint: "token1", symbol: "TK1", marketCapSol: 1000 },
        { ...mockToken, mint: "token2", symbol: "TK2", marketCapSol: 3000 },
        { ...mockToken, mint: "token3", symbol: "TK3", marketCapSol: 2000 }
      ];

      tokens.forEach(token => cli.updateToken(token));
      const tokenList = cli.renderTokenList();
      
      // Check that tokens appear in descending order by market cap
      const lines = tokenList.split("\n").filter(line => line.trim());
      expect(lines.findIndex(line => line.includes("TK2"))).toBeLessThan(
        lines.findIndex(line => line.includes("TK3"))
      );
      expect(lines.findIndex(line => line.includes("TK3"))).toBeLessThan(
        lines.findIndex(line => line.includes("TK1"))
      );
    });

    it("should update performance metrics with token stats", () => {
      cli.tokenTracker = mockTokenTracker;
      const metrics = cli.renderPerformanceMetrics();
      const metricsStr = metrics.toString();
      
      // Check that token stats are included in the correct format
      expect(metricsStr).toContain("Total Tokens");
      expect(metricsStr).toMatch(/Total Tokens.*3/);
      expect(metricsStr).toMatch(/New Tokens.*1/);
      expect(metricsStr).toMatch(/Ready Tokens.*1/);
      expect(metricsStr).toMatch(/Dead Tokens.*1/);
      expect(metricsStr).toMatch(/Avg Market Cap.*\$200000\.00/);
      expect(metricsStr).toMatch(/Total Market Cap.*\$600000\.00/);
    });
  });
});
