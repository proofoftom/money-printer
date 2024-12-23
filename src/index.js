const TokenTracker = require("./TokenTracker");
const WebSocketManager = require("./WebSocketManager");
const SafetyChecker = require("./SafetyChecker");
const PositionManager = require("./PositionManager");
const ExitStrategies = require("./ExitStrategies");
const PriceManager = require("./PriceManager");
const Wallet = require("./Wallet");
const { Logger } = require("./Logger");
const Analytics = require("./Analytics");
const fs = require("fs").promises;
const path = require("path");
const config = require("./config");
const ConfigWizard = require("./ConfigWizard");
const Dashboard = require("./Dashboard");
const chalk = require("chalk");

class MoneyPrinter {
  constructor() {
    this.config = config;
  }

  async init() {
    try {
      this.logger = new Logger(this.config);
      this.analytics = new Analytics(this.config, this.logger);

      // Initialize components first
      await this.initializeComponents();

      // Initialize dashboard after components if not in test mode
      if (process.env.NODE_ENV !== "test") {
        this.dashboard = new Dashboard(this);
        this.logger.setDashboard(this.dashboard);

        // Setup event handlers after dashboard is initialized
        this.setupEventHandlers();

        // Start the dashboard
        this.dashboard.start();
      }

      this.logger.info("✨ Money Printer initialized successfully!");
    } catch (error) {
      this.logger.error("Error initializing Money Printer:", {
        error: error.message,
      });
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
      this.logger.info("Initializing components");

      // Initialize WebSocket manager
      this.wsManager = new WebSocketManager(this.config, this.logger);

      // Initialize wallet and price manager
      this.wallet = new Wallet(this.config, this.logger);
      this.exitStrategies = new ExitStrategies(this.config, this.logger);
      this.priceManager = new PriceManager(this.config, this.logger);

      // Initialize position manager with dependencies
      this.positionManager = new PositionManager({
        wallet: this.wallet,
        priceManager: this.priceManager,
        exitStrategies: this.exitStrategies,
        logger: this.logger,
        config: this.config,
        analytics: this.analytics,
      });

      // Initialize token tracker with dependencies
      this.tokenTracker = new TokenTracker(
        this.config,
        this.logger,
        this.wsManager,
        this.positionManager,
        this.priceManager
      );

      // Initialize safety checker with dependencies
      this.safetyChecker = new SafetyChecker(
        this.wallet,
        this.priceManager,
        this.logger
      );

      // Connect to WebSocket
      await this.wsManager.connect();

      // Initialize price manager
      await this.priceManager.initialize();

      this.logger.info("All components initialized successfully");
      return true;
    } catch (error) {
      this.logger.error("Failed to initialize components", {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  setupEventHandlers() {
    if (!this.dashboard) return;

    // WebSocket connection status
    this.wsManager.on("connected", () => {
      this.dashboard.emit("statusUpdate", { connected: true });
    });

    this.wsManager.on("disconnected", () => {
      this.dashboard.emit("statusUpdate", { connected: false });
    });

    // Token updates
    this.tokenTracker.on("newToken", (token) => {
      this.dashboard.emit("statusUpdate", { currentToken: token.symbol });
      this.dashboard.emit("log", `New token detected: ${token.symbol}`);
    });

    // Position updates
    this.positionManager.on("positionOpened", (position) => {
      this.dashboard.emit("statusUpdate", {
        position: position.symbol,
        entryPrice: position.entryPrice,
      });
      this.dashboard.emit(
        "log",
        `Position opened: ${position.symbol} @ ${position.entryPrice}`
      );
    });

    this.positionManager.on("positionClosed", (data) => {
      const { position, reason } = data;
      this.dashboard.emit("statusUpdate", { position: null });
      this.dashboard.emit(
        "log",
        `Position closed: ${position.symbol} (${reason})`
      );
      this.updateTotalPnL();
    });

    // Analytics updates
    this.analytics.on("tradeAnalytics", (metrics) => {
      this.dashboard.emit("metricsUpdate", metrics);
    });

    // Wallet updates
    this.wallet.on("balanceUpdate", (data) => {
      this.dashboard.emit("walletUpdate", {
        balance: data.newBalance,
        previousBalance: data.oldBalance,
      });
    });

    // Safety alerts
    this.safetyChecker.on("warning", (msg) => {
      this.dashboard.emit("alert", msg);
    });

    // Dashboard commands
    this.dashboard.on("command", async (cmd) => {
      switch (cmd.type) {
        case "openPosition":
          await this.tokenTracker.openPosition();
          break;
        case "closePosition":
          await this.tokenTracker.closePosition();
          break;
        case "quit":
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
    this.dashboard.emit("statusUpdate", { totalPnL });
  }

  async shutdown() {
    this.logger.info("Shutting down Money Printer...");

    // Clean up token tracking
    if (this.tokenTracker) {
      await this.tokenTracker.cleanup();
    }

    // Clean up WebSocket connections
    if (this.wsManager) {
      await this.wsManager.disconnect();
    }

    // Save final state if needed
    await this.saveState();

    this.logger.info("Shutdown complete");
    process.exit(0);
  }

  async saveState() {
    // Implementation of state saving
  }
}

// Global error handlers
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  if (global.moneyPrinter?.logger) {
    global.moneyPrinter.logger.error("Uncaught Exception:", {
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    });
  }
  // Give logger time to flush
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

process.on("unhandledRejection", (error) => {
  const logger = global.moneyPrinter?.logger;
  if (logger) {
    logger.error("Unhandled Rejection:", {
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    });
  }
  process.exit(1);
});

// Add graceful shutdown handlers
process.on("SIGINT", async () => {
  console.log("\nReceived SIGINT. Cleaning up...");
  if (global.moneyPrinter) {
    await global.moneyPrinter.tokenTracker.cleanup();
  }
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\nReceived SIGTERM. Cleaning up...");
  if (global.moneyPrinter) {
    await global.moneyPrinter.tokenTracker.cleanup();
  }
  process.exit(0);
});

// Start the application
if (require.main === module) {
  const moneyPrinter = new MoneyPrinter();
  global.moneyPrinter = moneyPrinter;
  moneyPrinter.init().catch((error) => {
    if (moneyPrinter.logger) {
      moneyPrinter.logger.error("Failed to initialize:", { error });
    }
    process.exit(1);
  });
}

module.exports = MoneyPrinter;
