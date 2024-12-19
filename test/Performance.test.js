const Token = require('../src/Token');
const PositionManager = require('../src/PositionManager');
const { scenarios } = require('./__fixtures__/websocket');
const TransactionSimulator = require('../src/TransactionSimulator');

// Performance thresholds
const THRESHOLDS = {
  MESSAGE_PROCESSING: 5, // ms
  STATE_TRANSITION: 2,  // ms
  POSITION_ENTRY: 50,   // ms (including simulated transaction delay)
  PATTERN_DETECTION: 10 // ms
};

describe('Performance Tests', () => {
  let token;
  let positionManager;
  let transactionSimulator;

  beforeEach(() => {
    token = new Token('TEST123', {
      solToUSD: () => 100,
      getTokenPrice: () => 1,
      subscribeToPrice: jest.fn(),
      unsubscribeFromPrice: jest.fn()
    });

    transactionSimulator = new TransactionSimulator();
    positionManager = new PositionManager({
      balance: 10,
      updateBalance: jest.fn(),
      recordTrade: jest.fn()
    });
    positionManager.transactionSimulator = transactionSimulator;
  });

  describe('Message Processing Speed', () => {
    it('should process messages within threshold', () => {
      const messages = scenarios.successfulPump(token.mint);
      
      messages.forEach(msg => {
        const start = performance.now();
        token.processMessage(msg);
        const duration = performance.now() - start;
        
        expect(duration).toBeLessThan(THRESHOLDS.MESSAGE_PROCESSING);
      });
    });

    it('should handle rapid message bursts', () => {
      const messages = scenarios.successfulPump(token.mint);
      const burstSize = 10;
      const burstInterval = 50; // ms
      
      // Process messages in bursts
      const processBurst = async () => {
        const start = performance.now();
        
        for (let i = 0; i < burstSize && i < messages.length; i++) {
          token.processMessage(messages[i]);
        }
        
        const duration = performance.now() - start;
        expect(duration).toBeLessThan(THRESHOLDS.MESSAGE_PROCESSING * burstSize);
      };

      return processBurst();
    });
  });

  describe('Pattern Detection Speed', () => {
    it('should detect wash trading patterns quickly', () => {
      const messages = scenarios.washTrading(token.mint);
      
      const start = performance.now();
      messages.forEach(msg => token.processMessage(msg));
      const duration = performance.now() - start;
      
      expect(duration).toBeLessThan(THRESHOLDS.PATTERN_DETECTION);
      expect(token.metrics.earlyTrading.suspiciousActivity).toContain('wash_trading');
    });

    it('should detect creator dumps quickly', () => {
      const creatorKey = 'creator_key';
      const messages = scenarios.creatorDump(token.mint, creatorKey);
      
      const start = performance.now();
      messages.forEach(msg => token.processMessage(msg));
      const duration = performance.now() - start;
      
      expect(duration).toBeLessThan(THRESHOLDS.PATTERN_DETECTION);
      expect(token.metrics.earlyTrading.creatorActivity.sellCount).toBeGreaterThan(0);
    });
  });

  describe('Position Entry Timing', () => {
    it('should enter positions quickly after detection', async () => {
      const messages = scenarios.successfulPump(token.mint);
      
      // Process until accumulation phase
      for (const msg of messages) {
        token.processMessage(msg);
        if (token.stateManager.state === 'ACCUMULATION') {
          const start = performance.now();
          await positionManager.openPosition(token.mint, token, 100);
          const duration = performance.now() - start;
          
          expect(duration).toBeLessThan(THRESHOLDS.POSITION_ENTRY);
          break;
        }
      }
    });

    it('should handle multiple simultaneous entry attempts', async () => {
      const tokens = Array(5).fill().map((_, i) => new Token(`TEST${i}`, {
        solToUSD: () => 100,
        getTokenPrice: () => 1,
        subscribeToPrice: jest.fn(),
        unsubscribeFromPrice: jest.fn()
      }));

      const start = performance.now();
      await Promise.all(tokens.map(token => 
        positionManager.openPosition(token.mint, token, 100)
      ));
      const duration = performance.now() - start;
      
      expect(duration).toBeLessThan(THRESHOLDS.POSITION_ENTRY * 2); // Allow some parallel overhead
    });
  });

  describe('Transaction Simulation', () => {
    it('should simulate network conditions accurately', async () => {
      const start = performance.now();
      const delay = await transactionSimulator.simulateTransactionDelay();
      const duration = performance.now() - start;
      
      expect(Math.abs(duration - delay)).toBeLessThan(5); // 5ms tolerance
    });

    it('should calculate price impact efficiently', () => {
      const iterations = 1000;
      const start = performance.now();
      
      for (let i = 0; i < iterations; i++) {
        transactionSimulator.calculatePriceImpact(1, 100, 1000);
      }
      
      const duration = performance.now() - start;
      expect(duration / iterations).toBeLessThan(0.1); // 0.1ms per calculation
    });
  });
});
