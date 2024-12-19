// Mock config and TransactionSimulator
jest.mock('../src/config');
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
const config = require('../src/config');

class StateManager {
  constructor() {
    this.state = "new";
  }
}

Token.prototype.processMessage = function(msg) {
  if (!this.stateManager) {
    this.stateManager = new StateManager();
  }

  switch (msg.txType) {
    case 'create':
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
          }
        }
      };
      this.creator = msg.traderPublicKey;
      this.stateManager.state = "new";
      break;
      
    case 'buy':
      if (!this.metrics?.earlyTrading?.uniqueBuyers) {
        this.processMessage({ txType: 'create', traderPublicKey: 'creator' });
      }
      this.metrics.earlyTrading.uniqueBuyers.add(msg.traderPublicKey);
      this.metrics.earlyTrading.buyToSellRatio += 0.1;
      this.metrics.earlyTrading.volumeAcceleration += 0.5;

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
      if (!this.metrics?.earlyTrading?.uniqueBuyers) {
        this.processMessage({ txType: 'create', traderPublicKey: 'creator' });
      }
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
