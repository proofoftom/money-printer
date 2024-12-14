// Entry point for the Money Printer trading bot

const config = require("./config");
const TokenTracker = require("./TokenTracker");
const WebSocketManager = require("./WebSocketManager");
const SafetyChecker = require("./SafetyChecker");
const PositionManager = require("./PositionManager");
const PriceManager = require("./PriceManager");
const Wallet = require("./Wallet");

// Initialize components
const wallet = new Wallet();
const priceManager = new PriceManager();
const positionManager = new PositionManager(wallet);
const safetyChecker = new SafetyChecker(config.SAFETY);
const tokenTracker = new TokenTracker(
  safetyChecker,
  positionManager,
  priceManager
);
const wsManager = new WebSocketManager(tokenTracker, priceManager);

// Initialize price manager before starting
async function start() {
  try {
    await priceManager.initialize();
    console.log("Money Printer initialized and ready to trade!");
  } catch (error) {
    console.error("Failed to initialize Money Printer:", error);
    process.exit(1);
  }
}

// Set up event listeners for token lifecycle events
tokenTracker.on("tokenAdded", (token) => {
  // console.log(`New token discovered: ${token.symbol} (${token.mint})`);
  // console.log(`Creator: ${token.creator}`);
  // console.log(`Initial market cap: ${token.marketCapSol} SOL`);
});

tokenTracker.on("tokenHeatingUp", (token) => {
  console.log(`Token ${token.symbol} (${token.mint}) is heating up!`);
  console.log(`Market cap: ${token.marketCapSol} SOL`);
});

tokenTracker.on("tokenStateChanged", ({ token, from, to }) => {
  console.log(`Token ${token.symbol} state changed: ${from} -> ${to}`);
  console.log(`Market cap: ${token.marketCapSol} SOL`);
  if (to === "drawdown") {
    console.log(
      `Drawdown from peak: ${token.getDrawdownPercentage().toFixed(2)}%`
    );
  } else if (to === "inPosition") {
    const position = positionManager.getPosition(token.mint);
    console.log(`Position opened at: ${position.entryPrice} SOL`);
  }
});

tokenTracker.on("positionOpened", (token) => {
  const position = positionManager.getPosition(token.mint);
  console.log(` Opened position for ${token.symbol}`);
  console.log(`Entry price: ${position.entryPrice} SOL`);
  console.log(`Market cap: ${token.marketCapSol} SOL`);
});

tokenTracker.on("takeProfitExecuted", ({ token, percentage, portion }) => {
  console.log(` Take profit hit for ${token.symbol}`);
  console.log(`Sold ${(portion * 100).toFixed(0)}% at ${percentage}% profit`);
  console.log(`Current market cap: ${token.marketCapSol} SOL`);
});

tokenTracker.on("positionClosed", ({ token, reason }) => {
  console.log(`Position closed for ${token.symbol}`);
  console.log(`Reason: ${reason}`);
  console.log(`Final market cap: ${token.marketCapSol} SOL`);
});

tokenTracker.on("error", ({ token, error }) => {
  console.error(` Error with token ${token.symbol}:`, error);
});

// Handle process events for graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down gracefully...");
  await wsManager.close();
  process.exit(0);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});

start();
