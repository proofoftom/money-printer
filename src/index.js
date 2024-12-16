// Entry point for the Money Printer trading bot

const config = require("./config");
const TokenTracker = require("./TokenTracker");
const WebSocketManager = require("./WebSocketManager");
const SafetyChecker = require("./SafetyChecker");
const PositionManager = require("./PositionManager");
const PositionStateManager = require("./PositionStateManager");
const PriceManager = require("./PriceManager");
const Wallet = require("./Wallet");
const ErrorLogger = require("./ErrorLogger");
const Dashboard = require("./Dashboard");
const TransactionSimulator = require("./TransactionSimulator");
const StatsLogger = require("./StatsLogger");

// Initialize error logger first
const errorLogger = new ErrorLogger();

// Global error handlers
process.on('uncaughtException', (error) => {
  handleGlobalError(error, 'UncaughtException');
});

process.on('unhandledRejection', (error) => {
  handleGlobalError(error, 'UnhandledRejection');
});

// Global console override
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info
};

function overrideConsole() {
  console.log = (...args) => {
    if (global.dashboard) {
      global.dashboard.logStatus(args.join(" "), "info");
    }
    // Keep original logging for debugging if needed
    // originalConsole.log(...args);
  };

  console.error = (...args) => {
    if (global.dashboard) {
      global.dashboard.logStatus(args.join(" "), "error");
    }
    // Keep original error logging for debugging
    originalConsole.error(...args);
  };

  console.warn = (...args) => {
    if (global.dashboard) {
      global.dashboard.logStatus(args.join(" "), "warning");
    }
    // originalConsole.warn(...args);
  };

  console.info = (...args) => {
    if (global.dashboard) {
      global.dashboard.logStatus(args.join(" "), "info");
    }
    // originalConsole.info(...args);
  };
}

// Centralized error handling
function handleGlobalError(error, context, additionalInfo = {}) {
  try {
    // Add position details if available
    if (additionalInfo.position) {
      additionalInfo = {
        ...additionalInfo,
        position: {
          mint: additionalInfo.position.mint,
          currentPrice: additionalInfo.position.currentPrice,
          entryPrice: additionalInfo.position.entryPrice,
          volume: additionalInfo.position.volume,
          priceHistory: additionalInfo.position.priceHistory?.length,
          volumeHistory: additionalInfo.position.volumeHistory?.length,
          profitHistory: additionalInfo.position.profitHistory?.length
        }
      };
    }

    // Log to file
    errorLogger.logError(error, context, additionalInfo);
    
    // Log to dashboard if available
    if (global.dashboard) {
      const errorMessage = additionalInfo.position
        ? `${context} for position ${additionalInfo.position.mint?.slice(0, 8) || 'unknown'}: ${error.message}`
        : `${context}: ${error.message}`;
      global.dashboard.logStatus(errorMessage, "error");
    }
    
    // Log to console for debugging
    console.error(`[${context}] ${error.message}`);
    if (additionalInfo.position) {
      console.error('Position details:', additionalInfo.position);
    }
    
    // Handle fatal errors
    if (context === 'UncaughtException') {
      console.error('Fatal error occurred. Shutting down...');
      process.exit(1);
    }
  } catch (loggingError) {
    // Fallback error handling if logging fails
    console.error('Error in error handler:', loggingError);
    console.error('Original error:', error);
    process.exit(1);
  }
}

// Wrap component initialization in error handling
function initializeComponent(component, context) {
  return new Proxy(component, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value === 'function') {
        return function (...args) {
          try {
            const result = value.apply(target, args);
            if (result instanceof Promise) {
              return result.catch(error => {
                handleGlobalError(error, context, { method: prop });
                throw error; // Re-throw to maintain promise rejection
              });
            }
            return result;
          } catch (error) {
            handleGlobalError(error, context, { method: prop });
            throw error;
          }
        };
      }
      return value;
    }
  });
}

// Initialize components with error handling
const wallet = initializeComponent(new Wallet(), 'Wallet');
const priceManager = initializeComponent(new PriceManager(), 'PriceManager');
const transactionSimulator = initializeComponent(new TransactionSimulator(), 'TransactionSimulator');
const statsLogger = initializeComponent(new StatsLogger(), 'StatsLogger');
const positionStateManager = initializeComponent(new PositionStateManager(), 'PositionStateManager');
const positionManager = initializeComponent(
  new PositionManager(wallet, positionStateManager, transactionSimulator, statsLogger),
  'PositionManager'
);
const safetyChecker = initializeComponent(new SafetyChecker(config.SAFETY, priceManager), 'SafetyChecker');

// Initialize TokenTracker and WebSocketManager
const tokenTracker = initializeComponent(
  new TokenTracker(
    safetyChecker,
    positionManager,
    priceManager
  ),
  'TokenTracker'
);

const wsManager = initializeComponent(
  new WebSocketManager(tokenTracker, priceManager),
  'WebSocketManager'
);

// Set WebSocketManager in TokenTracker after initialization
tokenTracker.webSocketManager = wsManager;

