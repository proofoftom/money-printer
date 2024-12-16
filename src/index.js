// Entry point for the Money Printer trading bot

const config = require("./config");
const TokenTracker = require("./TokenTracker");
const WebSocketManager = require("./WebSocketManager");
const SafetyChecker = require("./SafetyChecker");
const PositionManager = require("./PositionManager");
const PriceManager = require("./PriceManager");
const Wallet = require("./Wallet");
const ErrorLogger = require("./ErrorLogger");
const Dashboard = require("./Dashboard");

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
    // Log to file
    errorLogger.logError(error, context, additionalInfo);
    
    // Log to dashboard if available
    if (global.dashboard) {
      global.dashboard.logStatus(`${context}: ${error.message}`, "error");
    }
    
    // Log to console for debugging
    console.error(`[${context}] ${error.message}`);
    
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
const positionManager = initializeComponent(new PositionManager(wallet), 'PositionManager');
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
  new Dashboard(wallet, tokenTracker, positionManager, safetyChecker, priceManager),
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

tokenTracker.on("positionOpened", (token) => {
  const position = positionManager.getPosition(token.mint);
  global.dashboard.logStatus(`Opened position for ${token.symbol}`, "info");
  global.dashboard.logStatus(`Entry price: ${position.entryPrice} SOL`, "info");
  global.dashboard.logStatus(`Market cap: ${token.marketCapSol} SOL`, "info");
  global.dashboard.logTrade({
    type: "BUY",
    mint: token.mint,
    symbol: token.symbol,
    profitLoss: 0,
  });
});

tokenTracker.on("takeProfitExecuted", ({ token, percentage, portion }) => {
  global.dashboard.logStatus(`Take profit hit for ${token.symbol}`, "info");
  global.dashboard.logStatus(
    `Sold ${(portion * 100).toFixed(0)}% at ${percentage}% profit`,
    "info"
  );
  global.dashboard.logStatus(`Current market cap: ${token.marketCapSol} SOL`, "info");
  global.dashboard.logTrade({
    type: "SELL",
    mint: token.mint,
    symbol: token.symbol,
    profitLoss: percentage,
  });
});

tokenTracker.on("positionClosed", ({ token, reason }) => {
  global.dashboard.logStatus(`Position closed for ${token.symbol}`, "info");
  global.dashboard.logStatus(`Reason: ${reason}`, "info");
  global.dashboard.logStatus(`Final market cap: ${token.marketCapSol} SOL`, "info");
  global.dashboard.logTrade({
    type: "CLOSE",
    mint: token.mint,
    symbol: token.symbol,
    profitLoss: token.profitLoss,
  });
});

tokenTracker.on("error", ({ token, error }) => {
  global.dashboard.logStatus(
    `Error with token ${token.symbol}: ${error.message}`,
    "error"
  );
});

// Handle process events for graceful shutdown
process.on("SIGINT", async () => {
  global.dashboard.logStatus("\nShutting down gracefully...", "info");
  await wsManager.close();
  process.exit(0);
});

start();
