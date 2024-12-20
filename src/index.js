const TokenTracker = require("./TokenTracker");
const WebSocketManager = require("./WebSocketManager");
const SafetyChecker = require("./SafetyChecker");
const PositionManager = require("./PositionManager");
const PriceManager = require("./PriceManager");
const Wallet = require("./Wallet");
const { Logger } = require("./Logger");
const fs = require('fs').promises;
const path = require('path');
const config = require('./config');
const ConfigWizard = require('./ConfigWizard');
const Dashboard = require('./dashboard/Dashboard');
const chalk = require('chalk');

class MoneyPrinter {
  constructor() {
    this.config = config;
    this.logger = new Logger(this.config);
  }

  async initialize() {
    try {
      // Check if this is first run or config requested
      const configPath = path.join(process.cwd(), 'config.json');
      const isFirstRun = !(await this.fileExists(configPath));
      
      if (isFirstRun || process.argv.includes('--config')) {
        const wizard = new ConfigWizard(this.config);
        await wizard.start();
        this.config = wizard.config;
      }

      // Initialize components
      await this.initializeComponents();
      this.logger.info('✨ Money Printer initialized successfully!');
      
      // Start the dashboard interface
      await this.startDashboard();
      
    } catch (error) {
      this.logger.error('Error initializing Money Printer:', { error: error.message });
      throw error;
    }
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async initializeComponents() {
    try {
      this.logger.info('Initializing components');

      // Initialize WebSocket connection
      this.wsManager = new WebSocketManager(this.config, this.logger);
      await this.wsManager.connect();

      // Initialize components in correct order
      this.wallet = new Wallet(this.config, this.logger);
      this.priceManager = new PriceManager(this.config, this.logger);
      await this.priceManager.initialize();
      
      this.safetyChecker = new SafetyChecker(this.wallet, this.priceManager, this.logger);
      this.positionManager = new PositionManager({
        wallet: this.wallet,
        priceManager: this.priceManager,
        logger: this.logger,
        config: this.config
      });
      
      // Initialize token tracker with dependencies
      this.tokenTracker = new TokenTracker(
        this.config,
        this.logger,
        this.wsManager,
        this.positionManager
      );

      // Initialize dashboard
      this.dashboard = new Dashboard(this.config, this.logger, this.safetyChecker, this.tokenTracker);
      this.logger.setDashboard(this.dashboard);

      // Setup event handlers
      this.setupEventHandlers();
      this.logger.info('All components initialized successfully');

      return true;
    } catch (error) {
      this.logger.error('Failed to initialize components', { 
        error: error.message,
        stack: error.stack 
      });
      throw error;
    }
  }

  setupEventHandlers() {
    // WebSocket connection status
    this.wsManager.on('connected', () => {
      this.dashboard.emit('statusUpdate', { connected: true });
    });

    this.wsManager.on('disconnected', () => {
      this.dashboard.emit('statusUpdate', { connected: false });
    });

    // Token updates
    this.tokenTracker.on('newToken', (token) => {
      this.dashboard.emit('statusUpdate', { currentToken: token.symbol });
      this.dashboard.emit('log', `New token detected: ${token.symbol}`);
    });

    // Price updates
    this.priceManager.on('priceUpdate', (data) => {
      this.dashboard.emit('priceUpdate', {
        prices: data.priceHistory,
        volumes: data.volumeHistory
      });
    });

    // Position updates
    this.positionManager.on('positionUpdate', (positions) => {
      this.dashboard.emit('positionUpdate', positions);
      this.updateTotalPnL();
    });

    // Wallet updates
    this.wallet.on('balanceUpdate', (data) => {
      this.dashboard.emit('walletUpdate', {
        balance: data.newBalance,
        previousBalance: data.oldBalance
      });
    });

    // Safety alerts
    this.safetyChecker.on('warning', (msg) => {
      this.dashboard.emit('alert', msg);
    });

    // Dashboard commands
    this.dashboard.on('command', async (cmd) => {
      switch (cmd.type) {
        case 'openPosition':
          await this.tokenTracker.openPosition();
          break;
        case 'closePosition':
          await this.tokenTracker.closePosition();
          break;
        case 'quit':
          await this.shutdown();
          break;
      }
    });
  }

  updateTotalPnL() {
    const totalPnL = this.positionManager.positions.reduce(
      (sum, pos) => sum + pos.realizedPnLWithFeesSol,
      0
    );
    this.dashboard.emit('statusUpdate', { totalPnL });
  }

  async startDashboard() {
    this.dashboard.initialize();
    this.logger.info('Dashboard started');
  }

  async shutdown() {
    this.logger.info('Shutting down Money Printer...');
    await this.wsManager.disconnect();
    process.exit(0);
  }

  async saveState() {
    // Implementation of state saving
  }
}

// Global error handlers
process.on("uncaughtException", (error) => {
  const logger = global.moneyPrinter?.logger;
  if (logger) {
    logger.error('Uncaught Exception:', { error });
  }
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  const logger = global.moneyPrinter?.logger;
  if (logger) {
    logger.error('Unhandled Rejection:', { error });
  }
  process.exit(1);
});

// Start the application
if (require.main === module) {
  const moneyPrinter = new MoneyPrinter();
  global.moneyPrinter = moneyPrinter;
  moneyPrinter.initialize().catch((error) => {
    if (moneyPrinter.logger) {
      moneyPrinter.logger.error('Failed to initialize:', { error });
    }
    process.exit(1);
  });
}

module.exports = MoneyPrinter;
