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

    // Listen for balance updates from Wallet
    this.wallet.on('balanceUpdate', () => {
      this.updateBalanceHistory();
    });

    // Update dashboard every second
    setInterval(() => {
      this.updateDashboard();
    }, 1000);

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
      tags: true,
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
      tags: true,
      padding: 1,
      style: {
        label: { bold: true },
      },
    });

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
      tags: true,
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

        // Filter both x and y data to show only every 60th point for readability
        const filteredIndices = this.balanceHistory.x.map((_, i) => i).filter(i => i % 60 === 0);
        const displayData = {
          x: filteredIndices.map(i => this.balanceHistory.x[i]),
          y: filteredIndices.map(i => this.balanceHistory.y[i]),
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
      throw error;
    }
  }

  getTokensByState(state) {
    try {
      const tokens = Array.from(this.tokenTracker.tokens.values()).filter(
        (token) => token.state === state
      );

      if (tokens.length === 0) {
        return "No tokens in this state";
      }

      return tokens
        .map((token) => {
          try {
            // Calculate token age in seconds
            const now = Date.now();
            const tokenAge = Math.floor((now - token.minted) / 1000);
            const ageStr = tokenAge > 59 ? `${Math.floor(tokenAge / 60)}m` : `${tokenAge}s`;

            // Format market cap in USD with k format
            const marketCapUSD = this.priceManager.solToUSD(token.marketCapSol);
            const mcFormatted = marketCapUSD >= 1000
              ? `${(marketCapUSD / 1000).toFixed(1)}k`
              : marketCapUSD.toFixed(1);

            // Get holder info
            const holderCount = token.getHolderCount();
            const topConcentration = token.getTopHolderConcentration(10);
            const holdersStr = `H: ${holderCount} T: ${topConcentration.toFixed(0)}%`;

            // Get volume data in USD with k format for ≥1000, whole numbers for <1000
            const formatVolume = (vol) => {
              const volUSD = this.priceManager.solToUSD(vol);
              return volUSD >= 1000
                ? `${(volUSD / 1000).toFixed(1)}k`
                : Math.round(volUSD).toString();
            };

            // Get volume from token's volume metrics
            const vol1m = formatVolume(token.volume1m || 0);
            const vol5m = formatVolume(token.volume5m || 0);
            const vol30m = formatVolume(token.volume30m || 0);

            // Format the token info string
            const symbol = token.symbol || token.mint.slice(0, 8);
            const rows = [
              `${symbol.padEnd(12)} ${ageStr.padEnd(3)} | MC: $${mcFormatted.padEnd(5)} | ${holdersStr}`,
              `VOL   1m: $${vol1m.padEnd(5)} | 5m: $${vol5m.padEnd(5)} | 30m: $${vol30m}`,
            ];

            // Add safety failure reason for unsafe recovery state
            if (state === "unsafeRecovery" && token.unsafeReason) {
              const { reason, value } = token.unsafeReason;
              let valueStr = value;
              switch (reason) {
                case "High holder concentration":
                  valueStr = `${value.toFixed(1)}%`;
                  break;
                case "Token too young":
                  valueStr = `${Math.floor(value)}s`;
                  break;
                case "Creator holdings too high":
                  valueStr = `${value.toFixed(1)}%`;
                  break;
                case "volatilityTooHigh":
                  valueStr = `${value.toFixed(2)}`;
                  break;
                default:
                  valueStr = value ? value.toString() : "N/A";
              }
              rows.push(`UNSAFE: ${reason} (${valueStr})`);
            }

            rows.push("─".repeat(50)); // Add horizontal rule between tokens
            return rows.join("\n");
          } catch (err) {
            throw err;
          }
        })
        .join("\n");
    } catch (error) {
      throw error;
    }
  }
}

module.exports = Dashboard;
