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

// Initialize components
const errorLogger = new ErrorLogger();
const wallet = new Wallet();
const priceManager = new PriceManager();
const positionManager = new PositionManager(wallet);
const safetyChecker = new SafetyChecker(config.SAFETY);
const tokenTracker = new TokenTracker(
  safetyChecker,
  positionManager,
  priceManager,
  errorLogger
);
const wsManager = new WebSocketManager(tokenTracker, priceManager, errorLogger);

// Create dashboard first to capture all logs
const dashboard = new Dashboard(
  wallet,
  tokenTracker,
  positionManager,
  safetyChecker,
  priceManager
);

// Initialize price manager before starting
async function start() {
  try {
    await priceManager.initialize();
    dashboard.logStatus(
      "Money Printer initialized and ready to trade!",
      "info"
    );
  } catch (error) {
    errorLogger.logError(error, "Initialization", {
      component: "PriceManager",
    });
    dashboard.logStatus(
      `Failed to initialize Money Printer: ${error.message}`,
      "error"
    );
    process.exit(1);
  }
}

// Set up event listeners for token lifecycle events
tokenTracker.on("tokenAdded", (token) => {
  // Token added events are too noisy for the dashboard
});

tokenTracker.on("tokenHeatingUp", (token) => {
  dashboard.logStatus(
    `Token ${token.symbol} (${token.mint}) is heating up!`,
    "info"
  );
  dashboard.logStatus(`Market cap: ${token.marketCapSol} SOL`, "info");
});

tokenTracker.on("tokenStateChanged", ({ token, from, to }) => {
  dashboard.logStatus(
    `Token ${token.symbol} state changed: ${from} -> ${to}`,
    "info"
  );
  dashboard.logStatus(
    `Market cap: ${priceManager
      .solToUSD(token.marketCapSol)
      .toFixed(2)} USD / ${token.marketCapSol} SOL`,
    "info"
  );
  if (to === "drawdown") {
    dashboard.logStatus(
      `Drawdown from peak: ${token.getDrawdownPercentage().toFixed(2)}%`,
      "info"
    );
  } else if (to === "inPosition") {
    const position = positionManager.getPosition(token.mint);
    dashboard.logStatus(
      `Position opened at: ${position.entryPrice} SOL`,
      "info"
    );
  }
});

tokenTracker.on("positionOpened", (token) => {
  const position = positionManager.getPosition(token.mint);
  dashboard.logStatus(`Opened position for ${token.symbol}`, "info");
  dashboard.logStatus(`Entry price: ${position.entryPrice} SOL`, "info");
  dashboard.logStatus(`Market cap: ${token.marketCapSol} SOL`, "info");
  dashboard.logTrade({
    type: "BUY",
    mint: token.mint,
    symbol: token.symbol,
    profitLoss: 0,
  });
});

tokenTracker.on("takeProfitExecuted", ({ token, percentage, portion }) => {
  dashboard.logStatus(`Take profit hit for ${token.symbol}`, "info");
  dashboard.logStatus(
    `Sold ${(portion * 100).toFixed(0)}% at ${percentage}% profit`,
    "info"
  );
  dashboard.logStatus(`Current market cap: ${token.marketCapSol} SOL`, "info");
  dashboard.logTrade({
    type: "SELL",
    mint: token.mint,
    symbol: token.symbol,
    profitLoss: percentage,
  });
});

tokenTracker.on("positionClosed", ({ token, reason }) => {
  dashboard.logStatus(`Position closed for ${token.symbol}`, "info");
  dashboard.logStatus(`Reason: ${reason}`, "info");
  dashboard.logStatus(`Final market cap: ${token.marketCapSol} SOL`, "info");
  dashboard.logTrade({
    type: "CLOSE",
    mint: token.mint,
    symbol: token.symbol,
    profitLoss: token.profitLoss,
  });
});

tokenTracker.on("error", ({ token, error }) => {
  dashboard.logStatus(
    `Error with token ${token.symbol}: ${error.message}`,
    "error"
  );
});

// Handle process events for graceful shutdown
process.on("SIGINT", async () => {
  dashboard.logStatus("\nShutting down gracefully...", "info");
  await wsManager.close();
  process.exit(0);
});

process.on("uncaughtException", (error) => {
  dashboard.logStatus(`Uncaught exception: ${error.message}`, "error");
  process.exit(1);
});

start();
