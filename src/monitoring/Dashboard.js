const blessed = require("blessed");
const contrib = require("blessed-contrib");

class Dashboard {
  constructor(
    wallet,
    tokenTracker,
    positionManager,
    safetyChecker,
    priceManager,
    config
  ) {
    this.wallet = wallet;
    this.tokenTracker = tokenTracker;
    this.positionManager = positionManager;
    this.safetyChecker = safetyChecker;
    this.priceManager = priceManager;
    this.config = config;
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
    this.positionManager.on("trade", (tradeData) => {
      this.logTrade(tradeData);
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
      cols: 12,
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

    // Create trade history box (top row)
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

    // Create status log (top row)
    this.statusBox = this.grid.set(0, 9, 3, 3, blessed.log, {
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
    // Each state gets equal width (12/5 = ~2.4 columns each)
    this.newTokensBox = this.grid.set(3, 0, 9, 2, blessed.box, {
      label: " New Tokens ",
      content: "Waiting...",
      border: "line",
      tags: false,
      padding: 1,
      scrollable: true,
      style: {
        label: { bold: true },
      },
    });

    this.pumpingBox = this.grid.set(3, 2, 9, 2, blessed.box, {
      label: " Pumping ",
      content: "Waiting...",
      border: "line",
      tags: false,
      padding: 1,
      scrollable: true,
      style: {
        label: { bold: true },
      },
    });

    this.drawdownBox = this.grid.set(3, 4, 9, 2, blessed.box, {
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

    this.recoveryBox = this.grid.set(3, 6, 9, 2, blessed.box, {
      label: " Recovery ",
      content: "Waiting...",
      border: "line",
      tags: false,
      padding: 1,
      scrollable: true,
      style: {
        label: { bold: true },
      },
    });

    this.activePositionsBox = this.grid.set(3, 8, 9, 4, blessed.box, {
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
      const holdTimeStr =
        holdTime < 60
          ? `${holdTime.toFixed(0)}s`
          : `${(holdTime / 60).toFixed(1)}m`;

      // Calculate price velocity (change per minute)
      const priceHistory = pos.priceHistory || [];
      const recentPrices = priceHistory.slice(-5); // Last 5 price points
      const velocity =
        recentPrices.length > 1
          ? ((recentPrices[recentPrices.length - 1] - recentPrices[0]) /
              recentPrices[0]) *
            100
          : 0;

      // Get volume trends
      const volumeHistory = pos.volumeHistory || [];
      const recentVolume = volumeHistory.slice(-3); // Last 3 volume points
      const volumeTrend =
        recentVolume.length > 1
          ? ((recentVolume[recentVolume.length - 1] - recentVolume[0]) /
              recentVolume[0]) *
            100
          : 0;

      // Format velocity indicator
      const velocityIndicator =
        velocity > 0
          ? "{green-fg}↑" + velocity.toFixed(1) + "%/m{/green-fg}"
          : "{red-fg}↓" + Math.abs(velocity).toFixed(1) + "%/m{/red-fg}";

      // Format volume trend indicator
      const volumeIndicator =
        volumeTrend > 0
          ? "{green-fg}↑" + volumeTrend.toFixed(0) + "%{/green-fg}"
          : "{red-fg}↓" + Math.abs(volumeTrend).toFixed(0) + "%{/red-fg}";

      // Calculate profit trend
      const profitTrend = pos.profitHistory || [];
      const recentProfit = profitTrend.slice(-3);
      const profitDirection =
        recentProfit.length > 1
          ? recentProfit[recentProfit.length - 1] > recentProfit[0]
            ? "▲"
            : "▼"
          : "─";

      // Format P/L with color and trend
      const plColor = pnl >= 0 ? "green" : "red";
      const plStr = `{${plColor}-fg}${profitDirection} ${Math.abs(pnl).toFixed(
        1
      )}%{/${plColor}-fg}`;

      // Get volume in USD
      const volumeUSD = this.priceManager.solToUSD(pos.volume);

      // Build the display string with dynamic data
      return [
        `${pos.mint?.slice(0, 8)}... | ${holdTimeStr} | P/L: ${plStr}`,
        `Price: ${pos.currentPrice?.toFixed(4)} SOL ${velocityIndicator}`,
        `Vol: ${this.formatVolume(pos.volume5m || 0)}$ ${volumeIndicator}`,
        `Entry: ${pos.entryPrice?.toFixed(4)} | High: ${pos.highPrice?.toFixed(
          4
        )}`,
        "─".repeat(50), // Separator
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
            const profitLossStr =
              trade.profitLoss !== undefined && trade.profitLoss !== null
                ? `${
                    trade.profitLoss >= 0 ? "+" : ""
                  }${trade.profitLoss.toFixed(1)}%`
                : "N/A";

            const symbol = trade.symbol || trade.mint?.slice(0, 8) || "Unknown";

            // Color code based on trade type and profit/loss
            let tradeColor = "white";
            if (trade.type === "BUY") tradeColor = "yellow";
            else if (trade.type === "SELL" || trade.type === "CLOSE") {
              tradeColor = trade.profitLoss >= 0 ? "green" : "red";
            }

            return `{${tradeColor}-fg}[${
              trade.timestamp
            }] {${tradeColor}-fg}${trade.type.padEnd(
              5
            )} {/${tradeColor}-fg}{white-fg} ${symbol.padEnd(
              12
            )} {/${tradeColor}-fg}{${tradeColor}-fg} ${profitLossStr}{/${tradeColor}-fg}`;
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
      this.originalConsoleError.apply(console, [
        `Error in logStatus: ${error.message}`,
      ]);
    }
  }

  renderTokenMetrics(token) {
    const { PUMP, RECOVERY, SAFETY } = this.config;
    
    // Common metrics
    const metrics = {
      'Market Cap': `$${this.priceManager.solToUSD(token.marketCapSol).toFixed(1)}`,
      'Volume (SOL)': this.formatVolume(token.volumeSOL),
      'Holders': token.holders,
      'Age': this.formatTime(token.age)
    };

    // State-specific metrics
    switch (token.state) {
      case 'new':
        return {
          ...metrics,
          'Price Change (1m)': `${token.getPriceChange(60).toFixed(1)}%`,
          'Volume Change': `${token.getVolumeSpike().toFixed(0)}%`,
          'Buy Pressure': `${token.getMarketMetrics().buyPressure.toFixed(0)}%`
        };

      case 'pumping':
        return {
          ...metrics,
          'Price Change (1m)': `${token.getPriceChange(60).toFixed(1)}%`,
          'Price Change (5m)': `${token.getPriceChange(300).toFixed(1)}%`,
          'Volume Spike': `${token.getVolumeSpike().toFixed(0)}%`,
          'Buy Pressure': `${token.getMarketMetrics().buyPressure.toFixed(0)}%`
        };

      case 'drawdown':
        return {
          ...metrics,
          'Drawdown': `${((token.marketCapSol - token.highestMarketCap) / token.highestMarketCap * 100).toFixed(1)}%`,
          'Time in Drawdown': this.formatTime(token.getDrawdownTime()),
          'Volume vs Peak': `${token.getVolumeVsPeak().toFixed(0)}%`
        };

      case 'recovery':
        return {
          ...metrics,
          'Gain from Bottom': `${((token.currentPrice - token.drawdownLow) / token.drawdownLow * 100).toFixed(1)}%`,
          'Buy Pressure': `${token.getMarketMetrics().buyPressure.toFixed(0)}%`,
          'Market Structure': `${token.getMarketMetrics().volumePriceCorrelation.toFixed(0)}`
        };

      case 'open':
        return {
          ...metrics,
          'Entry Price': this.priceManager.solToUSD(token.entryPrice).toFixed(1),
          'Current Gain': `${((token.currentPrice - token.entryPrice) / token.entryPrice * 100).toFixed(1)}%`,
          'Stop Loss': `${this.config.POSITION.EXIT.STOP_LOSS}%`
        };

      default:
        return metrics;
    }
  }

  updateDashboard() {
    try {
      this.walletBox.setContent(this.getWalletStatus());
      this.newTokensBox.setContent(this.getTokensByState("new"));
      this.pumpingBox.setContent(this.getTokensByState("pumping"));
      this.drawdownBox.setContent(this.getTokensByState("drawdown"));
      this.recoveryBox.setContent(this.getTokensByState("recovery"));
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
            const metrics = this.renderTokenMetrics(token);
            const rows = Object.keys(metrics).map(key => `${key.padEnd(20)} ${metrics[key]}`);
            rows.push("─".repeat(50)); // Add horizontal rule between tokens
            return rows.join("\n");
          } catch (err) {
            return `Error displaying token: ${err.message}`;
          }
        })
        .join("\n");
    } catch (error) {
      return `Error: ${error.message}`;
    }
  }

  formatTime(time) {
    const hours = Math.floor(time / 3600);
    const minutes = Math.floor((time % 3600) / 60);
    const seconds = time % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
}

module.exports = Dashboard;
