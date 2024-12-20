const blessed = require('blessed');
const contrib = require('blessed-contrib');
const { EventEmitter } = require('events');

class Dashboard extends EventEmitter {
  constructor(config, logger, safetyChecker, tokenTracker) {
    super();
    this.config = config;
    this.logger = logger;
    this.safetyChecker = safetyChecker;
    this.tokenTracker = tokenTracker;
    this.screen = null;
    this.grid = null;
    this.components = {};
    this.activeComponent = null;
    this.isHelpVisible = false;
  }

  initialize() {
    // Create blessed screen
    this.screen = blessed.screen({
      smartCSR: true,
      title: '💰 Money Printer Dashboard',
      cursor: {
        artificial: true,
        shape: 'line',
        blink: true,
        color: null
      }
    });

    // Create grid layout
    this.grid = new contrib.grid({
      rows: 12,
      cols: 12,
      screen: this.screen
    });

    // Initialize components
    this.initializeComponents();
    this.setupKeyboardHandlers();
    this.setupEventHandlers();

    // Initial render
    this.screen.render();
  }

  initializeComponents() {
    // Price chart (6x6 in top-left)
    this.components.chart = this.grid.set(0, 0, 6, 6, contrib.line, {
      style: {
        line: this.config.DASHBOARD.COLORS.PRICE_UP,
        text: this.config.DASHBOARD.COLORS.INFO,
        baseline: this.config.DASHBOARD.COLORS.GRID
      },
      xLabelPadding: 3,
      xPadding: 5,
      label: 'Price Chart',
      showLegend: true,
      legend: { width: 20 }
    });

    // Wallet info (2x6 in top-right)
    this.components.wallet = this.grid.set(0, 6, 2, 6, contrib.gauge, {
      label: 'Wallet Balance',
      percent: [0],
      style: {
        fg: this.config.DASHBOARD.COLORS.INFO
      }
    });

    // Positions table (2x6 in middle-right)
    this.components.positions = this.grid.set(2, 6, 2, 6, contrib.table, {
      keys: true,
      fg: this.config.DASHBOARD.COLORS.INFO,
      label: 'Active Positions',
      columnSpacing: 2,
      columnWidth: [10, 8, 8, 8, 8]
    });

    // Token metrics (2x6 in lower-right)
    this.components.metrics = this.grid.set(4, 6, 2, 6, contrib.table, {
      keys: true,
      fg: this.config.DASHBOARD.COLORS.INFO,
      label: 'Token Metrics',
      columnSpacing: 2,
      columnWidth: [15, 20]
    });

    // Log panel (4x6 in bottom-left)
    this.components.log = this.grid.set(6, 0, 4, 6, contrib.log, {
      fg: this.config.DASHBOARD.COLORS.INFO,
      label: 'Events & Logs',
      bufferLength: this.config.DASHBOARD.LOG_BUFFER
    });

    // Alerts panel (4x6 in bottom-right)
    this.components.alerts = this.grid.set(6, 6, 4, 6, contrib.log, {
      fg: this.config.DASHBOARD.COLORS.ALERT,
      label: 'Alerts',
      bufferLength: 50
    });

    // Status bar (1x12 at bottom)
    this.components.status = this.grid.set(10, 0, 2, 12, blessed.box, {
      label: 'Status',
      padding: 1,
      style: {
        fg: this.config.DASHBOARD.COLORS.INFO
      }
    });

    // Help panel (hidden by default)
    this.components.help = blessed.box({
      parent: this.screen,
      label: 'Help',
      width: '50%',
      height: '50%',
      top: 'center',
      left: 'center',
      hidden: true,
      border: {
        type: 'line'
      },
      style: {
        fg: this.config.DASHBOARD.COLORS.INFO
      },
      content: this.getHelpContent()
    });
  }

