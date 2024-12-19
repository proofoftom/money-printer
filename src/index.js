const TokenTracker = require("./TokenTracker");
const WebSocketManager = require("./WebSocketManager");
const SafetyChecker = require("./SafetyChecker");
const PositionManager = require("./PositionManager");
const PriceManager = require("./PriceManager");
const Wallet = require("./Wallet");
const fs = require('fs').promises;
const path = require('path');
const config = require('./config');
const ConfigWizard = require('./ConfigWizard');
const CLIManager = require('./CLIManager');
const chalk = require('chalk');

// Global error handlers
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled Rejection:", error);
  process.exit(1);
});

class MoneyPrinter {
  constructor() {
    this.config = config;
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

      // Initialize CLI
      this.cli = new CLIManager(this.config);
      
      // Initialize components with updated config
      await this.initializeComponents();
      
      console.log(chalk.green.bold('\n✨ Money Printer initialized successfully!\n'));
      
      // Start the CLI interface
      await this.startCLI();
      
    } catch (error) {
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
    // Initialize core components
    this.wallet = new Wallet(this.config);
    this.webSocketManager = new WebSocketManager(this.config);
    this.safetyChecker = new SafetyChecker(this.config);
    this.priceManager = new PriceManager(this.config, this.webSocketManager);
    
    // Initialize price manager first
    await this.priceManager.initialize();
    
    this.positionManager = new PositionManager(this.config, this.wallet, this.priceManager);
    this.tokenTracker = new TokenTracker({
      safetyChecker: this.safetyChecker,
      positionManager: this.positionManager,
      priceManager: this.priceManager,
      webSocketManager: this.webSocketManager
    });
    this.cli = new CLIManager(this.config, this.tokenTracker);

    // Set up event listeners
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Token events
    this.tokenTracker.on("tokenAdded", (token) => {
      this.cli.updateToken(token);
      this.cli.notify(`New token detected: ${token.symbol}`, { sound: false });
    });

    this.tokenTracker.on("tokenUpdated", (token) => {
      this.cli.updateToken(token);
    });

    this.tokenTracker.on("tokenRemoved", (token) => {
      this.cli.removeToken(token);
      this.cli.notify(`Token removed: ${token.symbol}`, { sound: false });
    });

    // Position events
    this.positionManager.on("positionOpened", (position) => {
      this.cli.updatePosition(position.token, position);
      this.cli.notify(`Opened position in ${position.symbol}`, { sound: true });
    });

    this.positionManager.on("positionClosed", (position) => {
      this.cli.addTrade({
        timestamp: new Date().toLocaleTimeString(),
        symbol: position.symbol,
        type: 'sell',
        price: position.exitPrice,
        size: position.size,
        pnl: position.pnl
      });
      
      const pnlText = position.pnl >= 0 ? chalk.green(`+${position.pnl.toFixed(3)}`) : chalk.red(position.pnl.toFixed(3));
      this.cli.notify(`Closed position in ${position.symbol}: ${pnlText} SOL`, {
        sound: position.pnl >= this.config.NOTIFICATIONS.POSITIONS.EXIT.minProfitPercent
      });
    });

    // Wallet events
    this.wallet.on("balanceChanged", (balance) => {
      this.cli.updateBalanceHistory(balance);
    });

    // CLI events
    this.cli.on("tradingStateChange", (isRunning) => {
      if (!isRunning) {
        this.positionManager.pauseTrading();
      } else {
        this.positionManager.resumeTrading();
      }
    });

    this.cli.on("emergencyStop", () => {
      this.positionManager.emergencyCloseAll();
    });

    this.cli.on("riskAdjusted", (newRisk) => {
      this.positionManager.setRiskPerTrade(newRisk);
    });

    this.cli.on("shutdown", () => {
      this.shutdown();
    });
  }

  async startCLI() {
    // Initial render
    this.cli.render();
    
    // Start trading
    await this.webSocketManager.connect();
  }

  async shutdown() {
    try {
      // Close all positions
      await this.positionManager.emergencyCloseAll();
      
      // Close WebSocket connection
      this.webSocketManager.close();
      
      // Save final state
      await this.saveState();
      
      console.log(chalk.green.bold('\n👋 Money Printer shut down successfully\n'));
    } catch (error) {
      console.error(chalk.red.bold('Error during shutdown:', error.message));
    }
  }

  async saveState() {
    // Save trading history and performance metrics
    // This will be implemented when we add the data export feature
  }
}

// Start the application
if (require.main === module) {
  const printer = new MoneyPrinter();
  printer.initialize().catch(error => {
    console.error(chalk.red.bold('Fatal error:', error.message));
    process.exit(1);
  });
}

module.exports = MoneyPrinter;
