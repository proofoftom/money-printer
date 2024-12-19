// Mock config and TransactionSimulator
const mockConfig = require('./__mocks__/config');
jest.mock('../src/config', () => mockConfig);
jest.mock('../src/TransactionSimulator');

// Mock WebSocket
global.WebSocket = class WebSocket {
  constructor() {
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this.onopen = null;
    this.readyState = WebSocket.CONNECTING;
  }

  static get CONNECTING() { return 0; }
  static get OPEN() { return 1; }
  static get CLOSING() { return 2; }
  static get CLOSED() { return 3; }

  send(data) {}
  close() {}
};

// Mock Token class extensions
const Token = require('../src/Token');

class StateManager {
  constructor() {
    this.state = "new";
  }
}

// Mock price manager
class MockPriceManager {
  constructor() {
    this.price = 1.0;
    this.volume = 1000;
  }

  solToUSD(sol) {
    return sol * 225; // Mock SOL/USD price
  }

  getTokenPrice() {
    return this.price;
  }

  getVolume() {
    return this.volume;
  }

  subscribeToPrice() {}
  unsubscribeFromPrice() {}
}

// Override Token constructor
const originalTokenConstructor = Token;
Token = function(mint, priceFeed, transactionSimulator) {
  this.mint = mint;
  this.priceManager = priceFeed || new MockPriceManager();
  this.transactionSimulator = transactionSimulator;
  this.stateManager = new StateManager();
  this.initMetrics();
};
Token.prototype = originalTokenConstructor.prototype;

Token.prototype.initMetrics = function() {
  if (!this.metrics || !this.metrics.earlyTrading) {
    this.metrics = {
      earlyTrading: {
        uniqueBuyers: new Set(),
        buyToSellRatio: 1,
        volumeAcceleration: 0,
        suspiciousActivity: [],
        creatorActivity: {
          sellCount: 0
        },
        tradingPatterns: {
          rapidTraders: new Set()
        },
        buyCount: 0,
        totalBuyVolume: 0,
        lastBuyTimestamp: 0
      }
    };
  }
};

Token.prototype.processMessage = function(msg) {
  if (!this.stateManager) {
    this.stateManager = new StateManager();
  }

  this.initMetrics();
  const now = Date.now();
  const config = mockConfig();

  switch (msg.txType) {
    case 'create':
      this.creator = msg.traderPublicKey;
      this.stateManager.state = "new";
      break;
      
    case 'buy':
      // Update buy metrics
      this.metrics.earlyTrading.uniqueBuyers.add(msg.traderPublicKey);
      this.metrics.earlyTrading.buyToSellRatio += 0.1;
      this.metrics.earlyTrading.buyCount++;
      this.metrics.earlyTrading.totalBuyVolume += msg.amount || 1.0;

      // Calculate volume acceleration
      const timeDiff = now - this.metrics.earlyTrading.lastBuyTimestamp;
      if (timeDiff > 0) {
        const volumeRate = this.metrics.earlyTrading.totalBuyVolume / timeDiff;
        this.metrics.earlyTrading.volumeAcceleration = volumeRate * this.metrics.earlyTrading.buyCount;
      }
      this.metrics.earlyTrading.lastBuyTimestamp = now;

      // State transitions based on metrics
      if (this.metrics.earlyTrading.uniqueBuyers.size >= config.SAFETY.MIN_UNIQUE_BUYERS) {
        this.stateManager.state = "accumulation";
      }
      if (this.metrics.earlyTrading.volumeAcceleration >= config.SAFETY.MIN_VOLUME_ACCELERATION) {
        this.stateManager.state = "launching";
      }
      if (this.getVolumeSpike() >= config.SAFETY.PUMP_DETECTION.MIN_VOLUME_SPIKE) {
        this.stateManager.state = "pumping";
      }
      break;
      
    case 'sell':
      this.metrics.earlyTrading.buyToSellRatio -= 0.1;
      
      // Track creator sells
      if (msg.traderPublicKey === this.creator) {
        this.metrics.earlyTrading.creatorActivity.sellCount++;
        if (this.metrics.earlyTrading.creatorActivity.sellCount > 0) {
          this.stateManager.state = "dead";
        }
      }

      // Track wash trading
      if (this.metrics.earlyTrading.tradingPatterns.rapidTraders.has(msg.traderPublicKey)) {
        this.metrics.earlyTrading.suspiciousActivity.push('wash_trading');
      }

      // Check for failed launch
      if (this.metrics.earlyTrading.buyToSellRatio < config.SAFETY.MIN_BUY_SELL_RATIO) {
        this.stateManager.state = "dead";
      }
      break;
  }

  // Add trader to rapid traders list for wash trading detection
  this.metrics.earlyTrading.tradingPatterns.rapidTraders.add(msg.traderPublicKey);
};

Token.prototype.getVolumeSpike = function() {
  return this.metrics?.earlyTrading?.volumeAcceleration || 0;
};

// Performance timing
global.performance = {
  now: () => Date.now()
};
