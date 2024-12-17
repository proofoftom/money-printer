// Mock config
jest.mock('../src/utils/config', () => ({
  TESTING: {
    CLEAR_DATA_ON_START: false,
    DATA_DIR: "test/data",
    SIMULATION_MODE: {
      ENABLED: true,
      AVG_BLOCK_TIME: 0.4,
      PRICE_IMPACT: {
        ENABLED: true,
        SLIPPAGE_BASE: 1,
        VOLUME_MULTIPLIER: 1.2
      }
    }
  },
  SAFETY: {
    MIN_LIQUIDITY_SOL: 10,
    MAX_PRICE_IMPACT: 0.05,
    MIN_VOLUME_24H: 1000,
    MIN_HOLDERS: 100,
    MAX_WALLET_CONCENTRATION: 0.2
  },
  POSITION: {
    MIN_PROFIT_THRESHOLD: 0.02,
    MAX_LOSS_THRESHOLD: 0.05
  },
  TRANSACTION: {
    SIMULATION_MODE: {
      ENABLED: true,
      AVG_BLOCK_TIME: 0.4,
      PRICE_IMPACT: {
        ENABLED: true,
        SLIPPAGE_BASE: 1,
        VOLUME_MULTIPLIER: 1.2
      }
    }
  }
}));

// Set test environment
process.env.NODE_ENV = 'test';
