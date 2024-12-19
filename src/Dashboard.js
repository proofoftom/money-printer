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
    this.positionManager.on("trade", (tradeData) => {
      this.logTrade(tradeData);
    });

    // Listen for balance updates from Wallet
    this.wallet.on("balanceUpdate", () => {
      this.updateBalanceHistory();
    });

    // Listen for token updates
    this.tokenTracker.on("tokenUpdated", () => {
      this.updateDashboard();
    });

    // Listen for token updates
    this.tokenTracker.on("tokenStateChanged", () => {
      this.updateDashboard();
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
    this.newTokensBox = this.grid.set(3, 0, 9, 3, blessed.box, {
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

    this.pumpingBox = this.grid.set(3, 3, 9, 3, blessed.box, {
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

    this.pumpedBox = this.grid.set(3, 6, 9, 3, blessed.box, {
      label: " Pumped ",
      content: "Waiting...",
      border: "line",
      tags: false,
      padding: 1,
      scrollable: true,
      style: {
        label: { bold: true },
      },
    });

    this.drawdownBox = this.grid.set(3, 9, 9, 3, blessed.box, {
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
        const filteredIndices = this.balanceHistory.x
          .map((_, i) => i)
          .filter((i) => i % 60 === 0);
        const displayData = {
          x: filteredIndices.map((i) => this.balanceHistory.x[i]),
          y: filteredIndices.map((i) => this.balanceHistory.y[i]),
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

  formatUSD(value) {
    if (value === 0) return "$0";
    
    const absValue = Math.abs(value);
    if (absValue >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(2)}M`;
    } else if (absValue >= 1_000) {
      return `$${(value / 1_000).toFixed(2)}k`;
    } else {
      return `$${value.toFixed(2)}`;
    }
  }

  formatTokenRow(token) {
    const age = this.getAge(token.firstSeen);
    const mc = this.priceManager.solToUSD(token.marketCapSol);
    const holders = token.wallets.size;
    const txCount = Array.from(token.wallets.values()).reduce(
      (sum, w) => sum + w.trades.length,
      0
    );
    const txPercent = ((txCount / token.totalTxCount) * 100).toFixed(0);

    return [
      `${token.symbol}`,
      `${age} | MC: ${this.formatUSD(mc)} | H: ${holders} T: ${txPercent}%`,
      `VOL   5s: ${this.formatUSD(token.volume5s)} | 10s: ${this.formatUSD(token.volume10s)} | 30s: ${this.formatUSD(token.volume30s)}`,
      `P1m: ${token.price1m.toFixed(1)}% P5m: ${token.price5m.toFixed(1)}% VS: ${token.volumeSpike.toFixed(0)}% BP: ${token.buyPressure.toFixed(0)}% Gain: ${token.getGainFromInitial().toFixed(1)}%`,
    ].join("\n");
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
    try {
      this.walletBox.setContent(this.getWalletStatus());
      this.newTokensBox.setContent(this.getTokensByState("new"));
      this.pumpingBox.setContent(this.getTokensByState("pumping"));
      this.pumpedBox.setContent(this.getTokensByState("pumped"));
      this.drawdownBox.setContent(this.getTokensByState("drawdown"));
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
      // Filter tokens to only include those in the requested state
      const tokens = Array.from(this.tokenTracker.tokens.values()).filter(
        (token) => token.state.toLowerCase() === state.toLowerCase()
      );

      // Sort by gain percentage instead of market cap
      tokens.sort((a, b) => {
        const gainA = a.stateManager.getGainFromInitial(a.stateManager.priceHistory.lastPrice);
        const gainB = b.stateManager.getGainFromInitial(b.stateManager.priceHistory.lastPrice);
        return gainB - gainA;
      });

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

            // Get holder info
            const holderCount = token.getHolderCount();
            const topConcentration = token.getTopHolderConcentration(10);
            const holdersStr = `H: ${holderCount} T: ${topConcentration.toFixed(
              0
            )}%`;

            // Get volume from token's volume metrics
            const vol5s = this.formatVolume(token.volume5s || 0);
            const vol10s = this.formatVolume(token.volume10s || 0);
            const vol30s = this.formatVolume(token.volume30s || 0);

            // Format the token info string
            const symbol = token.symbol || token.mint.slice(0, 8);
            const rows = [
              `${symbol.padEnd(12)} ${ageStr.padEnd(
                3
              )} | MC: $${mcFormatted.padEnd(5)} | ${holdersStr}`,
              `VOL   5s: $${vol5s.padEnd(5)} | 10s: $${vol10s.padEnd(
                5
              )} | 30s: $${vol30s}`,
            ];

            // Add state-specific metrics
            if (state === "new" || state === "pumping") {
              const priceIncrease1m = token.getPriceIncrease(60);
              const priceIncrease5m = token.getPriceIncrease(300);
              const volumeSpike = token.getVolumeSpike();
              const buyPressure = token.getBuyPressure();
              const gainFromStart = token.stateManager.getGainFromInitial(
                token.stateManager.priceHistory.lastPrice
              );

              rows.push(
                `P1m: ${priceIncrease1m.toFixed(
                  1
                )}% P5m: ${priceIncrease5m.toFixed(
                  1
                )}% VS: ${volumeSpike.toFixed(0)}% BP: ${buyPressure.toFixed(
                  0
                )}% Gain: ${gainFromStart.toFixed(1)}%`
              );
            } else if (state === "pumped") {
              const gainFromInitial = token.stateManager.getGainFromInitial(
                token.stateManager.priceHistory.lastPrice
              );
              const drawdownFromPeak = token.stateManager.getDrawdownFromPeak();
              rows.push(
                `Total Gain: ${gainFromInitial.toFixed(
                  1
                )}% Drawdown: ${drawdownFromPeak.toFixed(1)}%`
              );
            } else if (state === "drawdown") {
              const gainFromInitial = token.stateManager.getGainFromInitial(
                token.stateManager.priceHistory.lastPrice
              );
              const drawdownFromPeak = token.stateManager.getDrawdownFromPeak();
              const failedAttempts = token.stateManager.metrics.failedAttempts;
              rows.push(
                `Total Gain: ${gainFromInitial.toFixed(
                  1
                )}% Drawdown: ${drawdownFromPeak.toFixed(
                  1
                )}% Failed: ${failedAttempts}`
              );
            }

            // Add unsafe reason if present
            if (token.stateManager.unsafe) {
              const reasons = Array.from(token.stateManager.unsafeReasons);
              if (reasons.length > 0) {
                rows.push(`\x1b[33mUNSAFE: ${reasons.join(", ")}\x1b[0m`);
              }
            }

            rows.push("─".repeat(50)); // Add horizontal rule between tokens
            return rows.join("\n");
          } catch (err) {
            console.error(`Error rendering token ${token.mint}:`, err);
            return "";
          }
        })
        .join("\n");
    } catch (error) {
      console.error("Error in getTokensByState:", error);
      return "";
    }
  }

  renderLane(tokens) {
    try {
      return tokens.map((token) => {
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

          // Get holder info
          const holderCount = token.getHolderCount();
          const topConcentration = token.getTopHolderConcentration(10);
          const holdersStr = `H: ${holderCount} T: ${topConcentration.toFixed(
            0
          )}%`;

          // Get volume from token's volume metrics using by-second windows
          const vol5s = this.formatVolume(token.volume5s || 0);
          const vol10s = this.formatVolume(token.volume10s || 0);
          const vol30s = this.formatVolume(token.volume30s || 0);

          // Format the token info string
          const symbol = token.symbol || token.mint.slice(0, 8);
          const rows = [
            `${symbol.padEnd(12)} ${ageStr.padEnd(
              3
            )} | MC: $${mcFormatted.padEnd(5)} | ${holdersStr}`,
            `VOL   5s: $${vol5s.padEnd(5)} | 10s: $${vol10s.padEnd(
              5
            )} | 30s: $${vol30s}`,
          ];

          // Add metrics based on state
          if (token.state === "new" || token.state === "pumping") {
            const priceIncrease1m = token.getPriceIncrease(60);
            const priceIncrease5m = token.getPriceIncrease(300);
            const volumeSpike = token.getVolumeSpike();
            const buyPressure = token.getBuyPressure();
            const gainFromStart = token.stateManager.getGainFromInitial(
              token.stateManager.priceHistory.lastPrice
            );

            rows.push(
              `P1m: ${priceIncrease1m.toFixed(
                1
              )}% P5m: ${priceIncrease5m.toFixed(1)}% VS: ${volumeSpike.toFixed(
                0
              )}% BP: ${buyPressure.toFixed(0)}% Gain: ${gainFromStart.toFixed(
                1
              )}%`
            );
          } else if (token.state === "pumped") {
            const gainFromInitial = token.stateManager.getGainFromInitial(
              token.stateManager.priceHistory.lastPrice
            );
            const drawdownFromPeak = token.stateManager.getDrawdownFromPeak();
            rows.push(
              `Total Gain: ${gainFromInitial.toFixed(
                1
              )}% Drawdown: ${drawdownFromPeak.toFixed(1)}%`
            );
          } else if (token.state === "drawdown") {
            const gainFromInitial = token.stateManager.getGainFromInitial(
              token.stateManager.priceHistory.lastPrice
            );
            const drawdownFromPeak = token.stateManager.getDrawdownFromPeak();
            const failedAttempts = token.stateManager.metrics.failedAttempts;
            rows.push(
              `Total Gain: ${gainFromInitial.toFixed(
                1
              )}% Drawdown: ${drawdownFromPeak.toFixed(
                1
              )}% Failed: ${failedAttempts}`
            );
          }

          // Add unsafe reason if present
          if (token.stateManager.unsafe) {
            const reasons = Array.from(token.stateManager.unsafeReasons);
            if (reasons.length > 0) {
              rows.push(`\x1b[33mUNSAFE: ${reasons.join(", ")}\x1b[0m`);
            }
          }

          rows.push("─".repeat(50)); // Add horizontal rule between tokens
          return rows.join("\n");
        } catch (err) {
          throw err;
        }
      });
    } catch (error) {
      throw error;
    }
  }

  updateTokens() {
    try {
      if (!this.tokenBox) return;

      const tokens = Array.from(this.tokenTracker.tokens.values());
      const sortedTokens = tokens
        .filter((t) => !t.isScam)
        .sort((a, b) => b.getGainFromInitial() - a.getGainFromInitial());

      const content = ["New Tokens"];
      for (const token of sortedTokens) {
        content.push("-".repeat(70));
        content.push(this.formatTokenRow(token));
      }

      this.tokenBox.setContent(content.join("\n"));
      this.screen.render();
    } catch (error) {
      console.error("Error in updateTokens:", error);
    }
  }
}

module.exports = Dashboard;
