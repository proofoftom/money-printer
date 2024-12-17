const blessed = require("blessed");
const contrib = require("blessed-contrib");
const errorLogger = require("./errorLoggerInstance");

class Dashboard {
  constructor(
    wallet,
    tokenTracker,
    positionManager,
    safetyChecker,
    priceManager
  ) {
    this.wallet = wallet;
    this.tokenTracker = tokenTracker;
    this.positionManager = positionManager;
    this.safetyChecker = safetyChecker;
    this.priceManager = priceManager;
    this.trades = [];
    this.balanceHistory = {
      x: [],
      y: [],
    };

    // Store original console methods before overriding
    this.originalConsoleLog = console.log;
    this.originalConsoleError = console.error;

    // Override console methods immediately to prevent any logs from bypassing the dashboard
    console.log = (...args) => {
      if (!this.statusBox) {
        this.originalConsoleLog.apply(console, args);
        return;
      }
      this.logStatus(args.join(" "));
    };

    console.error = (...args) => {
      if (!this.statusBox) {
        this.originalConsoleError.apply(console, args);
        return;
      }
      this.logStatus(args.join(" "), "error");
    };

    // Listen for trade events from PositionManager
    this.positionManager.on('trade', (tradeData) => {
      this.logTrade(tradeData);
    });

    // Listen for token price and volume updates
    this.tokenTracker.tokens.forEach(token => {
      token.on('priceUpdate', ({ price, acceleration, pumpMetrics, volume1m, volume5m, volume30m }) => {
        // Store volume data on token for use in display
        token.volume1m = volume1m;
        token.volume5m = volume5m;
        token.volume30m = volume30m;
      });
    });

    // Listen for new tokens
    this.tokenTracker.on('tokenAdded', (token) => {
      token.on('priceUpdate', ({ price, acceleration, pumpMetrics, volume1m, volume5m, volume30m }) => {
        // Store volume data on token for use in display
        token.volume1m = volume1m;
        token.volume5m = volume5m;
        token.volume30m = volume30m;
      });
    });

    this.initializeDashboard();
  }

  initializeDashboard() {
    // Initialize screen
    this.screen = blessed.screen({
      smartCSR: true,
      title: "Money Printer Trading Dashboard",
    });

    // Create grid
    this.grid = new contrib.grid({
      rows: 12,
      cols: 15,
      screen: this.screen,
    });

    this.initializeComponents();
    this.setupEventHandlers();

    // Set up periodic updates
    setInterval(() => this.updateDashboard(), 1000);

    // Initial render
    this.screen.render();
  }

