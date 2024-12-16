const blessed = require("blessed");
const contrib = require("blessed-contrib");

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
      const message = args.join(" ");
      if (!this.statusBox) {
        this.originalConsoleLog.apply(console, args);
      } else {
        this.logStatus(message);
      }
      this.writeToLogFile(message, 'info');
    };

    console.error = (...args) => {
      const message = args.join(" ");
      const stack = new Error().stack;
      const fullError = `${message}\n${stack}`;
      
      if (!this.statusBox) {
        this.originalConsoleError.apply(console, args);
      } else {
        this.logStatus(message, "error");
      }
      this.writeToLogFile(fullError, 'error');
    };

    // Add method to write to log file
    this.writeToLogFile = (message, level = 'info') => {
      const fs = require('fs');
      const path = require('path');
      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        level,
        message
      };

      try {
        const logDir = path.join(__dirname, '..', 'logs', level === 'error' ? 'errors' : 'info');
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }

        const today = new Date().toISOString().split('T')[0];
        const logFile = path.join(logDir, `${level === 'error' ? 'errors' : 'info'}_${today}.json`);

        let logs = [];
        if (fs.existsSync(logFile)) {
          const content = fs.readFileSync(logFile, 'utf8');
          logs = content ? JSON.parse(content) : [];
        }

        logs.push(logEntry);
        fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
      } catch (err) {
        this.originalConsoleError.apply(console, [`Error writing to log file: ${err.message}`]);
      }
    };

    // Listen for trade events from PositionManager
    this.positionManager.on("trade", (tradeData) => {
      this.logTrade(tradeData);
    });

    // Listen for trader events
    this.tokenTracker.on("traderTradeAdded", ({ trader, mint, trade }) => {
      this.updateTraderStats();
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
    // Create wallet status box (top row)
    this.walletBox = this.grid.set(0, 0, 3, 3, blessed.box, {
      label: " Wallet Status ",
      content: "Initializing...",
      border: "line",
      tags: false,
      padding: 1,
      style: {
        label: { bold: true },
      },
    });

    // Create balance history (top row)
    this.balanceChart = this.grid.set(0, 3, 3, 12, contrib.line, {
      style: {
        line: "yellow",
        text: "green",
        baseline: "black",
      },
      xLabelPadding: 3,
      xPadding: 5,
      label: " Balance History ",
      showLegend: true,
    });

    // Token State Columns (4 equal columns)
    this.heatingUpBox = this.grid.set(3, 0, 6, 3, blessed.log, {
      label: " Heating Up ",
      tags: true,
      border: "line",
      style: {
        label: { bold: true },
      },
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: " ",
        inverse: true,
      },
    });

    this.activeBox = this.grid.set(3, 3, 6, 3, blessed.log, {
      label: " Active ",
      tags: true,
      border: "line",
      style: {
        label: { bold: true },
      },
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: " ",
        inverse: true,
      },
    });

    this.drawdownBox = this.grid.set(3, 6, 6, 3, blessed.log, {
      label: " Drawdown ",
      tags: true,
      border: "line",
      style: {
        label: { bold: true },
      },
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: " ",
        inverse: true,
      },
    });

    this.positionsBox = this.grid.set(3, 9, 6, 3, blessed.log, {
      label: " Open Positions ",
      tags: true,
      border: "line",
      style: {
        label: { bold: true },
      },
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: " ",
        inverse: true,
      },
    });

    // Add token states list
    this.tokenStatesList = this.grid.set(3, 12, 6, 3, contrib.table, {
      label: " Token States ",
      keys: true,
      fg: 'white',
      selectedFg: 'white',
      selectedBg: 'blue',
      interactive: true,
      border: {
        type: "line",
        fg: "cyan"
      },
      columnSpacing: 2,
      columnWidth: [8, 8, 8, 8]
    });

    // Bottom row split between trader stats and whale activity
    this.traderStatsBox = this.grid.set(9, 0, 3, 6, blessed.box, {
      label: " Trader Statistics ",
      tags: true,
      border: "line",
      style: {
        label: { bold: true },
      },
      padding: 1,
    });

    this.whaleActivityBox = this.grid.set(9, 6, 3, 6, blessed.log, {
      label: " Whale Activity ",
      tags: true,
      border: "line",
      style: {
        label: { bold: true },
      },
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: " ",
        inverse: true,
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
      if (!this.wallet?.balance) {
        throw new Error('Wallet not properly initialized');
      }

      const balance = this.wallet.balance;
      const now = new Date().toLocaleTimeString();

      // Add new data points
      this.balanceHistory.x.push(now);
      this.balanceHistory.y.push(balance);

      // Keep only the last 1000 points to prevent memory issues
      if (this.balanceHistory.x.length > 1000) {
        this.balanceHistory.x.shift();
        this.balanceHistory.y.shift();
      }

      // Only update chart if we have data and the chart exists
      if (this.balanceHistory.x.length > 0 && this.balanceChart) {
        // Only show every 60th point on x-axis for readability
        const xPoints = this.balanceHistory.x.filter((_, i) => i % 60 === 0);
        const yPoints = this.balanceHistory.y;

        const displayData = {
          title: "Balance History",
          x: xPoints.length > 0 ? xPoints : [now],
          y: yPoints.length > 0 ? yPoints : [balance],
          style: { line: "yellow" },
        };

        this.balanceChart.setData([displayData]);
      }
    } catch (error) {
      throw new Error(`Error updating balance history: ${error.message}`);
    }
  }

  logTrade({ type, mint, profitLoss, symbol }) {
    try {
      const timestamp = new Date().toLocaleTimeString();
      const trade = `[${timestamp}] ${type} ${symbol} (${mint}): ${
        profitLoss >= 0 ? "{green-fg}" : "{red-fg}"
      }${profitLoss >= 0 ? "+" : ""}${profitLoss.toFixed(2)} SOL{/}`;
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
    return this.trades.slice(0, 10).join("\n") || "No trades yet...";
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
      this.originalConsoleError.apply(console, [
        `Error in logStatus: ${error.message}`,
      ]);
    }
  }

  updateDashboard() {
    this.updateWalletStatus();
    this.updateBalanceChart();
    this.updateTokenStates();
    this.updatePositions();
    this.updateTraderStats();
    this.updateWhaleActivity();
    this.screen.render();
  }

  updateTokenStates() {
    try {
      if (!this.tokenTracker) {
        throw new Error('Token tracker not initialized');
      }

      const tokens = this.tokenTracker.getTokens();
      if (!tokens || !this.tokenStatesList) {
        throw new Error('Token states or tokenStatesList not available');
      }

      // Format token states for display
      const formattedStates = Array.from(tokens.entries())
        .map(([mint, token]) => {
          if (!token) return null;
          return {
            mint: mint.slice(0, 8) + '...',
            price: token.currentPrice?.toFixed(4) || 'N/A',
            volume: token.volume?.toFixed(2) || 'N/A',
            holders: token.holders || 'N/A'
          };
        })
        .filter(state => state !== null);

      if (formattedStates.length > 0 && this.tokenStatesList) {
        this.tokenStatesList.setData({
          headers: ['Token', 'Price', 'Volume', 'Holders'],
          data: formattedStates.map(state => [
            state.mint,
            state.price,
            state.volume,
            state.holders
          ])
        });
      }
    } catch (error) {
      throw new Error(`Error updating token states: ${error.message}`);
    }
  }

  formatTokenInfo(token) {
    const price = this.priceManager.getPrice(token.mint);
    const volume = token.getVolume();
    return (
      `{bold}${token.mint}{/bold}\n` +
      `Price: ${price.toFixed(6)} SOL\n` +
      `Volume: ${volume.toFixed(2)} SOL\n` +
      `Age: ${this.formatAge(token.getAge())}\n` +
      "───────────────\n"
    );
  }

  updateTraderStats() {
    const globalMetrics = this.tokenTracker.getTraderMetrics();
    const activeTokens = Array.from(this.tokenTracker.tokens.values());

    // Get most active token by trade count
    const mostActiveToken = activeTokens.reduce((max, token) => {
      const metrics = token.getTraderMetrics();
      return metrics.totalTrades > (max?.metrics?.totalTrades || 0)
        ? { token, metrics }
        : max;
    }, null);

    // Format stats display
    const stats = [
      `Total Unique Traders: {bold}${globalMetrics.uniqueTraders}{/bold}`,
      `Active Traders: {bold}${globalMetrics.activeTraders}{/bold}`,
      `Cross-Token Traders: {bold}${globalMetrics.crossTokenTraders}{/bold}`,
      `Total Trades: {bold}${globalMetrics.totalTrades}{/bold}`,
      "",
      "Most Active Token:",
      mostActiveToken
        ? [
            `  Symbol: {bold}${mostActiveToken.token.symbol}{/bold}`,
            `  Trades: {bold}${mostActiveToken.metrics.totalTrades}{/bold}`,
            `  Active Traders: {bold}${mostActiveToken.metrics.activeTraders}{/bold}`,
          ].join("\n")
        : "None",
    ].join("\n");

    this.traderStatsBox.setContent(stats);
  }

  updateWhaleActivity() {
    const activeTokens = Array.from(this.tokenTracker.tokens.values());
    const now = Date.now();

    activeTokens.forEach((token) => {
      const whaleThreshold = token.supply * 0.01; // 1% of supply
      const whales = token
        .getTraders()
        .filter(
          (trader) => trader.getTokenBalance(token.mint) > whaleThreshold
        );

      whales.forEach((whale) => {
        const recentTrades = whale
          .getTradeHistory(token.mint)
          .filter((trade) => now - trade.timestamp < 5 * 60 * 1000); // Last 5 minutes

        if (recentTrades.length > 0) {
          const totalVolume = recentTrades.reduce(
            (sum, t) => sum + t.amount,
            0
          );
          this.whaleActivityBox.log(
            `🐋 Whale ${whale.publicKey.slice(0, 8)} ${
              recentTrades[0].txType
            }ing ` +
              `${totalVolume.toFixed(2)} ${
                token.symbol || token.mint.slice(0, 8)
              }`
          );
        }
      });
    });
  }

  formatPositionInfo(position) {
    try {
      // Get position metrics using Position class methods
      const { percentage: pnl } = position.getProfitLoss();
      const holdTime = position.getHoldTime() / 1000; // Convert to seconds
      const holdTimeStr =
        holdTime < 60
          ? `${holdTime.toFixed(0)}s`
          : `${(holdTime / 60).toFixed(1)}m`;

      // Get price metrics
      const priceMetrics = position.getPriceMetrics();
      const velocityIndicator =
        priceMetrics.velocity > 0
          ? "{green-fg}↑" + priceMetrics.velocity.toFixed(1) + "%/m{/green-fg}"
          : "{red-fg}↓" +
            Math.abs(priceMetrics.velocity).toFixed(1) +
            "%/m{/red-fg}";

      // Get volume metrics
      const volumeMetrics = position.getVolumeMetrics();
      const volumeIndicator =
        volumeMetrics.trend > 0
          ? "{green-fg}↑" + volumeMetrics.trend.toFixed(0) + "%{/green-fg}"
          : "{red-fg}↓" +
            Math.abs(volumeMetrics.trend).toFixed(0) +
            "%{/red-fg}";

      // Get profit trend
      const profitMetrics = position.getProfitMetrics();
      const profitDirection =
        profitMetrics.trend > 0 ? "▲" : profitMetrics.trend < 0 ? "▼" : "─";

      // Format P/L with color and trend
      const plColor = pnl >= 0 ? "green" : "red";
      const plStr = `{${plColor}-fg}${profitDirection} ${Math.abs(pnl).toFixed(
        1
      )}%{/${plColor}-fg}`;

      // Build the display string with dynamic data
      return [
        `${position.mint?.slice(0, 8)}... | ${holdTimeStr} | P/L: ${plStr}`,
        `Price: ${position
          .getCurrentPrice()
          ?.toFixed(4)} SOL ${velocityIndicator}`,
        `Vol: ${this.formatVolume(
          position.getCurrentVolume()
        )}$ ${volumeIndicator}`,
        `Entry: ${position.getEntryPrice()?.toFixed(4)} | High: ${position
          .getHighPrice()
          ?.toFixed(4)}`,
        `Size: ${(position.getRemainingSize() * 100).toFixed(0)}% | Exits: ${
          position.getPartialExits().length
        }`,
        "─".repeat(50), // Separator
      ].join("\n");
    } catch (error) {
      console.error("Error formatting position:", error);
      return `Error formatting position: ${position.mint}`;
    }
  }

  updatePositions() {
    try {
      if (!this.positionManager?.getActivePositions) {
        console.error("PositionManager not properly initialized");
        this.positionsBox.setContent("Position manager not ready...");
        return;
      }

      const positions = this.positionManager.getActivePositions();
      if (!positions || positions.length === 0) {
        this.positionsBox.setContent("No active positions");
        return;
      }

      const formattedPositions = positions
        .map((position) => this.formatPositionInfo(position))
        .filter(Boolean)
        .join("\n\n");

      this.positionsBox.setContent(formattedPositions || "No active positions");
      this.screen.render();
    } catch (error) {
      console.error("Error updating positions:", error);
      this.positionsBox.setContent("Error updating positions");
    }
  }

  updateWalletStatus() {
    this.walletBox.setContent(this.getWalletStatus());
  }

  updateBalanceChart() {
    this.updateBalanceHistory();
  }

  updateTraderStats() {
    const globalMetrics = this.tokenTracker.getTraderMetrics();
    const activeTokens = Array.from(this.tokenTracker.tokens.values());

    // Get most active token by trade count
    const mostActiveToken = activeTokens.reduce((max, token) => {
      const metrics = token.getTraderMetrics();
      return metrics.totalTrades > (max?.metrics?.totalTrades || 0)
        ? { token, metrics }
        : max;
    }, null);

    // Format stats display
    const stats = [
      `Total Unique Traders: {bold}${globalMetrics.uniqueTraders}{/bold}`,
      `Active Traders: {bold}${globalMetrics.activeTraders}{/bold}`,
      `Cross-Token Traders: {bold}${globalMetrics.crossTokenTraders}{/bold}`,
      `Total Trades: {bold}${globalMetrics.totalTrades}{/bold}`,
      "",
      "Most Active Token:",
      mostActiveToken
        ? [
            `  Symbol: {bold}${mostActiveToken.token.symbol}{/bold}`,
            `  Trades: {bold}${mostActiveToken.metrics.totalTrades}{/bold}`,
            `  Active Traders: {bold}${mostActiveToken.metrics.activeTraders}{/bold}`,
          ].join("\n")
        : "None",
    ].join("\n");

    this.traderStatsBox.setContent(stats);
  }

  updateWhaleActivity() {
    const activeTokens = Array.from(this.tokenTracker.tokens.values());
    const now = Date.now();

    activeTokens.forEach((token) => {
      const whaleThreshold = token.supply * 0.01; // 1% of supply
      const whales = token
        .getTraders()
        .filter(
          (trader) => trader.getTokenBalance(token.mint) > whaleThreshold
        );

      whales.forEach((whale) => {
        const recentTrades = whale
          .getTradeHistory(token.mint)
          .filter((trade) => now - trade.timestamp < 5 * 60 * 1000); // Last 5 minutes

        if (recentTrades.length > 0) {
          const totalVolume = recentTrades.reduce(
            (sum, t) => sum + t.amount,
            0
          );
          this.whaleActivityBox.log(
            `🐋 Whale ${whale.publicKey.slice(0, 8)} ${
              recentTrades[0].txType
            }ing ` +
              `${totalVolume.toFixed(2)} ${
                token.symbol || token.mint.slice(0, 8)
              }`
          );
        }
      });
    });
  }
}

module.exports = Dashboard;
