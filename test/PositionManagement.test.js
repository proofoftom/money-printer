const PositionManager = require('../src/PositionManager');
const Token = require('../src/Token');
const { scenarios } = require('./__fixtures__/websocket');
const TransactionSimulator = require('../src/TransactionSimulator');

// Mock config
jest.mock('../src/config', () => ({
  SIMULATION_MODE: true,
  SAFETY: {
    MIN_UNIQUE_BUYERS: 5,
    MIN_BUY_SELL_RATIO: 1.5,
    MIN_VOLUME_ACCELERATION: 2.0,
    MIN_BUY_PRESSURE: 0.6
  },
  POSITION: {
    MIN_ENTRY_CONFIDENCE: 40,
    PARTIAL_EXIT: {
      CREATOR_SELL: 0.25,
      SUSPICIOUS_TRADING: 0.5,
      BUY_PRESSURE_DROP: 0.25
    }
  },
  TRANSACTION: {
    SIMULATION_MODE: {
      ENABLED: true,
      AVG_BLOCK_TIME: 0.4,
      PRICE_IMPACT: {
        ENABLED: true,
        SLIPPAGE_BASE: 1,
        VOLUME_MULTIPLIER: 0.5
      }
    }
  }
}));

describe('Position Management', () => {
  let positionManager;
  let token;
  let wallet;
  let transactionSimulator;

  beforeEach(() => {
    wallet = {
      balance: 10,
      updateBalance: jest.fn(),
      recordTrade: jest.fn()
    };
    
    transactionSimulator = new TransactionSimulator();
    positionManager = new PositionManager(wallet);
    positionManager.transactionSimulator = transactionSimulator;

    token = new Token('TEST123', {
      solToUSD: () => 100,
      getTokenPrice: () => 1,
      subscribeToPrice: jest.fn(),
      unsubscribeFromPrice: jest.fn()
    });
  });

  describe('Position Sizing', () => {
    it('should scale position size based on entry confidence', async () => {
      const messages = scenarios.successfulPump(token.mint);
      
      // Process messages until accumulation phase
      for (const msg of messages) {
        token.processMessage(msg);
        if (token.stateManager.state === 'ACCUMULATION') break;
      }

      const position = await positionManager.openPosition(token.mint, token, 100);
      expect(position).toBeTruthy();
      
      // Check position size scaling
      const confidence = token.stateManager.getBestEntry().confidence;
      const expectedMultiplier = confidence >= 91 ? 1.5 :
                                confidence >= 81 ? 1.25 :
                                confidence >= 61 ? 1.0 :
                                confidence >= 41 ? 0.75 : 0.5;
      
      expect(position.size).toBe(positionManager.calculateBaseSize(100) * expectedMultiplier);
    });

    it('should adjust size based on token state', async () => {
      const messages = scenarios.successfulPump(token.mint);
      
      for (const msg of messages) {
        token.processMessage(msg);
        if (token.stateManager.state === 'LAUNCHING') {
          const position = await positionManager.openPosition(token.mint, token, 100);
          expect(position.size).toBe(positionManager.calculateBaseSize(100) * 1.25);
          break;
        }
      }
    });
  });

  describe('Partial Exits', () => {
    it('should execute partial exit on creator selling', async () => {
      const creatorKey = 'creator_key';
      const messages = scenarios.creatorDump(token.mint, creatorKey);
      let position;

      for (const msg of messages) {
        token.processMessage(msg);
        
        if (!position && token.stateManager.state === 'ACCUMULATION') {
          position = await positionManager.openPosition(token.mint, token, 100);
        }

        if (position && msg.txType === 'sell' && msg.traderPublicKey === creatorKey) {
          await positionManager.updatePosition(token.mint, 1.0, token);
          expect(position.remainingSize).toBe(0.75); // 25% exit
        }
      }
    });

    it('should execute larger partial exit on suspicious trading', async () => {
      const messages = scenarios.washTrading(token.mint);
      let position;

      for (const msg of messages) {
        token.processMessage(msg);
        
        if (!position && token.stateManager.state !== 'NEW') {
          position = await positionManager.openPosition(token.mint, token, 100);
        }
      }

      await positionManager.updatePosition(token.mint, 1.0, token);
      expect(position.remainingSize).toBe(0.5); // 50% exit on wash trading
    });
  });

  describe('Stop Losses', () => {
    it('should exit full position on severe conditions', async () => {
      const messages = scenarios.failedLaunch(token.mint);
      let position;

      for (const msg of messages) {
        token.processMessage(msg);
        
        if (!position && token.stateManager.state === 'ACCUMULATION') {
          position = await positionManager.openPosition(token.mint, token, 100);
        }
      }

      await positionManager.updatePosition(token.mint, 0.7, token); // 30% drop
      expect(position.remainingSize).toBe(0); // Full exit
    });
  });
});