  initializeComponents() {
    // Create wallet status box (1 col)
    this.walletBox = this.grid.set(0, 0, 3, 3, blessed.box, {
      label: " Wallet Status ",
      content: "Initializing...",
      border: { type: "line" },
      style: { border: { fg: "cyan" } },
    });

    // Create recovery metrics box
    this.recoveryBox = this.grid.set(0, 3, 3, 6, blessed.box, {
      label: " Recovery Metrics ",
      content: "Analyzing...",
      border: { type: "line" },
      style: { border: { fg: "yellow" } },
    });

    // Create market structure box
    this.marketStructureBox = this.grid.set(0, 9, 3, 6, blessed.box, {
      label: " Market Structure ",
      content: "Analyzing...",
      border: { type: "line" },
      style: { border: { fg: "green" } },
    });

    // Create active positions table
    this.positionsTable = this.grid.set(3, 0, 4, 15, contrib.table, {
      label: " Active Positions ",
      keys: true,
      interactive: true,
      columnSpacing: 2,
      columnWidth: [8, 10, 10, 10, 8, 10, 12, 12, 12],
      border: { type: "line" },
      style: { border: { fg: "cyan" } },
    });

    // Create token table with recovery metrics
    this.tokenTable = this.grid.set(7, 0, 3, 15, contrib.table, {
      label: " Token Recovery Analysis ",
      keys: true,
      interactive: true,
      columnSpacing: 2,
      columnWidth: [8, 10, 12, 12, 12, 12, 12, 12],
      border: { type: "line" },
      style: { border: { fg: "yellow" } },
    });

    // Create status box
    this.statusBox = this.grid.set(10, 0, 2, 15, blessed.log, {
      label: " Status Log ",
      border: { type: "line" },
      style: { border: { fg: "cyan" } },
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: " ",
        style: { bg: "cyan" },
      },
    });
  }

  setupEventHandlers() {
    // Basic event handler for quitting
    this.screen.key(["escape", "q", "C-c"], () => {
      // Restore original console methods before exiting
      console.log = this.originalConsoleLog;
      console.error = this.originalConsoleError;
      return process.exit(0);
    });

    // Initial status check
    this.logStatus("Initializing dashboard...");

    // Listen for safety check failures
    // this.safetyChecker.on("safetyCheckFailed", ({ token, reason }) => {
    //   this.logStatus(
    //     `Safety check failed for ${token.symbol}: ${reason}`,
    //     "error"
    //   );
    // });
  }

  getWalletStatus() {
    try {
      const stats = this.wallet?.getStats?.() || {};
      return [
        `Balance:   ${this.wallet?.balance?.toFixed(4) || "N/A"} SOL`,
        `P/L Today: ${stats?.todayPnL?.toFixed(4) || "N/A"} SOL`,
        `Total P/L: ${stats?.totalPnL?.toFixed(4) || "N/A"} SOL`,
        `Win Rate:  ${
          stats?.winRate ? (stats.winRate * 100).toFixed(1) : "N/A"
        }%`,
      ].join("\n");
    } catch (error) {
      throw error;
    }
  }

  updateBalanceHistory() {
    try {
      const currentTime = new Date().toLocaleTimeString();
      const currentBalance = this.wallet.balance;

      if (typeof currentBalance === "number" && !isNaN(currentBalance)) {
        this.balanceHistory.x.push(currentTime);
        this.balanceHistory.y.push(currentBalance);

        // Keep last 3600 data points (1 hour of data at 1 point per second)
        if (this.balanceHistory.x.length > 3600) {
          this.balanceHistory.x.shift();
          this.balanceHistory.y.shift();
        }

        // Only show every 60th point on x-axis for readability
        const displayData = {
          x: this.balanceHistory.x.filter((_, i) => i % 60 === 0),
          y: this.balanceHistory.y,
          style: {
            line: "yellow",
          },
        };

        this.balanceChart.setData([displayData]);
      }
    } catch (error) {
      throw error;
    }
  }

  getActivePositions() {
    if (!this.positionManager?.getActivePositions) {
      return "Waiting for position manager...";
    }

    const positions = this.positionManager.getActivePositions();
    if (!positions || positions.length === 0) {
      return "No active positions";
    }

    const positionStrings = positions.map((pos) => {
      // Calculate basic stats
      const pnl = ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
      const holdTime = (Date.now() - pos.entryTime) / 1000;
      const holdTimeStr = holdTime < 60 
        ? `${holdTime.toFixed(0)}s` 
        : `${(holdTime / 60).toFixed(1)}m`;

      // Calculate price velocity (change per minute)
      const priceHistory = pos.priceHistory || [];
      const recentPrices = priceHistory.slice(-5); // Last 5 price points
      const velocity = recentPrices.length > 1
        ? ((recentPrices[recentPrices.length - 1] - recentPrices[0]) / recentPrices[0]) * 100
        : 0;

      // Get volume trends
      const volumeHistory = pos.volumeHistory || [];
      const recentVolume = volumeHistory.slice(-3); // Last 3 volume points
      const volumeTrend = recentVolume.length > 1
        ? ((recentVolume[recentVolume.length - 1] - recentVolume[0]) / recentVolume[0]) * 100
        : 0;

      // Format velocity indicator
      const velocityIndicator = velocity > 0 
        ? '{green-fg}↑' + velocity.toFixed(1) + '%/m{/green-fg}' 
        : '{red-fg}↓' + Math.abs(velocity).toFixed(1) + '%/m{/red-fg}';

      // Format volume trend indicator
      const volumeIndicator = volumeTrend > 0
        ? '{green-fg}↑' + volumeTrend.toFixed(0) + '%{/green-fg}'
        : '{red-fg}↓' + Math.abs(volumeTrend).toFixed(0) + '%{/red-fg}';

      // Calculate profit trend
      const profitTrend = pos.profitHistory || [];
      const recentProfit = profitTrend.slice(-3);
      const profitDirection = recentProfit.length > 1
        ? recentProfit[recentProfit.length - 1] > recentProfit[0] ? "▲" : "▼"
        : "─";

      // Format P/L with color and trend
      const plColor = pnl >= 0 ? 'green' : 'red';
      const plStr = `{${plColor}-fg}${profitDirection} ${Math.abs(pnl).toFixed(1)}%{/${plColor}-fg}`;

      // Get volume in USD
      const volumeUSD = this.priceManager.solToUSD(pos.volume);

      // Build the display string with dynamic data
      return [
        `${pos.mint?.slice(0, 8)}... | ${holdTimeStr} | P/L: ${plStr}`,
        `Price: ${pos.currentPrice?.toFixed(4)} SOL ${velocityIndicator}`,
        `Vol: ${this.formatVolume(pos.volume5m || 0)}$ ${volumeIndicator}`,
        `Entry: ${pos.entryPrice?.toFixed(4)} | High: ${pos.highPrice?.toFixed(4)}`,
        "─".repeat(50) // Separator
      ].join("\n");
    });

    return positionStrings.join("\n");
  }

  logTrade({ type, mint, profitLoss, symbol }) {
    try {
      const timestamp = new Date().toLocaleTimeString();
      const trade = {
        timestamp,
        type,
        mint,
        profitLoss,
        symbol,
      };
      this.trades.unshift(trade);
      // Keep only last 50 trades
      if (this.trades.length > 50) {
        this.trades.pop();
      }
    } catch (error) {
      throw error;
    }
  }

  getTradeHistory() {
    try {
      if (this.trades.length === 0) {
        return "No trades yet";
      }

      return this.trades
        .map((trade) => {
          try {
            const profitLossStr = trade.profitLoss !== undefined && trade.profitLoss !== null
              ? `${trade.profitLoss >= 0 ? "+" : ""}${trade.profitLoss.toFixed(1)}%`
              : "N/A";

            const symbol = trade.symbol || trade.mint?.slice(0, 8) || "Unknown";
            
            // Color code based on trade type and profit/loss
            let tradeColor = "white";
            if (trade.type === "BUY") tradeColor = "yellow";
            else if (trade.type === "SELL" || trade.type === "CLOSE") {
              tradeColor = trade.profitLoss >= 0 ? "green" : "red";
            }

            return `{${tradeColor}-fg}[${trade.timestamp}] {${tradeColor}-fg}${trade.type.padEnd(5)} {/${tradeColor}-fg}{white-fg} ${symbol.padEnd(12)} {/${tradeColor}-fg}{${tradeColor}-fg} ${profitLossStr}{/${tradeColor}-fg}`;
          } catch (err) {
            return `Error formatting trade: ${err.message}`;
          }
        })
        .join("\n");
    } catch (error) {
      return "Error displaying trade history";
    }
  }

  formatVolume(vol) {
    try {
      if (typeof vol !== "number" || isNaN(vol)) return "0";
      if (vol >= 1000) {
        return (vol / 1000).toFixed(1) + "k";
      }
      return Math.floor(vol).toString();
    } catch (error) {
      throw error;
    }
  }

  logStatus(message, type = "info") {
    try {
      if (!this.statusBox) return;
      
      const timestamp = new Date().toLocaleTimeString();
      let formattedMessage = `[${timestamp}] `;
      
      switch (type) {
        case "error":
          formattedMessage += "{red-fg}";
          break;
        case "warning":
          formattedMessage += "{yellow-fg}";
          break;
        case "success":
          formattedMessage += "{green-fg}";
          break;
        default:
          formattedMessage += "{white-fg}";
      }
      
      formattedMessage += message + "{/}";
      this.statusBox.pushLine(formattedMessage);
      this.statusBox.setScrollPerc(100); // Auto-scroll to bottom
      this.screen.render();
    } catch (error) {
      // If there's an error in logging, fall back to original console
      this.originalConsoleError.apply(console, [`Error in logStatus: ${error.message}`]);
    }
  }

  updateDashboard() {
    this.updateWalletStatus();
    this.updateRecoveryMetrics();
    this.updateMarketStructure();
    this.updatePositionsTable();
    this.updateTokenTable();
    this.screen.render();
  }

  updateRecoveryMetrics() {
    const activeTokens = Array.from(this.tokenTracker.tokens.values())
      .filter(token => token.state === "drawdown" || token.state === "recovery");

    if (activeTokens.length === 0) {
      this.recoveryBox.setContent("No tokens in recovery phase");
      return;
    }

    const content = activeTokens.map(token => {
      const strength = token.getRecoveryStrength();
      const drawdown = token.getDrawdownPercentage();
      return [
        `${token.symbol}:`,
        `Strength: ${strength.total.toFixed(1)}%`,
        `Buy Press: ${strength.breakdown.buyPressure.buyRatio.toFixed(2)}`,
        `Drawdown: ${drawdown.toFixed(1)}%`
      ].join("\n");
    }).join("\n\n");

    this.recoveryBox.setContent(content);
  }

  updateMarketStructure() {
    const activeTokens = Array.from(this.tokenTracker.tokens.values())
      .filter(token => token.state === "drawdown" || token.state === "recovery");

    if (activeTokens.length === 0) {
      this.marketStructureBox.setContent("No active tokens");
      return;
    }

    const content = activeTokens.map(token => {
      const structure = token.analyzeMarketStructure();
      return [
        `${token.symbol}:`,
        `Health: ${structure.overallHealth.toFixed(1)}%`,
        `Pattern: ${structure.pattern?.type || 'None'}`,
        `Confidence: ${structure.pattern?.confidence.toFixed(1) || 0}%`
      ].join("\n");
    }).join("\n\n");

    this.marketStructureBox.setContent(content);
  }

  updatePositionsTable() {
    const positions = this.positionManager.getPositions();
    const data = {
      headers: ["Symbol", "Entry", "Current", "Size", "PnL%", "Strength", "Structure", "Volume", "Status"],
      data: positions.map(pos => {
        const token = this.tokenTracker.getToken(pos.mint);
        const strength = token.getRecoveryStrength();
        const structure = token.analyzeMarketStructure();
        const pnl = ((pos.currentPrice - pos.entryPrice) / pos.entryPrice * 100);
        
        return [
          pos.symbol,
          pos.entryPrice.toFixed(8),
          pos.currentPrice.toFixed(8),
          pos.remainingSize.toFixed(2),
          pnl.toFixed(1) + "%",
          strength.total.toFixed(1) + "%",
          structure.overallHealth.toFixed(1) + "%",
          (pos.volume5m / pos.volume30m).toFixed(2),
          this.getPositionStatus(pos, token)
        ];
      }),
    };

    this.positionsTable.setData(data);
  }

  updateTokenTable() {
    const tokens = Array.from(this.tokenTracker.tokens.values())
      .filter(token => ["drawdown", "recovery"].includes(token.state));

    const data = {
      headers: ["Symbol", "State", "Drawdown%", "Recovery%", "Strength", "Structure", "Buy Press", "Volume"],
      data: tokens.map(token => {
        const strength = token.getRecoveryStrength();
        const structure = token.analyzeMarketStructure();
        const drawdown = token.getDrawdownPercentage();
        const recovery = token.getRecoveryPercentage();
        
        return [
          token.symbol,
          token.state,
          drawdown.toFixed(1) + "%",
          recovery.toFixed(1) + "%",
          strength.total.toFixed(1) + "%",
          structure.overallHealth.toFixed(1) + "%",
          strength.breakdown.buyPressure.buyRatio.toFixed(2),
          (token.volume5m / token.volume30m).toFixed(2)
        ];
      }),
    };

    this.tokenTable.setData(data);
  }

  getPositionStatus(position, token) {
    const strength = token.getRecoveryStrength();
    const structure = token.analyzeMarketStructure();
    
    if (strength.total < config.EXIT_STRATEGIES.RECOVERY.MIN_STRENGTH) {
      return "WEAK";
    }
    if (structure.overallHealth < config.EXIT_STRATEGIES.RECOVERY.MIN_STRUCTURE_SCORE) {
      return "UNSTABLE";
    }
    return "HEALTHY";
  }
}

module.exports = Dashboard;
