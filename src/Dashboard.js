const blessed = require('blessed');
const contrib = require('blessed-contrib');
const EventEmitter = require('events');
const chalk = require('chalk');

class Dashboard extends EventEmitter {
  constructor(moneyPrinter) {
    super();
    try {
      this.moneyPrinter = moneyPrinter;
      this.tokens = new Map();
      this.activeTokens = new Set();
      this.selectedToken = null;
      
      this.setupScreen();
      this.setupLayout();
      this.setupKeybindings();
      this.setupUpdates();
    } catch (error) {
      console.error('Error initializing dashboard:', error);
      throw error;
    }
  }

  setupScreen() {
    try {
      this.screen = blessed.screen({
        smartCSR: true,
        title: '💸 Money Printer Dashboard',
        cursor: {
          artificial: true,
          shape: 'line',
          blink: true,
          color: null
        },
        fullUnicode: true,
        dockBorders: true,
        ignoreLocked: ['C-c']
      });

      // Enable key handling
      this.screen.key(['escape', 'q', 'C-c'], () => {
        this.screen.destroy();
        process.exit(0);
      });

      // Handle resize
      this.screen.on('resize', () => {
        this.render();
      });
    } catch (error) {
      console.error('Error setting up screen:', error);
      throw error;
    }
  }

  setupLayout() {
    try {
      // Create layout grid
      this.grid = new contrib.grid({
        rows: 12,
        cols: 12,
        screen: this.screen
      });

      // Trading Status Box (Top Left)
      this.statusBox = this.grid.set(0, 0, 2, 3, blessed.box, {
        label: ' Status ',
        tags: true,
        border: { type: 'line' },
        style: { border: { fg: 'blue' } }
      });

      // Performance Metrics (Top Middle)
      this.metricsBox = this.grid.set(0, 3, 2, 6, contrib.table, {
        label: ' Performance Metrics ',
        keys: true,
        fg: 'white',
        selectedFg: 'white',
        selectedBg: 'blue',
        interactive: false,
        columnSpacing: 2,
        columnWidth: [20, 12]
      });

      // Alerts Box (Top Right)
      this.alertsBox = this.grid.set(0, 9, 2, 3, blessed.log, {
        label: ' Alerts ',
        tags: true,
        border: { type: 'line' },
        style: { border: { fg: 'red' } },
        scrollable: true,
        scrollbar: { ch: ' ', track: { bg: 'grey' } }
      });

      // Token States (Left)
      this.tokenStates = {
        new: this.grid.set(2, 0, 2, 3, blessed.box, {
          label: ' New Tokens ',
          tags: true,
          border: { type: 'line' },
          style: { border: { fg: 'yellow' } },
          scrollable: true,
          mouse: true
        }),
        monitoring: this.grid.set(4, 0, 2, 3, blessed.box, {
          label: ' Monitoring ',
          tags: true,
          border: { type: 'line' },
          style: { border: { fg: 'blue' } },
          scrollable: true,
          mouse: true
        }),
        ready: this.grid.set(6, 0, 2, 3, blessed.box, {
          label: ' Ready for Position ',
          tags: true,
          border: { type: 'line' },
          style: { border: { fg: 'green' } },
          scrollable: true,
          mouse: true
        }),
        active: this.grid.set(8, 0, 2, 3, blessed.box, {
          label: ' Active Positions ',
          tags: true,
          border: { type: 'line' },
          style: { border: { fg: 'magenta' } },
          scrollable: true,
          mouse: true
        })
      };

      // Main Chart (Center)
      this.chart = this.grid.set(2, 3, 6, 9, contrib.line, {
        label: ' Price Chart ',
        showLegend: true,
        legend: { width: 20 },
        style: { line: 'yellow', text: 'white', baseline: 'black' }
      });

      // Token Details (Bottom Left)
      this.tokenDetails = this.grid.set(10, 0, 2, 3, blessed.box, {
        label: ' Token Details ',
        tags: true,
        border: { type: 'line' },
        style: { border: { fg: 'blue' } },
        content: 'Select a token to view details'
      });

      // Trade History (Bottom Middle)
      this.tradeHistory = this.grid.set(8, 3, 4, 6, contrib.table, {
        label: ' Trade History ',
        keys: true,
        fg: 'white',
        selectedFg: 'white',
        selectedBg: 'blue',
        interactive: true,
        columnSpacing: 1,
        columnWidth: [10, 8, 8, 8, 10]
      });

      // Controls Help (Bottom Right)
      this.controlsBox = this.grid.set(8, 9, 4, 3, blessed.box, {
        label: ' Controls ',
        tags: true,
        border: { type: 'line' },
        style: { border: { fg: 'blue' } },
        content: `
{bold}Keyboard Controls:{/bold}
Space: Pause/Resume Trading
R: Reset Charts
Q: Quit
↑/↓: Navigate Tokens
Enter: Select Token
C: Configure Settings
      `
      });

      // Make token state boxes clickable
      Object.values(this.tokenStates).forEach(box => {
        box.on('click', () => {
          const content = box.getContent();
          const lines = content.split('\n');
          const clicked = Math.floor(box.childOffset / 2);
          if (clicked < lines.length) {
            const symbol = lines[clicked].split(' ')[0];
            this.selectedToken = symbol;
            this.updateTokenDetails();
            this.updateCharts();
          }
        });
      });

    } catch (error) {
      console.error('Error setting up layout:', error);
      throw error;
    }
  }

