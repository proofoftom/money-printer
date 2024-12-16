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
const path = require('path');
const fs = require('fs');

// Initialize error logger first
const errorLogger = new ErrorLogger();

// Create log directories if they don't exist
const logDir = path.join(__dirname, '..', 'logs');
const errorLogDir = path.join(logDir, 'errors');
const infoLogDir = path.join(logDir, 'info');

[errorLogDir, infoLogDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Safe logging function that doesn't use console
function safeLog(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    type,
    message
  };
  
  try {
    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(type === 'error' ? errorLogDir : infoLogDir, `${type}_${today}.json`);
    
    let logs = [];
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf8');
      logs = content ? JSON.parse(content) : [];
    }
    
    logs.push(logEntry);
    fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
    
    // Update dashboard if available, using direct method call
    if (global.dashboard?.logStatus) {
      global.dashboard.logStatus(message, type);
    }
  } catch (err) {
    // Last resort error handling - write to a separate error file
    const emergencyLog = path.join(errorLogDir, 'emergency.log');
    fs.appendFileSync(emergencyLog, `${timestamp} [EMERGENCY] ${message}\n`);
  }
}

// Global error handlers
process.on('uncaughtException', (error) => {
  safeLog(`Uncaught Exception: ${error.message}\n${error.stack}`, 'error');
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  safeLog(`Unhandled Rejection: ${error.message}\n${error.stack}`, 'error');
});

// Initialize components with error handling
function initializeComponent(component, context) {
  try {
    return component;
  } catch (error) {
    safeLog(`Error initializing ${context}: ${error.message}`, 'error');
    process.exit(1);
  }
}

// Initialize components in correct dependency order
const wallet = initializeComponent(new Wallet(), 'Wallet');
const priceManager = initializeComponent(new PriceManager(), 'PriceManager');
const transactionSimulator = initializeComponent(new TransactionSimulator(), 'TransactionSimulator');
const positionStateManager = initializeComponent(new PositionStateManager(), 'PositionStateManager');
const safetyChecker = initializeComponent(new SafetyChecker(), 'SafetyChecker');
const statsLogger = initializeComponent(new StatsLogger(), 'StatsLogger');

// Initialize PositionManager with its dependencies
const positionManager = initializeComponent(
  new PositionManager(
    wallet,
    positionStateManager,
    transactionSimulator,
    statsLogger,
    safetyChecker
  ),
  'PositionManager'
);

// Initialize WebSocketManager first since TokenTracker needs it
const webSocketManager = initializeComponent(
  new WebSocketManager(null, priceManager),  // We'll set tokenTracker after it's created
  'WebSocketManager'
);

// Initialize TokenTracker with all its dependencies
const tokenTracker = initializeComponent(
  new TokenTracker(
    safetyChecker,
    positionManager,
    priceManager,
    webSocketManager,
    statsLogger
  ),
  'TokenTracker'
);

// Set TokenTracker in WebSocketManager now that it's created
webSocketManager.tokenTracker = tokenTracker;

// Initialize dashboard last
global.dashboard = initializeComponent(
  new Dashboard(
    wallet,
    tokenTracker,
    positionManager,
    safetyChecker,
    priceManager
  ),
  'Dashboard'
);

// Set up event listeners for token lifecycle events
tokenTracker.on("tokenAdded", (token) => {
  safeLog(`Token ${token.symbol} (${token.mint}) minted!`, 'info');
});

tokenTracker.on("error", (error) => {
  safeLog(`TokenTracker Error: ${error.message}`, 'error');
});

// Start the application
async function start() {
  try {
    await priceManager.initialize();
    await webSocketManager.connect();
    safeLog('System initialized successfully', 'info');
  } catch (error) {
    safeLog(`Error during startup: ${error.message}`, 'error');
    process.exit(1);
  }
}

// Handle process events for graceful shutdown
process.on("SIGINT", async () => {
  safeLog("Shutting down gracefully...", 'info');
  try {
    await webSocketManager.disconnect();
    process.exit(0);
  } catch (error) {
    safeLog(`Error during shutdown: ${error.message}`, 'error');
    process.exit(1);
  }
});

start();
