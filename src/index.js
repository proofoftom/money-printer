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
const CLIManager = require('./CLIManager');
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
      
      this.logger.info('Money Printer initialized successfully');
      console.log(chalk.green.bold('\n✨ Money Printer initialized successfully!\n'));
      
      // Start the CLI interface
      await this.startCLI();
      
    } catch (error) {
      this.logger.error('Failed to initialize Money Printer', { error: error.message, stack: error.stack });
      console.error(chalk.red.bold('Error initializing Money Printer:', error.message));
      process.exit(1);
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

      // Initialize core components in correct order
      this.wallet = new Wallet(this.config);
      this.logger.debug('Wallet initialized');

      this.priceManager = new PriceManager(this.config);
      await this.priceManager.initialize();
      this.logger.debug('Price manager initialized');

      this.webSocketManager = new WebSocketManager(this.config, this.logger);
      await this.webSocketManager.connect();
      this.logger.debug('WebSocket manager connected');

      // SafetyChecker needs wallet and priceManager
      this.safetyChecker = new SafetyChecker(this.wallet, this.priceManager);
      this.logger.debug('Safety checker initialized');

      // PositionManager needs wallet, priceManager and config
      this.positionManager = new PositionManager(this.wallet, this.priceManager, this.config);
      this.logger.debug('Position manager initialized');

      // Initialize token tracker last since it depends on other components
      this.tokenTracker = new TokenTracker({
        safetyChecker: this.safetyChecker,
        positionManager: this.positionManager,
        priceManager: this.priceManager,
        webSocketManager: this.webSocketManager
      });
      this.logger.debug('Token tracker initialized');

      // Initialize CLI manager
      this.cli = new CLIManager(this.config, this.tokenTracker, this.wallet);
      this.logger.debug('CLI manager initialized');

      // Set up event listeners
      this.setupEventListeners();
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

  setupEventListeners() {
    // Token events
    this.tokenTracker.on("tokenAdded", (token) => {
      this.logger.info('New token detected', { symbol: token.symbol, mint: token.mint });
      this.cli.updateToken(token);
      this.cli.notify(`New token detected: ${token.symbol}`, { sound: false });
    });

    this.tokenTracker.on("tokenUpdated", (token) => {
      this.logger.debug('Token updated', { symbol: token.symbol, mint: token.mint });
      this.cli.updateToken(token);
    });

    this.tokenTracker.on("tokenRemoved", (token) => {
      this.logger.info('Token removed', { symbol: token.symbol, mint: token.mint });
      this.cli.removeToken(token);
    });

    // Position events
    this.tokenTracker.on("positionOpened", ({ token, position }) => {
      this.logger.info('Position opened', {
        symbol: token.symbol,
        size: position.size,
        entryPrice: position.entryPrice
      });
    });

    this.tokenTracker.on("positionClosed", ({ token, position, pnl }) => {
      this.logger.info('Position closed', {
        symbol: token.symbol,
        pnl,
        exitPrice: position.exitPrice
      });
    });

    // Error events
    this.tokenTracker.on("error", (error) => {
      this.logger.error('Token tracker error', { error: error.message });
    });

    // WebSocket events
    this.webSocketManager.on("error", (error) => {
      this.logger.error('WebSocket error', { error: error.message });
    });

    this.webSocketManager.on("disconnected", () => {
      this.logger.warn('WebSocket disconnected');
    });

    this.webSocketManager.on("reconnecting", (attempt) => {
      this.logger.info('WebSocket reconnecting', { attempt });
    });
  }

  async startCLI() {
    // Clear the screen
    console.clear();
    
    // Start rendering
    this.cli.render();
    this.logger.debug('CLI rendering started');
  }

  async shutdown() {
    this.logger.info('Shutting down Money Printer');
    try {
      await this.saveState();
      this.webSocketManager.close();
      this.cli.cleanup();
      this.logger.info('Shutdown completed successfully');
    } catch (error) {
      this.logger.error('Error during shutdown', { error: error.message });
    }
  }

  async saveState() {
    // Implementation of state saving
  }
}

// Global error handlers
process.on("uncaughtException", (error) => {
  const logger = global.moneyPrinter?.logger;
  if (logger) {
    logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  }
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  const logger = global.moneyPrinter?.logger;
  if (logger) {
    logger.error('Unhandled Rejection', { error: error.message, stack: error.stack });
  }
  console.error("Unhandled Rejection:", error);
  process.exit(1);
});

// Start the application
if (require.main === module) {
  const printer = new MoneyPrinter();
  global.moneyPrinter = printer;
  printer.initialize().catch(error => {
    if (printer.logger) {
      printer.logger.error('Initialization failed', { error: error.message, stack: error.stack });
    }
    console.error('Failed to initialize:', error);
    process.exit(1);
  });
}

module.exports = MoneyPrinter;
