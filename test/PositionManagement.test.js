const Token = require('../src/Token');
const MockPositionManager = require('./__mocks__/PositionManager');
const mockConfig = require('./__mocks__/config');

jest.mock('../src/config', () => mockConfig);
jest.mock('../src/PositionManager', () => MockPositionManager);

describe('Position Management', () => {
  let token;
  let positionManager;
  let config;

  beforeEach(() => {
    config = mockConfig();
    token = new Token('TEST');
    positionManager = new MockPositionManager();
  });

  describe('Position Sizing', () => {
    test('should scale position size based on entry confidence', async () => {
      // Create token and simulate high confidence scenario
      token.processMessage({
        txType: 'create',
        traderPublicKey: 'creator'
      });

      // Simulate strong buying pressure
      for (let i = 0; i < 20; i++) {
        token.processMessage({
          txType: 'buy',
          traderPublicKey: `buyer${i}`,
          amount: 2.0
        });
      }

      const entered = await positionManager.enterPosition(token);
      expect(entered).toBe(true);

      const position = positionManager.positions.get(token.address);
      expect(position.size).toBeGreaterThan(config.POSITION_MANAGER.BASE_POSITION_SIZE);
    });

    test('should adjust size based on token state', async () => {
      // Create token
      token.processMessage({
        txType: 'create',
        traderPublicKey: 'creator'
      });

      // Simulate progression through states
      const states = ['accumulation', 'launching', 'pumping'];
      const sizes = [];

      for (const state of states) {
        // Generate enough activity to reach the state
        for (let i = 0; i < 10; i++) {
          token.processMessage({
            txType: 'buy',
            traderPublicKey: `buyer_${state}_${i}`,
            amount: state === 'pumping' ? 5.0 : 2.0
          });
        }

        await positionManager.enterPosition(token);
        const position = positionManager.positions.get(token.address);
        sizes.push(position.size);
      }

      // Verify position sizes increase with more aggressive states
      for (let i = 1; i < sizes.length; i++) {
        expect(sizes[i]).toBeGreaterThan(sizes[i-1]);
      }
    });
  });

  describe('Partial Exits', () => {
    test('should execute partial exit on creator selling', async () => {
      // Setup initial position
      token.processMessage({
        txType: 'create',
        traderPublicKey: 'creator'
      });

      for (let i = 0; i < 10; i++) {
        token.processMessage({
          txType: 'buy',
          traderPublicKey: `buyer${i}`,
          amount: 2.0
        });
      }

      await positionManager.enterPosition(token);
      const initialSize = positionManager.positions.get(token.address).size;

      // Simulate creator selling
      token.processMessage({
        txType: 'sell',
        traderPublicKey: 'creator',
        amount: 1.0
      });

      await positionManager.exitPosition(token, config.POSITION_MANAGER.PARTIAL_EXIT.CREATOR_SELL);
      const position = positionManager.positions.get(token.address);
      expect(position.size).toBeLessThan(initialSize);
    });

    test('should execute larger partial exit on suspicious trading', async () => {
      // Setup initial position
      token.processMessage({
        txType: 'create',
        traderPublicKey: 'creator'
      });

      for (let i = 0; i < 10; i++) {
        token.processMessage({
          txType: 'buy',
          traderPublicKey: `buyer${i}`,
          amount: 2.0
        });
      }

      await positionManager.enterPosition(token);
      const initialSize = positionManager.positions.get(token.address).size;

      // Simulate wash trading
      const suspiciousTrader = 'wash_trader';
      for (let i = 0; i < 5; i++) {
        token.processMessage({
          txType: 'buy',
          traderPublicKey: suspiciousTrader,
          amount: 1.0
        });
        token.processMessage({
          txType: 'sell',
          traderPublicKey: suspiciousTrader,
          amount: 1.0
        });
      }

      await positionManager.exitPosition(token, config.POSITION_MANAGER.PARTIAL_EXIT.SUSPICIOUS_TRADING);
      const position = positionManager.positions.get(token.address);
      expect(position.size).toBeLessThan(initialSize * 0.75); // Larger exit than creator sell
    });
  });

  describe('Stop Losses', () => {
    test('should exit full position on severe conditions', async () => {
      // Setup initial position
      token.processMessage({
        txType: 'create',
        traderPublicKey: 'creator'
      });

      for (let i = 0; i < 10; i++) {
        token.processMessage({
          txType: 'buy',
          traderPublicKey: `buyer${i}`,
          amount: 2.0
        });
      }

      await positionManager.enterPosition(token);

      // Simulate severe price drop
      for (let i = 0; i < 20; i++) {
        token.processMessage({
          txType: 'sell',
          traderPublicKey: `panic_seller${i}`,
          amount: 3.0
        });
      }

      await positionManager.exitPosition(token);
      expect(positionManager.positions.has(token.address)).toBe(false);
    });
  });
});
