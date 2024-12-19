const EventEmitter = require('events');
const CLIManager = require('../CLIManager');
const { STATES } = require('../Token');
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

class MockSafetyChecker {
  constructor(options = {}) {
    this.options = {
      liquidityOk: true,
      ageOk: true,
      volumeOk: true,
      marketCapOk: true,
      score: 85,
      ...options
    };
  }

  getScore() {
    return this.options.score;
  }

  checkLiquidity() {
    return this.options.liquidityOk;
  }

  checkAge() {
    return this.options.ageOk;
  }

  checkVolume() {
    return this.options.volumeOk;
  }

  checkMarketCap() {
    return this.options.marketCapOk;
  }
}

// Mock console.log and other dependencies
console.log = jest.fn();

jest.spyOn(process.stdin, 'setRawMode').mockImplementation(() => {});
jest.spyOn(process.stdin, 'resume').mockImplementation(() => {});
jest.spyOn(process.stdin, 'on').mockImplementation(() => {});

describe("CLIManager", () => {
  let cli;
  let mockConfig;
  let mockTokenTracker;
  let mockToken;
  let mockPosition;

  beforeEach(() => {
    // Reset mocks
    mockTokenTracker = new MockTokenTracker();
    mockConfig = {
      logLevel: 'info',
      maxTokens: 10,
      minLiquidity: 1000,
      minAge: 3600000
    };

    mockToken = {
      mint: "mock-token-123",
      symbol: "MOCK",
      marketCapSol: 1000,
      vSolInBondingCurve: 100,
      currentPrice: 1.5,
      minted: Date.now() - 3600000, // 1 hour ago
      safetyChecker: new MockSafetyChecker(),
      stateManager: {
        getCurrentState: () => STATES.READY
      },
      getDrawdownPercentage: () => 5
    };

    mockPosition = {
      mint: "mock-token-123",
      symbol: "MOCK",
      state: "OPEN",
      size: 10,
      entryPrice: 1.0,
      currentPrice: 1.5,
      unrealizedPnLSol: 5,
      unrealizedPnLUsd: 500,
      roiPercentage: 50,
      openedAt: Date.now() - 1800000, // 30 minutes ago
      getTimeInPosition: () => 1800000,
      getAverageEntryPrice: () => 1.0
    };

    cli = new CLIManager(mockConfig, mockTokenTracker);
    cli.isRunning = false;
    
    // Clear any existing data
    cli.activePositions.clear();
    cli.tokenList.clear();
    cli.tradeHistory = [];
    
    // Mock render to prevent side effects
    cli.render = jest.fn();
  });

  afterEach(() => {
    // Stop performance tracking
    cli.cleanup();
    
    // Clear all timers
    jest.clearAllTimers();
    
    // Clear all mocks
    jest.clearAllMocks();
    
    // Remove all event listeners
    cli.removeAllListeners();
    mockTokenTracker.removeAllListeners();
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

    it("should format token list correctly", () => {
      cli.tokenList.set(mockToken.mint, mockToken);
      cli.updateTokenListTable();
      const table = cli.tokenListTable.toString();
      
      expect(table).toContain(mockToken.symbol);
      expect(table).toContain("1h"); // Age format
      expect(table).toContain("1.00K"); // Market cap format
      expect(table).toContain("85%"); // Safety score
      expect(table).toContain("READY"); // Token state
    });

    it("should sort tokens by market cap", () => {
      const tokens = [
        { ...mockToken, mint: "token1", symbol: "TK1", marketCapSol: 1000 },
        { ...mockToken, mint: "token2", symbol: "TK2", marketCapSol: 3000 },
        { ...mockToken, mint: "token3", symbol: "TK3", marketCapSol: 2000 }
      ];

      tokens.forEach(token => cli.tokenList.set(token.mint, token));
      cli.updateTokenListTable();
      const table = cli.tokenListTable.toString();
      
      const tk2Index = table.indexOf("TK2");
      const tk3Index = table.indexOf("TK3");
      const tk1Index = table.indexOf("TK1");
      
      expect(tk2Index).toBeLessThan(tk3Index);
      expect(tk3Index).toBeLessThan(tk1Index);
    });
  });

  describe("Helper Functions", () => {
    describe("formatTime", () => {
      it("should format time durations correctly", () => {
        expect(cli.formatTime(0)).toBe("0s");
        expect(cli.formatTime(1000)).toBe("1s");
        expect(cli.formatTime(60000)).toBe("1m");
        expect(cli.formatTime(3600000)).toBe("1h");
        expect(cli.formatTime(86400000)).toBe("1d");
      });

      it("should handle invalid inputs", () => {
        expect(cli.formatTime(null)).toBe("0s");
        expect(cli.formatTime(-1000)).toBe("0s");
        expect(cli.formatTime(undefined)).toBe("0s");
      });
    });

    describe("formatNumber", () => {
      it("should format numbers with appropriate suffixes", () => {
        expect(cli.formatNumber(0)).toBe("0.00");
        expect(cli.formatNumber(999)).toBe("999.00");
        expect(cli.formatNumber(1000)).toBe("1.00K");
        expect(cli.formatNumber(1000000)).toBe("1.00M");
      });

      it("should handle invalid inputs", () => {
        expect(cli.formatNumber(null)).toBe("0");
        expect(cli.formatNumber(undefined)).toBe("0");
        expect(cli.formatNumber(NaN)).toBe("0");
      });
    });
  });

  describe("Performance Metrics", () => {
    beforeEach(() => {
      cli.activePositions.set(mockPosition.mint, mockPosition);
      cli.tradeHistory.push({
        type: "CLOSE",
        symbol: "MOCK",
        price: 1.5,
        size: 10,
        pnl: 5,
        timestamp: Date.now()
      });
      
      // Update metrics directly without timer
      cli.updatePerformanceMetrics();
    });

    it("should calculate correct performance metrics", () => {
      const metrics = cli.performanceMetrics;

      expect(metrics.totalPnLSol).toBe(5);
      expect(metrics.totalPnLUsd).toBe(500);
      expect(metrics.winRate).toBe(100);
      expect(metrics.avgWin).toBe(5);
      expect(metrics.activePositions).toBe(1);
      expect(metrics.totalTrades).toBe(1);
    });

    it("should format performance table correctly", () => {
      cli.updatePerformanceMetrics();
      cli.updatePerformanceTable();
      const table = cli.performanceTable.toString();

      expect(table).toContain("Total P&L (SOL)");
      expect(table).toContain("5.000");
      expect(table).toContain("Win Rate");
      expect(table).toContain("100.0%");
      expect(table).toContain("Active Positions");
      expect(table).toContain("1");
      expect(table).toContain("30m"); // Average hold time
    });
  });

  describe("Token Safety Analysis", () => {
    it("should gather comprehensive safety information", () => {
      const safetyInfo = cli.getTokenSafetyInfo(mockToken);

      expect(safetyInfo).toEqual({
        score: 85,
        liquidityOk: true,
        ageOk: true,
        volumeOk: true,
        marketCapOk: true,
        drawdownOk: true
      });
    });

    it("should format safety indicators correctly", () => {
      const safetyInfo = cli.getTokenSafetyInfo(mockToken);
      const formatted = cli.formatSafetyIndicators(safetyInfo);

      expect(formatted).toContain("85%");
      expect(formatted).toContain("[LAVMD]");
    });

    it("should handle failed safety checks", () => {
      mockToken.safetyChecker = new MockSafetyChecker({
        liquidityOk: false,
        volumeOk: false,
        score: 40
      });

      const safetyInfo = cli.getTokenSafetyInfo(mockToken);
      const formatted = cli.formatSafetyIndicators(safetyInfo);

      expect(formatted).toContain("40%");
      expect(formatted).toContain("[AMD]");
      expect(formatted).not.toContain("L");
      expect(formatted).not.toContain("V");
    });
  });

  describe("Position Display", () => {
    it("should format position information correctly", () => {
      cli.activePositions.set(mockPosition.mint, mockPosition);
      cli.updatePositionsTable();
      const table = cli.positionsTable.toString();

      expect(table).toContain("MOCK");
      expect(table).toContain("1.000");
      expect(table).toContain("1.500");
      expect(table).toContain("10.000");
      expect(table).toContain("5.000");
      expect(table).toContain("50.0%");
      expect(table).toContain("OPEN");
    });

    it("should handle different position states", () => {
      const states = ["PENDING", "OPEN", "CLOSED"];
      states.forEach(state => {
        const pos = { ...mockPosition, state };
        cli.activePositions.set(pos.mint, pos);
        cli.updatePositionsTable();
        const table = cli.positionsTable.toString();
        expect(table).toContain(state);
      });
    });
  });

  describe("Balance Chart", () => {
    it("should not render chart when insufficient data points", () => {
      cli.balanceHistory = [100];
      const chart = cli.renderBalanceChart();
      expect(chart).toBe("");
    });

    it("should render chart with sufficient data points", () => {
      cli.balanceHistory = [100, 110, 105, 115, 120];
      const chart = cli.renderBalanceChart();
      
      expect(chart).toContain("Balance History (SOL)");
      expect(chart.length).toBeGreaterThan(0);
    });

    it("should limit chart to last 50 data points", () => {
      cli.balanceHistory = Array.from({ length: 100 }, (_, i) => i);
      const chart = cli.renderBalanceChart();
      
      // Chart should only contain the last 50 points
      expect(chart.split("\n").length).toBeLessThan(60); // Account for header and margins
    });
  });
});
