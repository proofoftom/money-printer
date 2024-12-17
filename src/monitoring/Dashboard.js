const blessed = require("blessed");
const contrib = require("blessed-contrib");

class Dashboard {
  constructor(
    wallet,
    tokenTracker,
    positionManager,
    safetyChecker,
    priceManager,
    traderManager,
    config
  ) {
    this.wallet = wallet;
    this.tokenTracker = tokenTracker;
    this.positionManager = positionManager;
    this.safetyChecker = safetyChecker;
    this.priceManager = priceManager;
    this.traderManager = traderManager;
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

    // Create trader metrics box
    this.traderMetricsBox = this.grid.set(6, 0, 3, 3, blessed.box, {
      label: " Trader Metrics ",
      content: "Loading trader data...",
      border: "line",
      tags: true,
      padding: 1,
      style: {
        label: { bold: true },
      },
    });

    // Create trader reputation box
    this.traderReputationBox = this.grid.set(9, 0, 3, 3, blessed.box, {
      label: " Trader Reputation ",
      content: "Loading reputation data...",
      border: "line",
      tags: true,
      padding: 1,
      style: {
        label: { bold: true },
      },
    });

    // Create trading patterns box
    this.tradingPatternsBox = this.grid.set(6, 3, 3, 3, blessed.box, {
      label: " Trading Patterns ",
      content: "Analyzing patterns...",
      border: "line",
      tags: true,
      padding: 1,
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
      const holdTimeStr = this.formatTime(holdTime);

      // Get market structure and recovery metrics
      const marketStructure = pos.marketStructure || 'unknown';
      const recoveryPhase = pos.recoveryPhase || 'none';
      const recoveryStrength = pos.recoveryStrength || 0;
      const buyPressure = pos.buyPressure || 0;

      // Calculate position size and remaining
      const remainingSize = pos.remainingSize * 100;
      const maxDrawdown = pos.maxDrawdown || 0;
      const maxUpside = pos.maxUpside || 0;

      // Format indicators
      const structureColor = 
        marketStructure === 'bullish' ? 'green' :
        marketStructure === 'bearish' ? 'red' : 'white';
      
      const phaseColor =
        recoveryPhase === 'accumulation' ? 'yellow' :
        recoveryPhase === 'expansion' ? 'green' :
        recoveryPhase === 'distribution' ? 'red' : 'white';

      // Build the display string with dynamic data
      return [
        `${pos.symbol} | ${holdTimeStr} | Size: ${remainingSize.toFixed(0)}%`,
        `P/L: ${pnl >= 0 ? '{green-fg}+' : '{red-fg}'}${Math.abs(pnl).toFixed(1)}%{/${pnl >= 0 ? 'green' : 'red'}-fg}`,
        `Entry: ${pos.entryPrice.toFixed(4)} | Current: ${pos.currentPrice.toFixed(4)}`,
        `High: ${pos.highestPrice.toFixed(4)} | Low: ${pos.lowestPrice.toFixed(4)}`,
        `Max Up: ${maxUpside.toFixed(1)}% | Max Down: ${maxDrawdown.toFixed(1)}%`,
        `Structure: {${structureColor}-fg}${marketStructure}{/${structureColor}-fg} | Phase: {${phaseColor}-fg}${recoveryPhase}{/${phaseColor}-fg}`,
        `Recovery: ${recoveryStrength.toFixed(0)}% | Buy Pressure: ${buyPressure.toFixed(0)}%`,
        "─".repeat(50), // Separator
      ].join("\n");
    });

    return positionStrings.join("\n");
  }

