const Token = require('../../src/core/token/Token');
const EventEmitter = require('events');

jest.mock('../../src/utils/config', () => ({
  TOKEN: {
    CLEANUP_INTERVAL: 60000,
    STALE_LISTENER_THRESHOLD: 300000
  }
}));

describe('Token', () => {
  let token;
  let mockTokenData;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockTokenData = {
      mint: 'mock-mint',
      name: 'Mock Token',
      symbol: 'MOCK',
      traderPublicKey: 'mock-trader',
      initialBuy: 100,
      vTokensInBondingCurve: 1000,
      vSolInBondingCurve: 10,
      marketCapSol: 50,
      uri: 'mock-uri'
    };

    token = new Token(mockTokenData);
  });

  afterEach(() => {
    if (token) {
      token.cleanup();
    }
  });

  describe('Event Management', () => {
    it('should track registered listeners', () => {
      const mockHandler = jest.fn();
      token.addListener('test', mockHandler);
      
      expect(token.registeredListeners.size).toBe(1);
      expect(token.listenerCount('test')).toBe(1);
    });

    it('should remove listeners on cleanup', () => {
      const mockHandler = jest.fn();
      token.addListener('test', mockHandler);
      
      token.cleanup();
      
      expect(token.registeredListeners.size).toBe(0);
      expect(token.listenerCount('test')).toBe(0);
    });

    it('should warn when emitting events with no listeners', () => {
      const consoleSpy = jest.spyOn(console, 'warn');
      
      token.emit('noListeners');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No listeners for event')
      );
    });
  });

  describe('State Management', () => {
    it('should initialize with correct state', () => {
      expect(token.mint).toBe(mockTokenData.mint);
      expect(token.state).toBe('new');
      expect(token.stateChangeReason).toBe('Token created');
    });

    it('should update trade metrics', () => {
      const tradeData = {
        amount: 100,
        price: 1.5,
        timestamp: Date.now()
      };

      token.updateTrade(tradeData);

      expect(token.tradeCount).toBe(1);
      expect(token.trades).toHaveLength(1);
      expect(token.lastTradeTime).toBeTruthy();
    });

    it('should track volume correctly', () => {
      const amount = 100;
      const price = 1.5;
      const timestamp = Date.now();

      token.updateVolume(amount, price, timestamp);

      expect(token.volumeHistory).toHaveLength(1);
      expect(token.volume24h).toBeGreaterThan(0);
    });
  });

  describe('Price Tracking', () => {
    it('should update price metrics', () => {
      const newPrice = 2.0;
      token.updatePriceMetrics(newPrice);

      expect(token.currentPrice).toBe(newPrice);
      expect(token.priceBuffer.count).toBe(1);
    });

    it('should calculate price changes correctly', () => {
      token.updatePriceMetrics(1.0);
      token.updatePriceMetrics(1.5);
      
      const change = token.getPriceChange(60);
      expect(change).toBe(0.5);
    });
  });

  describe('Market Analysis', () => {
    it('should detect pumping state', () => {
      token.updatePriceMetrics(1.0);
      token.updatePriceMetrics(2.0); // 100% increase
      
      expect(token.isPumping()).toBe(true);
    });

    it('should calculate market cap', () => {
      const marketCap = token.getMarketCap();
      expect(marketCap).toBe(mockTokenData.marketCapSol);
    });

    it('should track drawdown', () => {
      token.updatePriceMetrics(2.0);
      token.updatePriceMetrics(1.0); // 50% drawdown
      
      expect(token.getDrawdownPercentage()).toBe(0.5);
    });
  });

  describe('Safety Checks', () => {
    it('should mark token as unsafe when conditions met', () => {
      token.updatePriceMetrics(10.0); // Significant price increase
      token.updatePriceMetrics(1.0);  // Sharp decline
      
      expect(token.isSafe()).toBe(false);
    });

    it('should update unsafe reason', () => {
      token.unsafeReason = {
        reason: 'High volatility',
        value: 0.5
      };
      
      expect(token.isSafe()).toBe(false);
      expect(token.unsafeReason.reason).toBe('High volatility');
    });
  });

  describe('Resource Cleanup', () => {
    it('should clean up all resources', () => {
      // Add some data
      token.updateTrade({ amount: 100, price: 1.5, timestamp: Date.now() });
      token.addListener('test', () => {});
      
      // Cleanup
      token.cleanup();
      
      expect(token.trades).toHaveLength(0);
      expect(token.volumeHistory).toHaveLength(0);
      expect(token.listenerCount('test')).toBe(0);
      expect(token.registeredListeners.size).toBe(0);
      expect(token.priceBuffer).toBeNull();
    });
  });
});
