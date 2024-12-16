const blessed = require("blessed");
const contrib = require("blessed-contrib");

class Dashboard {
  constructor(wallet, tokenTracker, positionManager, safetyChecker, priceManager) {
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

    // Set up periodic updates
    setInterval(() => this.updateDashboard(), 1000);

    // Initial render
    this.screen.render();
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
      this.logStatus("Error getting wallet status: " + error.message, "error");
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
      this.logStatus("Error updating balance chart: " + error.message, "error");
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
          this.logStatus(`Error formatting position: ${err.message}`, "error");
          return "Error formatting position";
        }
      });

      return positionStrings.join("\n");
    } catch (error) {
      this.logStatus("Error getting positions: " + error.message, "error");
      return "Waiting for positions...";
    }
  }

  logTrade({ type, mint, profitLoss, symbol }) {
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
  }

  getTradeHistory() {
    if (this.trades.length === 0) {
      return "No trades yet";
    }

    return this.trades
      .map((trade) => {
        const profitLossStr =
          typeof trade.profitLoss === "number"
            ? `${
                trade.profitLoss === 0 ? "" : trade.profitLoss > 0 ? "+" : ""
              }${trade.profitLoss.toFixed(4)} SOL`
            : "N/A";
        return `[${trade.timestamp}] ${trade.type.padEnd(4)} | ${
          trade.symbol || trade.mint.slice(0, 8)
        } | ${profitLossStr}`;
      })
      .join("\n");
  }

  updateDashboard() {
    try {
      this.walletBox.setContent(this.getWalletStatus());
      this.heatingUpBox.setContent(this.getTokensByState("heatingUp"));
      this.firstPumpBox.setContent(this.getTokensByState("firstPump"));
      this.drawdownBox.setContent(this.getTokensByState("drawdown"));
      this.supplyRecoveryBox.setContent(this.getTokensByState("unsafeRecovery"));
      this.activePositionsBox.setContent(this.getActivePositions());
      this.tradeBox.setContent(this.getTradeHistory());
      this.updateBalanceHistory();
      this.screen.render();
    } catch (error) {
      this.logStatus("Error updating dashboard: " + error.message, "error");
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
            const tokenAge = Math.floor((now - token.created) / 1000);
            const ageStr = `${tokenAge}s`;

            // Format market cap in USD
            const marketCapUSD = this.priceManager.solToUSD(token.marketCapSol);
            const mcStr = `MC: $${marketCapUSD.toFixed(4)}`;

            // Get holder info
            const holderCount = token.getHolderCount();
            const topConcentration = token.getTopHolderConcentration(10);
            const holdersStr = `H: ${holderCount} T: ${topConcentration.toFixed(0)}%`;

            // Get volume data
            const vol1m = token.getVolume('1m').toFixed(4);
            const vol5m = token.getVolume('5m').toFixed(4);
            const vol1h = token.getVolume('30m').toFixed(4);
            const volumeStr = `VOL 1m: $${vol1m} | 5m: $${vol5m} | 1h: $${vol1h}`;

            // Format the token info string
            const symbol = token.symbol || token.mint.slice(0, 8);
            return [
              `${symbol.padEnd(12)} ${ageStr.padEnd(6)} | ${mcStr}`,
              `${holdersStr}`,
              `${volumeStr}`
            ].join('\n');
          } catch (err) {
            return `Error formatting token ${token.symbol || token.mint.slice(0, 8)}: ${err.message}`;
          }
        })
        .join("\n\n");
    } catch (error) {
      this.logStatus(`Error getting ${state} tokens: ${error.message}`, "error");
      return "Error loading tokens";
    }
  }

  logStatus(message, type = "info") {
    const timestamp = new Date().toLocaleTimeString();
    this.statusBox.log(`[${timestamp}] ${message}`);
    this.screen.render();
  }
}

module.exports = Dashboard;
