const blessed = require("blessed");
const contrib = require("blessed-contrib");
const ErrorLogger = require("./ErrorLogger");

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
    this.errorLogger = new ErrorLogger();

    try {
      this.initializeDashboard();
    } catch (error) {
      this.handleError(error, "initialization");
    }
  }

  handleError(error, context, additionalInfo = {}) {
    this.errorLogger.logError(error, "Dashboard", {
      context,
      ...additionalInfo,
    });
    
    // Log to dashboard if available, otherwise fallback to console
    if (this.statusBox) {
      this.logStatus(`Error in ${context}: ${error.message}`, "error");
    } else {
      console.error(`Dashboard error in ${context}:`, error);
    }
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
    
    // Set up periodic updates with error handling
    setInterval(() => {
      try {
        this.updateDashboard();
      } catch (error) {
        this.handleError(error, "periodic update");
      }
    }, 1000);

    // Initial render
    this.screen.render();
  }

  initializeComponents() {
    // Create wallet status box (1 col)
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

    // Create balance history (1 col)
    this.balanceChart = this.grid.set(0, 3, 3, 3, contrib.line, {
      style: {
        line: "yellow",
        text: "green",
        baseline: "black",
      },
      xLabelPadding: 3,
      xPadding: 5,
      label: " Balance History ",
      showLegend: false,
      wholeNumbersOnly: false,
    });

    // Create trade history box (1 col)
    this.tradeBox = this.grid.set(0, 6, 3, 3, blessed.box, {
      label: " Trade History ",
      content: "Waiting for trades...",
      border: "line",
      tags: false,
      padding: 1,
      scrollable: true,
      style: {
        label: { bold: true },
      },
    });

    // Create status log
    this.statusBox = this.grid.set(0, 9, 3, 6, blessed.log, {
      label: " System Status ",
      scrollable: true,
      alwaysScroll: true,
      border: "line",
      tags: false,
      padding: 1,
      style: {
        label: { bold: true },
      },
    });

    // Redirect console.log to status box
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;

    console.log = (...args) => {
      this.logStatus(args.join(" "));
      // originalConsoleLog.apply(console, args);
    };

    console.error = (...args) => {
      this.logStatus(args.join(" "), "error");
      // originalConsoleError.apply(console, args);
    };

    // Token state boxes in second row, extending to bottom
    this.heatingUpBox = this.grid.set(3, 0, 9, 3, blessed.box, {
      label: " Heating Up ",
      content: "Waiting...",
      border: "line",
      tags: false,
      padding: 1,
      scrollable: true,
      style: {
        label: { bold: true },
      },
    });

    this.firstPumpBox = this.grid.set(3, 3, 9, 3, blessed.box, {
      label: " First Pump ",
      content: "Waiting...",
      border: "line",
      tags: false,
      padding: 1,
      scrollable: true,
      style: {
        label: { bold: true },
      },
    });

    this.drawdownBox = this.grid.set(3, 6, 9, 3, blessed.box, {
      label: " Drawdown ",
      content: "Waiting...",
      border: "line",
      tags: false,
      padding: 1,
      scrollable: true,
      style: {
        label: { bold: true },
      },
    });

    this.supplyRecoveryBox = this.grid.set(3, 9, 9, 3, blessed.box, {
      label: " Unsafe Recovery ",
      content: "Waiting...",
      border: "line",
      tags: false,
      padding: 1,
      scrollable: true,
      style: {
        label: { bold: true },
      },
    });

    this.activePositionsBox = this.grid.set(3, 12, 9, 3, blessed.box, {
      label: " Active Positions ",
      content: "Waiting...",
      border: "line",
      tags: false,
      padding: 1,
      scrollable: true,
      style: {
        label: { bold: true },
      },
    });
  }

  setupEventHandlers() {
    // Basic event handler for quitting
    this.screen.key(["escape", "q", "C-c"], () => {
      // Restore original console methods before exiting
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
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
      this.handleError(error, "wallet status");
      return [
        `Balance:   N/A SOL`,
        `P/L Today: N/A SOL`,
        `Total P/L: N/A SOL`,
        `Win Rate:  N/A%`,
      ].join("\n");
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
      this.handleError(error, "balance history");
    }
  }

  getActivePositions() {
    try {
      if (!this.positionManager?.getActivePositions) {
        return "Waiting for position manager...";
      }

      const positions = this.positionManager.getActivePositions();
      if (!positions || positions.length === 0) {
        return "No active positions";
      }

      const positionStrings = positions.map((pos) => {
        try {
          const pnl = (
            ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) *
            100
          ).toFixed(2);
          const holdTime = ((Date.now() - pos.entryTime) / 1000 / 60).toFixed(
            1
          );
          return [
            `Token:   ${pos.mint?.slice(0, 8) || "N/A"}...`,
            `Entry:   ${pos.entryPrice?.toFixed(4) || "N/A"}`,
            `Current: ${pos.currentPrice?.toFixed(4) || "N/A"}`,
            `P/L:     ${pnl}%`,
            `Time:    ${holdTime}m`,
          ].join(" | ");
        } catch (err) {
          this.handleError(err, "position formatting");
          return "Error formatting position";
        }
      });

      return positionStrings.join("\n");
    } catch (error) {
      this.handleError(error, "positions");
      return "Waiting for positions...";
    }
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
      this.handleError(error, "logging trade", { type, mint, profitLoss, symbol });
    }
  }

  getTradeHistory() {
    try {
      if (this.trades.length === 0) {
        return "No trades yet";
      }

      return this.trades
        .map(
          (trade) =>
            `${trade.timestamp} | ${trade.type} | ${trade.symbol} | ${
              trade.profitLoss > 0 ? "+" : ""
            }${trade.profitLoss.toFixed(4)} SOL`
        )
        .join("\n");
    } catch (error) {
      this.handleError(error, "trade history");
      return "Error loading trade history";
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
      this.handleError(error, "volume formatting", { volume: vol });
      return "0";
    }
  }

  logStatus(message, type = "info") {
    try {
      const timestamp = new Date().toLocaleTimeString();
      const prefix = type === "error" ? "🔴" : type === "warning" ? "⚠️" : "ℹ️";
      this.statusBox.log(`${timestamp} ${prefix} ${message}`);
    } catch (error) {
      // Use console.error as fallback if statusBox fails
      console.error("Error logging to status box:", error);
      console.error("Original message:", message);
    }
  }

  updateDashboard() {
    try {
      this.walletBox.setContent(this.getWalletStatus());
      this.heatingUpBox.setContent(this.getTokensByState("heatingUp"));
      this.firstPumpBox.setContent(this.getTokensByState("firstPump"));
      this.drawdownBox.setContent(this.getTokensByState("drawdown"));
      this.supplyRecoveryBox.setContent(
        this.getTokensByState("unsafeRecovery")
      );
      this.activePositionsBox.setContent(this.getActivePositions());
      this.tradeBox.setContent(this.getTradeHistory());
      this.updateBalanceHistory();
      this.screen.render();
    } catch (error) {
      this.handleError(error, "dashboard update");
    }
  }

  getTokensByState(state) {
    try {
      const tokens = this.tokenTracker.getTokensByState(state);
      if (!tokens || tokens.length === 0) {
        return "No tokens";
      }

      return tokens
        .map((token) => {
          try {
            // Calculate token age in seconds
            const now = Date.now();
            const tokenAge = Math.floor((now - token.minted) / 1000);
            const ageStr =
              tokenAge > 59 ? `${Math.floor(tokenAge / 60)}m` : `${tokenAge}s`;

            // Format market cap in USD with k format
            const marketCapUSD = this.priceManager.solToUSD(token.marketCapSol);
            const mcFormatted =
              marketCapUSD >= 1000
                ? `${(marketCapUSD / 1000).toFixed(1)}k`
                : marketCapUSD.toFixed(1);
            const mcStr = `MC: $${mcFormatted}`;

            // Get holder info
            const holderCount = token.getHolderCount();
            const topConcentration = token.getTopHolderConcentration(10);
            const holdersStr = `H: ${holderCount} T: ${topConcentration.toFixed(
              0
            )}%`;

            // Get volume data in USD with k format for ≥1000, whole numbers for <1000
            const formatVolume = (vol) => {
              const volUSD = this.priceManager.solToUSD(vol);
              return volUSD >= 1000
                ? `${(volUSD / 1000).toFixed(1)}k`
                : Math.round(volUSD).toString();
            };

            const vol1m = formatVolume(token.getVolume("1m"));
            const vol5m = formatVolume(token.getVolume("5m"));
            const vol1h = formatVolume(token.getVolume("30m"));
            const volumeStr = `VOL 1m: $${vol1m} | 5m: $${vol5m} | 1h: $${vol1h}`;

            // Format the token info string
            const symbol = token.symbol || token.mint.slice(0, 8);
            return [
              `${symbol.padEnd(12)} ${ageStr.padEnd(
                3
              )} | MC: $${mcFormatted.padEnd(5)} | ${holdersStr}`,
              `VOL   1m: $${vol1m.padEnd(5)} | 5m: $${vol5m.padEnd(
                5
              )} | 1h: $${vol1h}`,
              "─".repeat(50), // Add horizontal rule between tokens
            ].join("\n");
          } catch (err) {
            this.handleError(err, "token formatting");
            return `Error formatting token ${
              token.symbol || token.mint.slice(0, 8)
            }: ${err.message}`;
          }
        })
        .join("\n");
    } catch (error) {
      this.handleError(error, `getting ${state} tokens`);
      return "Error loading tokens";
    }
  }
}

module.exports = Dashboard;