  setupKeybindings() {
    try {
      // Quit on q, C-c
      this.screen.key(['q', 'C-c'], () => process.exit(0));

      // Pause/Resume trading on Space
      this.screen.key(['space'], () => {
        const trading = this.moneyPrinter.positionManager.toggleTrading();
        this.updateStatus();
        this.alertsBox.log(`Trading ${trading ? 'resumed' : 'paused'}`);
      });

      // Reset charts on r
      this.screen.key(['r'], () => {
        this.tokens.clear();
        this.updateCharts();
      });

      // Open config wizard on c
      this.screen.key(['c'], async () => {
        // Temporarily clear screen
        this.screen.destroy();
        
        // Run config wizard
        const ConfigWizard = require('./ConfigWizard');
        const wizard = new ConfigWizard(this.moneyPrinter.config);
        await wizard.start();
        
        // Restore dashboard
        this.setupScreen();
        this.setupLayout();
        this.setupKeybindings();
        this.render();
      });

      // Token selection
      Object.values(this.tokenStates).forEach(box => {
        box.on('select', (item) => {
          this.selectedToken = item.content.split(' ')[0];
          this.updateTokenDetails();
          this.updateCharts();
        });
      });
    } catch (error) {
      console.error('Error setting up keybindings:', error);
      throw error;
    }
  }

  setupUpdates() {
    try {
      // Update metrics every second
      setInterval(() => {
        this.updateMetrics();
        this.updateTokenStates();
        this.render();
      }, 1000);

      // Listen for new tokens
      this.moneyPrinter.tokenTracker.on('newToken', (tokenData) => {
        const token = this.moneyPrinter.tokenTracker.tokens.get(tokenData.mint);
        if (token) {
          this.tokens.set(token.mint, {
            symbol: token.symbol,
            prices: [token.currentPrice],
            volumes: [0]
          });
          this.updateTokenStates();
          this.alertsBox.log(`New token detected: ${token.symbol}`);
        }
      });

      // Listen for token trades
      this.moneyPrinter.tokenTracker.on('tokenTrade', (tradeData) => {
        const token = this.moneyPrinter.tokenTracker.tokens.get(tradeData.mint);
        if (token) {
          const tokenData = this.tokens.get(token.mint) || {
            symbol: token.symbol,
            prices: [],
            volumes: []
          };
          
          tokenData.prices.push(token.currentPrice);
          tokenData.volumes.push(tradeData.tokenAmount);
          
          if (tokenData.prices.length > 100) {
            tokenData.prices.shift();
            tokenData.volumes.shift();
          }
          
          this.tokens.set(token.mint, tokenData);
          this.updateCharts();
          this.updateTokenStates();
        }
      });

      // Listen for trades
      this.moneyPrinter.positionManager.on('positionOpened', (position) => {
        this.alertsBox.log(chalk.green(`Position opened: ${position.symbol}`));
        this.updateTradeHistory();
        this.updateTokenStates();
      });

      this.moneyPrinter.positionManager.on('positionClosed', (data) => {
        this.alertsBox.log(chalk.yellow(`Position closed: ${data.position.symbol} (${data.reason})`));
        this.updateTradeHistory();
        this.updateTokenStates();
      });

      // Listen for analytics updates
      this.moneyPrinter.analytics.on('tradeAnalytics', () => {
        this.updateMetrics();
      });
    } catch (error) {
      console.error('Error setting up updates:', error);
    }
  }

  formatUSD(amount) {
    if (amount >= 1000000) {
      return `$${(amount / 1000000).toFixed(1)}M`;
    } else if (amount >= 1000) {
      return `$${(amount / 1000).toFixed(1)}k`;
    } else {
      return `$${Math.round(amount)}`;
    }
  }

  updateStatus() {
    try {
      const trading = this.moneyPrinter.positionManager._tradingEnabled;
      const position = this.moneyPrinter.positionManager.position;
      const wallet = this.moneyPrinter.wallet;

      this.statusBox.setContent(`
{bold}Trading Status:{/bold} ${trading ? '{green-fg}Active{/}' : '{red-fg}Paused{/}'}
{bold}Current Position:{/bold} ${position ? position.symbol : 'None'}
{bold}Wallet Balance:{/bold} ${wallet.getBalance().toFixed(2)} SOL
    `);
    } catch (error) {
      console.error('Error updating status:', error);
      throw error;
    }
  }

