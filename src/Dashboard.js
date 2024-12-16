const blessed = require("blessed");
const contrib = require("blessed-contrib");

class Dashboard {
  constructor(
    wallet,
    tokenTracker,
    positionManager,
    safetyChecker,
    priceManager,
    statsLogger
  ) {
    this.wallet = wallet;
    this.tokenTracker = tokenTracker;
    this.positionManager = positionManager;
    this.safetyChecker = safetyChecker;
    this.priceManager = priceManager;
    this.statsLogger = statsLogger;

    // Create blessed screen
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Money Printer Dashboard',
      fullUnicode: true
    });

    // Initialize components
    this.layoutManager = new LayoutManager(this.screen);
    this.tokenList = new TokenList(this.layoutManager.getComponent('leftPane'));
    this.detailView = new DetailView(this.layoutManager.getComponent('rightPane'));

    // Set up event handlers
    this.setupEventHandlers();
    
    // Store original console methods
    this.originalConsoleLog = console.log;
    this.originalConsoleError = console.error;

    // Override console methods
    this.overrideConsoleMethods();
    
    // Initial render
    this.screen.render();
  }

  overrideConsoleMethods() {
    console.log = (...args) => {
      const message = args.join(" ");
      this.layoutManager.log(message, 'info');
      this.writeToLogFile(message, 'info');
    };

    console.error = (...args) => {
      const message = args.join(" ");
      const stack = new Error().stack;
      const fullError = `${message}\n${stack}`;
      
      this.layoutManager.log(message, 'error');
      this.writeToLogFile(fullError, 'error');
    };
  }

  setupEventHandlers() {
    // Layout manager events
    this.layoutManager.on('quit', () => {
      this.screen.destroy();
      process.exit(0);
    });

    this.layoutManager.on('sectionChanged', (section) => {
      switch (section) {
        case 'leftPane':
          this.tokenList.focus();
          break;
        case 'rightPane':
          // Future: handle right pane focus
          break;
      }
    });

    // Token list events
    this.tokenList.on('tokenSelected', (token) => {
      this.detailView.updateToken(token);
    });

    // Token tracker events
    this.tokenTracker.on('tokenAdded', (token) => {
      this.updateTokens();
    });

    this.tokenTracker.on('tokenUpdated', (token) => {
      this.updateTokens();
      if (this.detailView.currentToken?.mint === token.mint) {
        this.detailView.updateToken(token);
      }
    });

    // Price manager events
    this.priceManager.on('priceUpdate', ({ mint, price }) => {
      this.updateStatusMetrics();
    });

    // Position manager events
    this.positionManager.on('positionOpened', (position) => {
      this.layoutManager.log(`Opened position for ${position.symbol}`, 'success');
      this.updateTokens();
    });

    this.positionManager.on('positionClosed', (position) => {
      this.layoutManager.log(`Closed position for ${position.symbol}`, 'info');
      this.updateTokens();
    });

    // Stats logger events
    this.statsLogger.on('error', (error) => {
      this.layoutManager.log(error.message, 'error');
    });

    this.statsLogger.on('warning', (message) => {
      this.layoutManager.log(message, 'warning');
    });
  }

  updateTokens() {
    const tokens = Array.from(this.tokenTracker.tokens.values());
    this.tokenList.updateTokens(tokens);
  }

  updateStatusMetrics() {
    const metrics = {
      balance: this.wallet.getBalance(),
      pnl: this.positionManager.getTotalPnL(),
      activePositions: this.positionManager.getActivePositionsCount(),
      systemHealth: this.getSystemHealth()
    };

    this.layoutManager.updateStatusBar(metrics);
  }

  getSystemHealth() {
    const isHealthy = 
      this.priceManager.isConnected() &&
      this.tokenTracker.isRunning() &&
      this.statsLogger.isOperational() &&
      this.safetyChecker.isOperational();
    
    return isHealthy ? 'healthy' : 'degraded';
  }

  start() {
    // Initial updates
    this.updateTokens();
    this.updateStatusMetrics();
    
    // Focus the token list by default
    this.tokenList.focus();
    
    // Render the screen
    this.screen.render();
  }
}

module.exports = Dashboard;