  logTrade({ type, mint, profitLoss, symbol, trader, size }) {
    try {
      const timestamp = new Date().toLocaleTimeString();
      const trade = {
        timestamp,
        type,
        mint,
        profitLoss,
        symbol,
        trader,
        size,
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
                ? `${trade.profitLoss >= 0 ? "+" : ""}${trade.profitLoss.toFixed(1)}%`
                : "N/A";

            const symbol = trade.symbol || trade.mint?.slice(0, 8) || "Unknown";

            // Get trader reputation info
            const trader = trade.trader || {};
            const reputation = trader.reputation || {};
            const score = reputation.score || 100;
            const tradeSize = trade.size || 0;

            // Color code based on trade type, profit/loss and reputation
            let tradeColor = "white";
            if (trade.type === "BUY") {
              tradeColor = score > 80 ? "green" : score > 50 ? "yellow" : "red";
            } else if (trade.type === "SELL" || trade.type === "CLOSE") {
              tradeColor = trade.profitLoss >= 0 ? "green" : "red";
            }

            // Format trade size and reputation indicators
            const sizeIndicator = tradeSize > 1000 ? "🔥" : tradeSize > 100 ? "+" : "";
            const reputationIndicator = score > 90 ? "⭐" : score < 50 ? "⚠️" : "";

            return `{${tradeColor}-fg}[${trade.timestamp}] ${trade.type.padEnd(5)} ${symbol.padEnd(12)} ${profitLossStr.padEnd(8)} ${sizeIndicator}${reputationIndicator}{/${tradeColor}-fg}`;
          } catch (err) {
            return `Error formatting trade: ${err.message}`;
          }
        })
        .join("\n");
    } catch (error) {
      throw error;
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
    const { MCAP, RECOVERY, SAFETY } = this.config;
    const marketCapUSD = this.priceManager.solToUSD(token.marketCapSol || 0) || 0;
    
    // Enhanced base metrics with null checks
    const metrics = {
      'Market Cap': `$${marketCapUSD.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`,
      'Market Cap %': `${(((marketCapUSD / (MCAP.MAX_ENTRY || 1)) * 100) || 0).toFixed(1)}%`,
      'Volume (SOL)': this.formatVolume(token.getRecentVolume(300000) || 0), // 5min volume
      'Holders': token.getHolderCount() || 0,
      'Age': this.formatTime((Date.now() - (token.minted || Date.now())) || 0)
    };

    // Get market structure analysis with null checks
    const marketStructure = token.analyzeMarketStructure() || {};
    const recoveryStrength = token.getRecoveryStrength() || {};
    const pumpMetrics = token.pumpMetrics || {};

    // State-specific metrics with enhanced null checks
    switch (token.state) {
      case 'new':
        const momentum = token.getPriceMomentum() || 0;
        return {
          ...metrics,
          'Price Momentum': `${momentum.toFixed(1)}%`,
          'Volume Change': `${(token.getVolumeChange(300) || 0).toFixed(0)}%`,
          'Buy Pressure': `${(marketStructure.buyPressure || 0).toFixed(0)}%`,
          'Market Health': `${(marketStructure.overallHealth || 0).toFixed(0)}%`,
          'To Pump': `${(((MCAP.PUMP - marketCapUSD) / (MCAP.PUMP || 1) * 100) || 0).toFixed(1)}%`
        };

      case 'pumping':
        return {
          ...metrics,
          'Pump Count': pumpMetrics.pumpCount || 0,
          'Gain Rate': `${(pumpMetrics.highestGainRate || 0).toFixed(1)}%/min`,
          'Price Accel': `${(pumpMetrics.priceAcceleration || 0).toFixed(1)}x`,
          'Buy Pressure': `${(marketStructure.buyPressure || 0).toFixed(0)}%`,
          'Market Health': `${(marketStructure.overallHealth || 0).toFixed(0)}%`,
          'Volume Spikes': (pumpMetrics.volumeSpikes || []).length
        };

      case 'drawdown':
        return {
          ...metrics,
          'Drawdown': `${(token.getDrawdownPercentage() || 0).toFixed(1)}%`,
          'Time in DD': this.formatTime((Date.now() - (token.drawdownStartTime || Date.now()))),
          'Structure Score': `${((marketStructure.structureScore || {}).overall || 0).toFixed(0)}%`,
          'Volume Health': `${(marketStructure.volumeHealth || 0).toFixed(0)}%`,
          'Buy Ratio': `${(marketStructure.buyRatio || 0).toFixed(2)}`,
          'Above Dead': `${(((marketCapUSD - MCAP.DEAD) / (MCAP.DEAD || 1) * 100) || 0).toFixed(1)}%`
        };

      case 'recovery':
        const breakdown = recoveryStrength.breakdown || {};
        return {
          ...metrics,
          'Recovery %': `${(recoveryStrength.total || 0).toFixed(1)}%`,
          'Buy Pressure': `${((breakdown.buyPressure?.buyRatio) || 0).toFixed(2)}`,
          'Volume Growth': `${(breakdown.volumeGrowth || 0).toFixed(0)}%`,
          'Price Stability': `${(breakdown.priceStability || 0).toFixed(0)}%`,
          'Market Health': `${(marketStructure.overallHealth || 0).toFixed(0)}%`
        };

      case 'open':
        const position = this.positionManager.getPositionByMint(token.mint);
        if (!position) return metrics;
        
        return {
          ...metrics,
          'Entry Price': `$${this.priceManager.solToUSD(position.entryPrice || 0).toFixed(4)}`,
          'Current P/L': `${(((token.getCurrentPrice() - (position.entryPrice || 0)) / (position.entryPrice || 1) * 100) || 0).toFixed(1)}%`,
          'Size Left': `${((position.remainingSize || 0) * 100).toFixed(0)}%`,
          'Max Upside': `${(position.maxUpside || 0).toFixed(1)}%`,
          'Max Drawdown': `${(position.maxDrawdown || 0).toFixed(1)}%`
        };

      case 'unsafe':
        return {
          ...metrics,
          'Unsafe Reason': token.unsafeReason || 'Unknown',
          'Market Health': `${(marketStructure.overallHealth || 0).toFixed(0)}%`,
          'Volume Health': `${(marketStructure.volumeHealth || 0).toFixed(0)}%`
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
      this.updateTraderMetrics();
      this.updateTraderReputation();
      this.updateTradingPatterns();
      this.screen.render();
    } catch (error) {
      throw error;
    }
  }

  updateTraderMetrics() {
    if (!this.traderManager) return;

    const trader = this.traderManager.getTrader(this.wallet.publicKey);
    if (!trader) return;

    const metrics = [
      `Total Trades: ${trader.reputation.totalTrades}`,
      `Profitable Trades: ${trader.reputation.profitableTrades}`,
      `Win Rate: ${((trader.reputation.profitableTrades / trader.reputation.totalTrades) * 100).toFixed(2)}%`,
      `Avg Hold Time: ${(trader.reputation.averageHoldTime / 1000 / 60).toFixed(2)} mins`,
      `Recovery Win Rate: ${trader.recoveryMetrics.recoveryWinRate.toFixed(2)}%`,
      `Best Recovery: ${trader.recoveryMetrics.bestRecoveryGain.toFixed(2)}%`
    ].join('\n');

    this.traderMetricsBox.setContent(metrics);
  }

  updateTraderReputation() {
    if (!this.traderManager) return;

    const trader = this.traderManager.getTrader(this.wallet.publicKey);
    if (!trader) return;

    const reputation = [
      `Reputation Score: ${trader.reputation.score}`,
      `Wash Trading Incidents: ${trader.reputation.washTradingIncidents}`,
      `Rug Pull Involvements: ${trader.reputation.rugPullInvolvements}`,
      `Successful Pumps: ${trader.reputation.successfulPumps}`,
      `Failed Pumps: ${trader.reputation.failedPumps}`
    ].join('\n');

    this.traderReputationBox.setContent(reputation);
  }

  updateTradingPatterns() {
    if (!this.traderManager) return;

    const trader = this.traderManager.getTrader(this.wallet.publicKey);
    if (!trader) return;

    const patterns = [
      `Buy/Sell Ratio: ${trader.patterns.tradingBehavior.buyToSellRatio.toFixed(2)}`,
      `Avg Trade Size: ${trader.patterns.tradingBehavior.averageTradeSize.toFixed(2)}`,
      `Trade Frequency: ${trader.patterns.tradingBehavior.tradeFrequency.toFixed(2)}/hr`,
      `Trading Style:`,
      ` Early Accumulator: ${trader.patterns.recovery.recoveryStyle.earlyAccumulator}`,
      ` Trend Follower: ${trader.patterns.recovery.recoveryStyle.trendFollower}`,
      ` Breakout Trader: ${trader.patterns.recovery.recoveryStyle.breakoutTrader}`
    ].join('\n');

    this.tradingPatternsBox.setContent(patterns);
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