  setupKeyboardHandlers() {
    // Navigation
    this.screen.key(['1'], () => this.focusComponent('chart'));
    this.screen.key(['2'], () => this.focusComponent('positions'));
    this.screen.key(['3'], () => this.focusComponent('log'));

    // Trading
    this.screen.key([this.config.SHORTCUTS.OPEN_POSITION], () => {
      this.emit('command', { type: 'openPosition' });
    });

    this.screen.key([this.config.SHORTCUTS.CLOSE_POSITION], () => {
      this.emit('command', { type: 'closePosition' });
    });

    // UI Controls
    this.screen.key([this.config.SHORTCUTS.HELP], () => this.toggleHelp());
    this.screen.key([this.config.SHORTCUTS.CLEAR_LOGS], () => this.clearLogs());
    this.screen.key([this.config.SHORTCUTS.QUIT, 'C-c'], () => this.quit());

    // Focus handling
    this.screen.key(['tab'], () => this.focusNext());
    this.screen.key(['S-tab'], () => this.focusPrevious());
  }

  setupEventHandlers() {
    // Handle log events
    this.on('log', (message) => {
      if (this.components.log) {
        this.components.log.log(message);
        this.screen.render();
      }
    });

    // Handle alert events
    this.on('alert', (message) => {
      if (this.components.alerts) {
        this.components.alerts.log(message);
        this.screen.render();
      }
    });

    // Handle safety check events
    this.safetyChecker.on('safetyCheck', ({ token, result, type }) => {
      const symbol = token.symbol;
      const reasons = result.reasons.join(', ');
      
      switch (type) {
        case 'tokenSafety':
          this.components.alerts.log(`🚫 ${symbol}: Failed safety check - ${reasons}`);
          break;
        case 'openPosition':
          this.components.alerts.log(`❌ ${symbol}: Cannot open position - ${reasons}`);
          break;
        case 'positionSize':
          this.components.alerts.log(`⚠️  ${symbol}: Invalid position size - ${reasons}`);
          break;
        case 'balance':
          this.components.alerts.log(`💰 ${symbol}: Balance issue - ${reasons}`);
          break;
      }
      this.screen.render();
    });

    // Handle token safety check failures
    this.tokenTracker.on('safetyCheckFailed', ({ token, reasons }) => {
      const symbol = token.symbol;
      const reasonsStr = reasons.join(', ');
      this.components.alerts.log(`🔒 ${symbol}: Safety check failed - ${reasonsStr}`);
      this.screen.render();
    });

    // Handle price updates
    this.on('priceUpdate', (data) => {
      this.updateChart(data);
      this.checkPriceAlerts(data);
    });

    // Handle wallet updates
    this.on('walletUpdate', (data) => {
      this.updateWallet(data);
      this.checkWalletAlerts(data);
    });

    // Handle position updates
    this.on('positionsUpdate', (positions) => {
      this.updatePositions(positions);
    });

    // Handle token metric updates
    this.on('metricsUpdate', (data) => {
      this.updateMetrics(data);
    });
  }

  // Component update methods
  updateChart(data) {
    // Update price chart with new data
    const { prices, volumes } = data;
    this.components.chart.setData([{
      title: 'Price',
      x: prices.map(p => p.time),
      y: prices.map(p => p.price),
      style: {
        line: prices[prices.length - 1].price >= prices[0].price ? 
          this.config.DASHBOARD.COLORS.PRICE_UP : 
          this.config.DASHBOARD.COLORS.PRICE_DOWN
      }
    }]);
    this.screen.render();
  }

  updatePositions(positions) {
    // Update positions table
    const data = positions.map(p => [
      p.token.symbol,
      p.size.toFixed(4),
      p.entryPrice.toFixed(this.config.DASHBOARD.CHART.PRICE_DECIMALS),
      p.currentPrice.toFixed(this.config.DASHBOARD.CHART.PRICE_DECIMALS),
      p.realizedPnLWithFeesSol.toFixed(4)
    ]);
    
    this.components.positions.setData({
      headers: ['Token', 'Size', 'Entry', 'Current', 'P&L'],
      data
    });
    this.screen.render();
  }