  updateMetrics() {
    try {
      const metrics = this.moneyPrinter.analytics.getAllMetrics();
      const data = [
        ['Total Trades', metrics.trades.total],
        ['Win Rate', metrics.trades.winRate],
        ['Total Profit', `${metrics.trades.totalProfitSol} SOL`],
        ['Avg Trade Time', metrics.trades.avgTimeInPosition],
        ['WS Latency', `${metrics.performance.websocket.avg}ms`]
      ];

      this.metricsBox.setData({
        headers: ['Metric', 'Value'],
        data: data
      });
    } catch (error) {
      console.error('Error updating metrics:', error);
      throw error;
    }
  }

  updateTokenStates() {
    try {
      const tokens = Array.from(this.moneyPrinter.tokenTracker.tokens.values());

      const byState = {
        new: tokens.filter(t => {
          const age = (Date.now() - t.createdAt) / 1000 / 60;
          return age < 1;
        }),
        monitoring: tokens.filter(t => {
          const age = (Date.now() - t.createdAt) / 1000 / 60;
          return age >= 1 && t.state === 'NEW';
        }),
        ready: tokens.filter(t => t.state === 'READY'),
        active: tokens.filter(t => t.state === 'ACTIVE' || t.hasPosition)
      };

      // Update each state box
      Object.entries(byState).forEach(([state, tokens]) => {
        const box = this.tokenStates[state];
        if (!box) return;

        const content = tokens.map(token => {
          const age = Math.floor((Date.now() - token.createdAt) / 1000 / 60);
          const marketCapUSD = token.marketCapSol * this.moneyPrinter.priceManager.solPriceUSD;
          const volume = token.volume24h?.toFixed(2) || '0.00';
          const mcap = this.formatUSD(marketCapUSD);
          
          let line = `${token.symbol} ${mcap}`;
          switch (state) {
            case 'new':
              line += ` {yellow-fg}${age}m old{/}`;
              break;
            case 'monitoring':
              line += ` Vol:${volume}`;
              break;
            case 'ready':
              const score = token.pumpScore || 0;
              line += ` {green-fg}Score:${score.toFixed(2)}{/}`;
              break;
            case 'active':
              const position = this.moneyPrinter.positionManager.getPosition(token.mint);
              if (position) {
                const pnl = position.unrealizedPnLPercent;
                const color = pnl >= 0 ? 'green' : 'red';
                line += ` {${color}-fg}${pnl.toFixed(2)}%{/}`;
              }
              break;
          }
          return line;
        }).join('\n');

        box.setContent(content || 'No tokens');
      });

      this.render();
    } catch (error) {
      console.error('Error updating token states:', error);
    }
  }

  updateTokenDetails() {
    try {
      if (!this.selectedToken) return;

      const token = this.moneyPrinter.tokenTracker.tokens.get(this.selectedToken);
      if (!token) return;

      const marketCapUSD = token.marketCapSol * this.moneyPrinter.priceManager.solPriceUSD;
      this.tokenDetails.setContent(`
{bold}Symbol:{/bold} ${token.symbol}
{bold}Mint:{/bold} ${token.mint}
{bold}Market Cap:{/bold} ${this.formatUSD(marketCapUSD)}
{bold}24h Volume:{/bold} ${token.volume24h.toFixed(2)} SOL
{bold}Age:{/bold} ${Math.floor((Date.now() - token.createdAt) / 1000 / 60)}m
  `);
    } catch (error) {
      console.error('Error updating token details:', error);
    }
  }

  updateCharts() {
    try {
      if (!this.selectedToken) return;

      const token = this.tokens.get(this.selectedToken);
      if (!token) return;

      const prices = token.prices;
      const volumes = token.volumes;
      const times = Array.from({ length: prices.length }, (_, i) => i.toString());

      this.chart.setData([{
        title: 'Price',
        x: times,
        y: prices,
        style: { line: 'yellow' }
      }, {
        title: 'Volume',
        x: times,
        y: volumes,
        style: { line: 'blue' }
      }]);
    } catch (error) {
      console.error('Error updating charts:', error);
      throw error;
    }
  }

  updateTradeHistory() {
    try {
      const trades = this.moneyPrinter.analytics.getTradeMetrics().trades || [];
      const data = trades.slice(-5).map(trade => [
        trade.symbol,
        trade.entryPrice.toFixed(4),
        trade.exitPrice.toFixed(4),
        trade.profitSol.toFixed(4),
        trade.duration
      ]);

      this.tradeHistory.setData({
        headers: ['Token', 'Entry', 'Exit', 'P/L', 'Duration'],
        data: data
      });
    } catch (error) {
      console.error('Error updating trade history:', error);
      throw error;
    }
  }

  render() {
    try {
      if (!this.screen) {
        console.error('Screen not initialized!');
        return;
      }
      this.screen.render();
    } catch (error) {
      console.error('Error rendering screen:', error);
      throw error;
    }
  }

  start() {
    try {
      // Initial updates
      this.updateStatus();
      this.updateMetrics();
      this.updateTokenStates();
      this.updateTradeHistory();
      
      // Start rendering
      this.render();
    } catch (error) {
      console.error('Error starting dashboard:', error);
      throw error;
    }
  }
}

module.exports = Dashboard;
