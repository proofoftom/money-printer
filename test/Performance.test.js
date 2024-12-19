const Token = require('../src/Token');
const MockPositionManager = require('./__mocks__/PositionManager');
const mockConfig = require('./__mocks__/config');

jest.mock('../src/config', () => mockConfig);
jest.mock('../src/PositionManager', () => MockPositionManager);

describe('Performance Tests', () => {
  let token;
  let positionManager;
  let config;

  beforeEach(() => {
    config = mockConfig();
    token = new Token('TEST');
    positionManager = new MockPositionManager();
  });

  describe('Message Processing Speed', () => {
    test('should process messages within threshold', () => {
      const startTime = performance.now();
      
      // Process 1000 messages
      for (let i = 0; i < 1000; i++) {
        token.processMessage({
          txType: 'buy',
          traderPublicKey: `buyer${i}`,
          amount: 1.0
        });
      }
      
      const endTime = performance.now();
      const processingTime = endTime - startTime;
      
      // Average processing time should be less than 1ms per message
      expect(processingTime / 1000).toBeLessThan(1);
    });

    test('should handle rapid message bursts', () => {
      const burstSize = 100;
      const bursts = 10;
      
      for (let burst = 0; burst < bursts; burst++) {
        const startTime = performance.now();
        
        for (let i = 0; i < burstSize; i++) {
          token.processMessage({
            txType: 'buy',
            traderPublicKey: `buyer${burst}_${i}`,
            amount: 1.0
          });
        }
        
        const endTime = performance.now();
        const burstTime = endTime - startTime;
        
        // Each burst should process in under 50ms
        expect(burstTime).toBeLessThan(50);
      }
    });
  });

  describe('Pattern Detection Speed', () => {
    test('should detect wash trading patterns quickly', () => {
      const startTime = performance.now();
      const trader = 'suspicious_trader';
      
      // Simulate rapid buy/sell patterns
      for (let i = 0; i < 50; i++) {
        token.processMessage({
          txType: 'buy',
          traderPublicKey: trader,
          amount: 1.0
        });
        
        token.processMessage({
          txType: 'sell',
          traderPublicKey: trader,
          amount: 1.0
        });
      }
      
      const endTime = performance.now();
      const detectionTime = endTime - startTime;
      
      expect(token.metrics.earlyTrading.suspiciousActivity).toContain('wash_trading');
      expect(detectionTime).toBeLessThan(100); // Detection should happen within 100ms
    });

    test('should detect creator dumps quickly', () => {
      const startTime = performance.now();
      
      // Create token
      token.processMessage({
        txType: 'create',
        traderPublicKey: 'creator'
      });
      
      // Simulate creator selling
      token.processMessage({
        txType: 'sell',
        traderPublicKey: 'creator',
        amount: 10.0
      });
      
      const endTime = performance.now();
      const detectionTime = endTime - startTime;
      
      expect(token.stateManager.state).toBe('dead');
      expect(detectionTime).toBeLessThan(50); // Detection should happen within 50ms
    });
  });

  describe('Position Entry Timing', () => {
    test('should enter positions quickly after detection', async () => {
      // Setup token with strong buy pressure
      for (let i = 0; i < 10; i++) {
        token.processMessage({
          txType: 'buy',
          traderPublicKey: `buyer${i}`,
          amount: 2.0
        });
      }
      
      const startTime = performance.now();
      const entered = await positionManager.enterPosition(token);
      const endTime = performance.now();
      
      expect(entered).toBe(true);
      expect(endTime - startTime).toBeLessThan(50); // Entry should happen within 50ms
    });

    test('should handle multiple simultaneous entry attempts', async () => {
      const tokens = Array.from({ length: 5 }, (_, i) => new Token(`TEST${i}`));
      
      // Setup all tokens with strong buy pressure
      tokens.forEach(t => {
        for (let i = 0; i < 10; i++) {
          t.processMessage({
            txType: 'buy',
            traderPublicKey: `buyer${i}`,
            amount: 2.0
          });
        }
      });
      
      const startTime = performance.now();
      const entryPromises = tokens.map(t => positionManager.enterPosition(t));
      await Promise.all(entryPromises);
      const endTime = performance.now();
      
      const totalTime = endTime - startTime;
      expect(totalTime / tokens.length).toBeLessThan(20); // Average entry time should be under 20ms
    });
  });

  describe('Transaction Simulation', () => {
    test('should simulate network conditions accurately', async () => {
      // Create token with high volume
      token.processMessage({
        txType: 'create',
        traderPublicKey: 'creator'
      });

      for (let i = 0; i < 20; i++) {
        token.processMessage({
          txType: 'buy',
          traderPublicKey: `buyer${i}`,
          amount: 5.0
        });
      }

      const startTime = performance.now();
      await positionManager.enterPosition(token);
      const endTime = performance.now();

      const simulationTime = endTime - startTime;
      expect(simulationTime).toBeGreaterThan(0); // Should take some time to simulate
      expect(simulationTime).toBeLessThan(200); // But not too long
    });

    test('should calculate price impact efficiently', () => {
      const volumes = [1000, 5000, 10000, 50000, 100000];
      const startTime = performance.now();
      
      volumes.forEach(volume => {
        token.processMessage({
          txType: 'buy',
          traderPublicKey: 'large_trader',
          amount: volume
        });
      });
      
      const endTime = performance.now();
      const calculationTime = endTime - startTime;
      
      expect(calculationTime / volumes.length).toBeLessThan(10); // Each calculation should take less than 10ms
    });
  });
});
