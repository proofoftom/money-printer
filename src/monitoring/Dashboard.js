const blessed = require("blessed");
const contrib = require("blessed-contrib");
const TokenCard = require('./TokenCard');
const TokenDetailModal = require('./TokenDetailModal');
const EventEmitter = require('events');

class Dashboard extends EventEmitter {
  constructor(
    wallet,
    tokenManager,
    positionManager,
    safetyChecker,
    priceManager,
    traderManager,
    config
  ) {
    // Initialize EventEmitter first
    super();
    
    try {
      // Store dependencies
      this.wallet = wallet;
      this.tokenManager = tokenManager;
      this.positionManager = positionManager;
      this.safetyChecker = safetyChecker;
      this.priceManager = priceManager;
      this.traderManager = traderManager;
      this.config = config;

      // Initialize state
      this.trades = [];
      this.balanceHistory = {
        x: [],
        y: [],
      };
      this.tokenCards = new Map();
      this.selectedTokenIndex = 0;
      this.sortMetric = 'marketCap';

      // Store original console methods
      this.originalConsoleLog = console.log;
      this.originalConsoleError = console.error;

      // Initialize UI
      this.initializeDashboard();

      // Set up console overrides now that statusBox exists
      this.setupConsoleOverrides();

      // Set up event handlers
      this.setupEventHandling();
    } catch (error) {
      console.error('Error initializing Dashboard:', error);
      throw error;
    }
  }

  setupConsoleOverrides() {
    // Override console.log to write to status box
    console.log = (...args) => {
      if (this.statusBox) {
        const message = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');
        this.statusBox.log(message);
        this.screen.render();
      }
      // Also write to original console for debugging
      this.originalConsoleLog(...args);
    };

    // Override console.error to write to status box in red
    console.error = (...args) => {
      if (this.statusBox) {
        const message = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');
        this.statusBox.log(`{red-fg}${message}{/red-fg}`);
        this.screen.render();
      }
      // Also write to original console for debugging
      this.originalConsoleError(...args);
    };
  }

  initializeDashboard() {
    try {
      // Create blessed screen
      this.screen = blessed.screen({
        smartCSR: true,
        title: 'Token Trading Dashboard'
      });

      // Create status box for logging
      this.statusBox = blessed.log({
        parent: this.screen,
        bottom: 0,
        left: 0,
        height: '25%',
        width: '100%',
        border: { type: 'line' },
        label: ' System Status ',
        tags: true,
        keys: true,
        vi: true,
        mouse: true,
        scrollback: 100,
        scrollbar: {
          ch: ' ',
          track: {
            bg: 'yellow'
          },
          style: {
            inverse: true
          }
        }
      });

      // Create layout grid
      this.grid = new contrib.grid({
        rows: 12,
        cols: 12,
        screen: this.screen,
      });

      // Create base layout
      this.createLayout();

      // Set up periodic updates
      this.setupPeriodicUpdates();

      // Initial render
      this.screen.render();
    } catch (error) {
      console.error('Error initializing dashboard:', error);
      throw error;
    }
  }

  setupEventHandling() {
    try {
      // Set max listeners to avoid memory leak warnings
      this.setMaxListeners(50);
      this.tokenManager.setMaxListeners(50);
      
      // Handle token events
      this.tokenManager.on('tokenAdded', (token) => {
        try {
          this.logStatus(`New token added: ${token.symbol}`);
          this.refreshTokenGrid();
        } catch (error) {
          console.error('Error handling tokenAdded event:', error);
        }
      });

      this.tokenManager.on('tokenRemoved', (token) => {
        try {
          this.logStatus(`Token removed: ${token.symbol}`);
          // Clean up token card if it exists
          const card = this.tokenCards.get(token.mint);
          if (card) {
            card.cleanup();
            this.tokenCards.delete(token.mint);
          }
          this.refreshTokenGrid();
        } catch (error) {
          console.error('Error handling tokenRemoved event:', error);
        }
      });

      // Handle trade events
      this.tokenManager.on('trade', (token, trade) => {
        try {
          if (!token || !trade) {
            console.error('Invalid trade event data:', { token, trade });
            return;
          }

          // Update token card
          const card = this.tokenCards.get(token.mint);
          if (card) {
            card.updateMetrics(token);
          }

          // Log trade
          this.logTrade({
            type: trade.type,
            mint: token.mint,
            symbol: token.symbol,
            amount: trade.amount,
            price: trade.price
          });

          // Update metrics
          this.handleMetricsUpdate(token);
        } catch (error) {
          console.error('Error handling trade event:', error);
        }
      });

      // Handle wallet balance updates
      if (this.wallet) {
        this.wallet.on('balanceUpdate', ({ newBalance, change }) => {
          try {
            this.updateBalanceHistory();
            this.updateWalletStatus();
            this.logStatus(`Wallet balance updated: ${change > 0 ? '+' : ''}${change.toFixed(4)} SOL`);
          } catch (error) {
            console.error('Error handling balance update:', error);
          }
        });

        this.wallet.on('trade', ({ profitLoss }) => {
          try {
            this.logStatus(`Trade completed: ${profitLoss > 0 ? '+' : ''}${profitLoss.toFixed(4)} SOL`);
            this.updateBalanceHistory();
          } catch (error) {
            console.error('Error handling trade event:', error);
          }
        });
      }

      // Handle error events
      this.tokenManager.on('error', (error) => {
        this.logStatus(`Error: ${error.message}`, 'error');
      });

      this.logStatus('Event handlers initialized');
    } catch (error) {
      console.error('Error setting up event handlers:', error);
      throw error;
    }
  }

