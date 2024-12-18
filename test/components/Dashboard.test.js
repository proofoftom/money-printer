const Dashboard = require('../../src/monitoring/Dashboard');
const EventEmitter = require('events');

// Mock blessed and blessed-contrib
jest.mock('blessed', () => ({
  screen: jest.fn().mockReturnValue({
    append: jest.fn(),
    key: jest.fn(),
    render: jest.fn(),
    destroy: jest.fn()
  }),
  box: jest.fn().mockReturnValue({
    setContent: jest.fn(),
    setLabel: jest.fn(),
    append: jest.fn()
  }),
  log: jest.fn().mockReturnValue({
    setContent: jest.fn(),
    scroll: jest.fn(),
    setScrollPerc: jest.fn()
  }),
  text: jest.fn().mockReturnValue({
    setContent: jest.fn()
  })
}));

jest.mock('blessed-contrib', () => ({
  grid: jest.fn().mockReturnValue({
    set: jest.fn(),
    applyLayout: jest.fn()
  }),
  line: jest.fn().mockReturnValue({
    setData: jest.fn()
  }),
  table: jest.fn().mockReturnValue({
    setData: jest.fn()
  })
}));

describe('Dashboard', () => {
  let dashboard;
  let mockWallet;
  let mockTokenManager;
  let mockPositionManager;
  let mockSafetyChecker;
  let mockPriceManager;
  let mockTraderManager;
  let mockConfig;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock dependencies with event emitter functionality
    mockWallet = new EventEmitter();
    mockWallet.getBalance = jest.fn().mockResolvedValue(1000);

    mockTokenManager = new EventEmitter();
    mockTokenManager.tokens = new Map();
    mockTokenManager.getToken = jest.fn();

    mockPositionManager = new EventEmitter();
    mockPositionManager.positions = new Map();
    mockPositionManager.getPosition = jest.fn();

    mockSafetyChecker = new EventEmitter();
    mockSafetyChecker.checkToken = jest.fn().mockResolvedValue(true);

    mockPriceManager = new EventEmitter();
    mockPriceManager.solToUSD = jest.fn().mockReturnValue(20);

    mockTraderManager = new EventEmitter();
    mockTraderManager.traders = new Map();

    mockConfig = {
      DASHBOARD: {
        UPDATE_INTERVAL: 1000,
        MAX_TRADES: 100
      }
    };

    // Create dashboard instance
    dashboard = new Dashboard(
      mockWallet,
      mockTokenManager,
      mockPositionManager,
      mockSafetyChecker,
      mockPriceManager,
      mockTraderManager,
      mockConfig
    );
  });

  afterEach(() => {
    if (dashboard) {
      dashboard.cleanup();
    }
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe('Event Flow', () => {
    it('should handle token creation events', () => {
      const mockToken = {
        mint: 'mock-mint',
        name: 'Mock Token',
        symbol: 'MOCK',
        currentPrice: 100
      };

      mockTokenManager.emit('tokenCreated', mockToken);

      expect(dashboard.tokens.has(mockToken.mint)).toBe(true);
    });

    it('should handle position updates', () => {
      const mockPosition = {
        mint: 'mock-mint',
        currentPrice: 100,
        currentProfit: 0.2,
        volume: 1000
      };

      mockPositionManager.emit('positionUpdate', mockPosition);

      expect(dashboard.positions.has(mockPosition.mint)).toBe(true);
    });

    it('should handle trade events', () => {
      const mockTrade = {
        mint: 'mock-mint',
        type: 'buy',
        amount: 100,
        price: 10
      };

      dashboard.handleTrade(mockTrade);

      expect(dashboard.trades).toContain(mockTrade);
      expect(dashboard.trades.length).toBeLessThanOrEqual(mockConfig.DASHBOARD.MAX_TRADES);
    });

    it('should handle price updates', () => {
      const updateHandler = jest.fn();
      dashboard.on('priceUpdate', updateHandler);

      mockPriceManager.emit('priceUpdate', {
        solPrice: 20,
        timestamp: Date.now()
      });

      expect(updateHandler).toHaveBeenCalled();
    });
  });

  describe('State Management', () => {
    it('should track active positions correctly', () => {
      const mockPosition = {
        mint: 'mock-mint',
        currentPrice: 100,
        currentProfit: 0.2
      };

      dashboard.updatePosition(mockPosition);
      expect(dashboard.positions.get(mockPosition.mint)).toEqual(mockPosition);
    });

    it('should maintain trade history within limits', () => {
      // Add more trades than the limit
      for (let i = 0; i < mockConfig.DASHBOARD.MAX_TRADES + 10; i++) {
        dashboard.handleTrade({
          mint: `mint-${i}`,
          type: 'buy',
          amount: 100,
          price: 10
        });
      }

      expect(dashboard.trades.length).toBe(mockConfig.DASHBOARD.MAX_TRADES);
    });

    it('should update wallet balance', async () => {
      await dashboard.updateWalletBalance();
      expect(mockWallet.getBalance).toHaveBeenCalled();
    });
  });

  describe('UI Updates', () => {
    it('should trigger UI updates on state changes', () => {
      const updateHandler = jest.fn();
      dashboard.on('uiUpdate', updateHandler);

      dashboard.updatePosition({
        mint: 'mock-mint',
        currentPrice: 100,
        currentProfit: 0.2
      });

      expect(updateHandler).toHaveBeenCalled();
    });

    it('should handle token detail view updates', () => {
      const mockToken = {
        mint: 'mock-mint',
        name: 'Mock Token',
        symbol: 'MOCK',
        currentPrice: 100
      };

      dashboard.showTokenDetails(mockToken);
      expect(dashboard.selectedToken).toEqual(mockToken);
    });
  });

  describe('Cleanup', () => {
    it('should clean up resources and event listeners', () => {
      const cleanupHandler = jest.fn();
      dashboard.on('cleanup', cleanupHandler);

      dashboard.cleanup();

      expect(cleanupHandler).toHaveBeenCalled();
      expect(dashboard.listenerCount('uiUpdate')).toBe(0);
      expect(dashboard.listenerCount('priceUpdate')).toBe(0);
    });
  });
});