// Create dashboard and store globally for error handler access
global.dashboard = initializeComponent(
  new Dashboard(wallet, tokenTracker, positionManager, safetyChecker, priceManager, statsLogger),
  'Dashboard'
);

overrideConsole();

// Initialize price manager before starting
async function start() {
  try {
    await priceManager.initialize();
    global.dashboard.logStatus("Money Printer initialized and ready to trade!", "info");
  } catch (error) {
    handleGlobalError(error, "Initialization", { component: "PriceManager" });
    process.exit(1);
  }
}

// Set up event listeners for token lifecycle events
tokenTracker.on("tokenAdded", (token) => {
  global.dashboard.logStatus(`Token ${token.symbol} (${token.mint}) minted!`, "info");
  global.dashboard.logStatus(
    `Market cap: ${priceManager.solToUSD(token.marketCapSol)}`,
    "info"
  );
});

tokenTracker.on("tokenStateChanged", ({ token, from, to }) => {
  global.dashboard.logStatus(
    `Token ${token.symbol} state changed: ${from} -> ${to}`,
    "info"
  );
  global.dashboard.logStatus(
    `Market cap: ${priceManager
      .solToUSD(token.marketCapSol)
      .toFixed(2)} USD / ${token.marketCapSol} SOL`,
    "info"
  );
  if (to === "drawdown") {
    global.dashboard.logStatus(
      `Drawdown from peak: ${token.getDrawdownPercentage().toFixed(2)}%`,
      "info"
    );
  } else if (to === "inPosition") {
    const position = positionManager.getPosition(token.mint);
    global.dashboard.logStatus(
      `Position opened at: ${position.entryPrice} SOL`,
      "info"
    );
  }
});

// Position-specific event handlers
positionManager.on("positionCreated", (position) => {
  global.dashboard.logStatus(
    `New position created for ${position.token.symbol} (${position.id})`,
    "info"
  );
  statsLogger.logStats({
    type: 'POSITION_OPEN',
    position: position,
    token: position.token
  });
});

positionManager.on("positionUpdated", (position) => {
  statsLogger.logStats({
    type: 'POSITION_UPDATE',
    position: position,
    token: position.token
  });
});

positionManager.on("positionClosed", (position) => {
  global.dashboard.logStatus(
    `Position closed for ${position.token.symbol} (${position.id})`,
    "info"
  );
  global.dashboard.logStatus(
    `Final P&L: ${position.calculatePnL().toFixed(4)} SOL`,
    "info"
  );
  statsLogger.logStats({
    type: 'POSITION_CLOSE',
    position: position,
    token: position.token
  });
});

// Exit strategy event handlers
positionManager.on("takeProfitTriggered", ({ position, tier, portion }) => {
  global.dashboard.logStatus(
    `Take profit tier ${tier} triggered for ${position.token.symbol}`,
    "info"
  );
  global.dashboard.logStatus(
    `Selling ${(portion * 100).toFixed(0)}% of position`,
    "info"
  );
  global.dashboard.logTrade({
    type: "PARTIAL_CLOSE",
    mint: position.token.mint,
    symbol: position.token.symbol,
    profitLoss: position.calculatePnL(),
    portion: portion
  });
});

positionManager.on("stopLossTriggered", ({ position }) => {
  global.dashboard.logStatus(
    `Stop loss triggered for ${position.token.symbol}`,
    "warning"
  );
  global.dashboard.logTrade({
    type: "CLOSE",
    mint: position.token.mint,
    symbol: position.token.symbol,
    profitLoss: position.calculatePnL(),
    reason: "STOP_LOSS"
  });
});

positionManager.on("trailingStopTriggered", ({ position }) => {
  global.dashboard.logStatus(
    `Trailing stop triggered for ${position.token.symbol}`,
    "info"
  );
  global.dashboard.logTrade({
    type: "CLOSE",
    mint: position.token.mint,
    symbol: position.token.symbol,
    profitLoss: position.calculatePnL(),
    reason: "TRAILING_STOP"
  });
});

// Transaction event handlers
positionManager.on("transactionDelay", ({ position, details }) => {
  global.dashboard.logStatus(
    `Transaction delay for ${position.token.symbol}: ${details.totalDelay}ms`,
    "info"
  );
});

positionManager.on("priceImpact", ({ position, details }) => {
  global.dashboard.logStatus(
    `Price impact for ${position.token.symbol}: ${(details.totalSlippage * 100).toFixed(2)}%`,
    "info"
  );
});

// Error handlers
positionManager.on("error", ({ position, error }) => {
  handleGlobalError(error, "PositionManager", { position });
});

tokenTracker.on("error", ({ token, error }) => {
  handleGlobalError(error, "TokenTracker", { token });
});

// Handle process events for graceful shutdown
process.on("SIGINT", async () => {
  global.dashboard.logStatus("\nShutting down gracefully...", "info");
  await Promise.all([
    wsManager.close(),
    positionStateManager.saveAllPositions()
  ]);
  process.exit(0);
});

start();