  handleMetricsUpdate(token) {
    try {
      if (!token) return;

      const metrics = {
        price: token.currentPrice,
        marketCap: token.marketCapSol,
        volume: token.volume24h,
        holders: token.uniqueHolders
      };

      this.updateMetricsBoxes(metrics);
      this.screen.render();
    } catch (error) {
      console.error('Error updating metrics:', error);
    }
  }

  createLayout() {
    try {
      // Create wallet status box (top row)
      this.walletBox = this.grid.set(0, 0, 3, 3, blessed.box, {
        label: " Wallet Status ",
        content: this.getWalletStatus(),
        tags: true,
        border: {
          type: "line",
        },
        style: {
          fg: "white",
          border: {
            fg: "white",
          },
        },
      });

      // Create status box
      this.statusBox = this.grid.set(0, 3, 3, 9, blessed.log, {
        label: " Status ",
        tags: true,
        scrollable: true,
        alwaysScroll: true,
        scrollbar: {
          ch: " ",
          inverse: true,
        },
        border: {
          type: "line",
        },
        style: {
          fg: "white",
          border: {
            fg: "white",
          },
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

      // Create token grid
      this.tokenGrid = blessed.box({
        parent: this.screen,
        top: '30%',
        left: 0,
        width: '100%',
        height: '70%',
        scrollable: true,
        mouse: true,
        keys: true,
        vi: true
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

      // Active Positions box (half width)
      this.activePositionsBox = this.grid.set(3, 8, 9, 2, blessed.box, {
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

      // Stack metrics boxes to the right of Active Positions
      this.traderMetricsBox = this.grid.set(3, 10, 3, 2, blessed.box, {
        label: " Trader Metrics ",
        content: "Loading trader data...",
        border: "line",
        tags: true,
        padding: 1,
        style: {
          label: { bold: true },
        },
      });

      this.traderReputationBox = this.grid.set(6, 10, 3, 2, blessed.box, {
        label: " Trader Reputation ",
        content: "Loading reputation data...",
        border: "line",
        tags: true,
        padding: 1,
        style: {
          label: { bold: true },
        },
      });

      this.tradingPatternsBox = this.grid.set(9, 10, 3, 2, blessed.box, {
        label: " Trading Patterns ",
        content: "Analyzing patterns...",
        border: "line",
        tags: true,
        padding: 1,
        style: {
          label: { bold: true },
        },
      });

      // Setup keyboard handlers
      this.setupKeyboardHandlers();
    } catch (error) {
      console.error('Error creating layout:', error);
      throw error;
    }
  }

  setupKeyboardHandlers() {
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

    this.screen.key(['up', 'down'], (ch, key) => {
      const tokens = Array.from(this.tokenCards.values());
      tokens[this.selectedTokenIndex]?.blur();
      
      if (key.name === 'up') {
        this.selectedTokenIndex = Math.max(0, this.selectedTokenIndex - 1);
      } else {
        this.selectedTokenIndex = Math.min(tokens.length - 1, this.selectedTokenIndex + 1);
      }
      
      tokens[this.selectedTokenIndex]?.focus();
      this.screen.render();
    });

    this.screen.key('enter', () => {
      const tokens = Array.from(this.tokenCards.values());
      const selectedToken = tokens[this.selectedTokenIndex];
      if (selectedToken) {
        const modal = new TokenDetailModal(this.screen, selectedToken.token, this.traderManager);
        modal.show();
      }
    });

    // Sorting shortcuts
    this.screen.key('m', () => this.sortTokens('marketCap'));
    this.screen.key('v', () => this.sortTokens('volume'));
    this.screen.key('h', () => this.sortTokens('holders'));
    this.screen.key('t', () => this.sortTokens('transactions'));
    this.screen.key('c', () => this.sortTokens('concentration'));
  }

  sortTokens(metric) {
    this.sortMetric = metric;
    this.refreshTokenGrid();
  }

  refreshTokenGrid() {
    // Clear existing cards
    this.tokenCards.forEach(card => card.destroy());
    this.tokenCards.clear();

    // Get sorted tokens
    const tokens = Array.from(this.tokenManager.tokens.values())
      .sort((a, b) => {
        switch(this.sortMetric) {
          case 'marketCap':
            return b.marketCap - a.marketCap;
          case 'volume':
            return b.volume['5m'] - a.volume['5m'];
          case 'holders':
            return b.holders - a.holders;
          case 'transactions':
            return b.transactions - a.transactions;
          case 'concentration':
            return b.top10Concentration - a.top10Concentration;
          default:
            return 0;
        }
      });

    // Create new cards
    tokens.forEach((token, index) => {
      const card = new TokenCard(this.tokenGrid, token, this.traderManager);
      const row = Math.floor(index / 2);
      const col = index % 2;
      
      card.setPosition(
        row * 3,
        col * '50%',
        '50%',
        3
      );

      this.tokenCards.set(token.mint, card);
    });

    // Focus selected token
    const tokenArray = Array.from(this.tokenCards.values());
    if (tokenArray[this.selectedTokenIndex]) {
      tokenArray[this.selectedTokenIndex].focus();
    }

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

  updateMetricsBoxes(metrics) {
    // Update trader metrics
    if (this.traderMetricsBox) {
      const traderContent = [
        'Volume (24h):',
        `1m: ${this.formatVolume(metrics.volume['1m'])}`,
        `5m: ${this.formatVolume(metrics.volume['5m'])}`,
        `30m: ${this.formatVolume(metrics.volume['30m'])}`,
        '',
        `Price: ${metrics.price.toFixed(4)} SOL`,
        `Market Cap: ${metrics.marketCap.toFixed(2)} SOL`
      ].join('\n');
      this.traderMetricsBox.setContent(traderContent);
    }

    // Update recovery metrics in trading patterns box
    if (this.tradingPatternsBox && metrics.recovery) {
      const patternsContent = [
        `Recovery Phase: ${metrics.recovery.phase}`,
        `Recovery Strength: ${(metrics.recovery.strength * 100).toFixed(1)}%`,
        `Buy Pressure: ${(metrics.recovery.buyPressure * 100).toFixed(1)}%`
      ].join('\n');
      this.tradingPatternsBox.setContent(patternsContent);
    }
  }

  updateTokenStateBoxes() {
    const tokens = {
      new: this.getTokensByState('new'),
      pumping: this.getTokensByState('pumping'),
      drawdown: this.getTokensByState('drawdown'),
      recovery: this.getTokensByState('recovery')
    };

    // Update each state box
    if (this.newTokensBox) {
      this.newTokensBox.setContent(this.formatTokenList(tokens.new));
    }
    if (this.pumpingBox) {
      this.pumpingBox.setContent(this.formatTokenList(tokens.pumping));
    }
    if (this.drawdownBox) {
      this.drawdownBox.setContent(this.formatTokenList(tokens.drawdown));
    }
    if (this.recoveryBox) {
      this.recoveryBox.setContent(this.formatTokenList(tokens.recovery));
    }

    this.screen.render();
  }

  formatTokenList(tokens) {
    if (!tokens.length) return 'No tokens';
    
    return tokens.map(token => {
      const price = token.currentPrice.toFixed(4);
      const change = token.getPriceChange(300).toFixed(1); // 5-minute change
      const volume = this.formatVolume(token.volume5m);
      
      return [
        token.symbol,
        `${price} SOL`,
        `${change}%`,
        `Vol: ${volume}`
      ].join(' | ');
    }).join('\n');
  }

  setupPeriodicUpdates() {
    // Update dashboard components every second
    setInterval(() => {
      // Update wallet status
      this.updateWalletStatus();
      
      // Update token metrics
      this.refreshTokenGrid();
      
      // Update trade history
      this.updateTradeHistory();
      
      // Update balance chart
      this.updateBalanceChart();
      
      // Render screen
      this.screen.render();
    }, 1000);
  }

  updateWalletStatus() {
    if (this.walletBox) {
      this.walletBox.setContent(this.getWalletStatus());
    }
  }

  updateTradeHistory() {
    if (this.tradesBox) {
      // Get last 10 trades
      const recentTrades = this.trades.slice(-10).reverse();
      this.tradesBox.setContent(this.formatTradeHistory(recentTrades));
    }
  }

  updateBalanceChart() {
    if (this.balanceChart && this.balanceHistory.x.length > 0) {
      this.balanceChart.setData({
        x: this.balanceHistory.x,
        y: this.balanceHistory.y,
      });
    }
  }
}

module.exports = Dashboard;