  updateWallet(data) {
    // Update wallet gauge
    const { balance, initialBalance } = data;
    const percent = Math.min(100, (balance / initialBalance) * 100);
    this.components.wallet.setPercent(percent);
    this.screen.render();
  }

  updateMetrics(data) {
    // Update token metrics table
    const metrics = [
      ['Market Cap', `${data.marketCapSol.toFixed(2)} SOL`],
      ['Age', `${data.ageSeconds}s`],
      ['Holders', data.holderCount.toString()],
      ['Transactions', data.transactionCount.toString()],
      ['Concentration', `${data.holderConcentration.toFixed(2)}%`]
    ];
    
    this.components.metrics.setData({
      headers: ['Metric', 'Value'],
      data: metrics
    });
    this.screen.render();
  }

  // Alert methods
  checkPriceAlerts(data) {
    if (!this.config.ALERTS.PRICE_CHANGE.enabled) return;
    
    const { price, previousPrice } = data;
    const change = Math.abs((price - previousPrice) / previousPrice * 100);
    
    if (change >= this.config.ALERTS.PRICE_CHANGE.threshold) {
      this.alert(`Price changed by ${change.toFixed(2)}%`);
      this.flashStatusBar();
    }
  }

  checkWalletAlerts(data) {
    if (!this.config.ALERTS.WALLET_BALANCE.enabled) return;
    
    const { balance, previousBalance } = data;
    const change = (balance - previousBalance) / previousBalance * 100;
    
    if (Math.abs(change) >= this.config.ALERTS.WALLET_BALANCE.threshold) {
      this.alert(`Wallet balance changed by ${change.toFixed(2)}%`);
      this.flashStatusBar();
    }
  }

  // UI helper methods
  focusComponent(name) {
    if (this.activeComponent) {
      this.components[this.activeComponent].style.border.fg = 
        this.config.DASHBOARD.COLORS.INFO;
    }
    
    this.activeComponent = name;
    this.components[name].style.border.fg = 'white';
    this.screen.render();
  }

  toggleHelp() {
    this.isHelpVisible = !this.isHelpVisible;
    this.components.help.toggle();
    this.screen.render();
  }

  clearLogs() {
    this.components.log.setContent('');
    this.screen.render();
  }

  quit() {
    this.emit('quit');
    process.exit(0);
  }

  getHelpContent() {
    return `
      Keyboard Shortcuts:
      
      Navigation:
      1-3      - Focus panels
      Tab      - Next panel
      Shift+Tab- Previous panel
      
      Trading:
      ${this.config.SHORTCUTS.OPEN_POSITION}        - Open position
      ${this.config.SHORTCUTS.CLOSE_POSITION}        - Close position
      ${this.config.SHORTCUTS.TOKEN_DETAILS}        - Token details
      
      UI Control:
      ${this.config.SHORTCUTS.HELP}        - Toggle help
      ${this.config.SHORTCUTS.CLEAR_LOGS}        - Clear logs
      ${this.config.SHORTCUTS.QUIT}        - Quit
      
      Press any key to close
    `;
  }

  flashStatusBar() {
    const original = this.components.status.style.bg;
    this.components.status.style.bg = this.config.DASHBOARD.COLORS.ALERT;
    this.screen.render();
    
    setTimeout(() => {
      this.components.status.style.bg = original;
      this.screen.render();
    }, 500);
  }

  log(msg) {
    this.components.log.log(msg);
    this.screen.render();
  }

  alert(msg) {
    this.components.alerts.log(msg);
    if (this.config.ALERTS.SOUNDS.WARNING) {
      process.stdout.write('\x07'); // Terminal bell
    }
    this.screen.render();
  }
}

module.exports = Dashboard;
