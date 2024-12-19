const TokenTracker = require('../TokenTracker');
const config = require('../config');

describe('TokenTracker', () => {
  let tokenTracker;
  let mockSafetyChecker;
  let mockEmit;

  beforeEach(() => {
    mockSafetyChecker = {
      isTokenSafe: jest.fn()
    };
    
    tokenTracker = new TokenTracker(mockSafetyChecker);
    mockEmit = jest.spyOn(tokenTracker, 'emit');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Token Management', () => {
    const mockTokenData = {
      mint: 'TEST',
      name: 'Test Token',
      symbol: 'TEST',
      timestamp: Date.now(),
      creator: 'creator',
      vTokens: '1000000000', // 1000 tokens
      vSol: '10000000', // 10 SOL
      marketCap: '1000000000', // 1000
      curveKey: 'key',
      txType: 'create'
    };

    it('should handle new token creation', async () => {
      mockSafetyChecker.isTokenSafe.mockResolvedValue(true);
      
      await tokenTracker.handleNewTokenAsync(mockTokenData);
      
      expect(tokenTracker.tokens.size).toBe(1);
      expect(mockEmit).toHaveBeenCalledWith('tokenAdded', expect.objectContaining({
        mint: 'TEST',
        symbol: 'TEST'
      }));
    });

    it('should not add unsafe tokens', async () => {
      mockSafetyChecker.isTokenSafe.mockResolvedValue(false);
      
      await tokenTracker.handleNewTokenAsync(mockTokenData);
      
      expect(tokenTracker.tokens.size).toBe(0);
      expect(mockEmit).not.toHaveBeenCalledWith('tokenAdded', expect.any(Object));
    });

    it('should update existing tokens', async () => {
      mockSafetyChecker.isTokenSafe.mockResolvedValue(true);
      
      // First add the token
      await tokenTracker.handleNewTokenAsync(mockTokenData);
      
      // Then update it
      const updateData = {
        ...mockTokenData,
        vSol: '20000000', // 20 SOL
        marketCap: '2000000000' // 2000
      };
      
      await tokenTracker.handleTokenUpdateAsync(updateData);
      
      const updatedToken = tokenTracker.tokens.get('TEST');
      expect(updatedToken.vSol).toBe('20.000');
      expect(updatedToken.marketCap).toBe('2000.000');
      expect(mockEmit).toHaveBeenCalledWith('tokenUpdated', expect.objectContaining({
        mint: 'TEST',
        vSol: '20.000'
      }));
    });

    it('should ignore updates for unknown tokens', async () => {
      await tokenTracker.handleTokenUpdateAsync(mockTokenData);
      
      expect(tokenTracker.tokens.size).toBe(0);
      expect(mockEmit).not.toHaveBeenCalledWith('tokenUpdated', expect.any(Object));
    });
  });

  describe('Token Analysis', () => {
    it('should calculate token age correctly', () => {
      const now = Date.now();
      const token = {
        timestamp: now - 5 * 60 * 1000 // 5 minutes ago
      };
      
      const age = tokenTracker.calculateTokenAge(token);
      expect(age).toBe('5m');
    });

    it('should format market metrics', () => {
      const metrics = tokenTracker.formatMarketMetrics({
        vSol: '10000000', // 10 SOL
        vTokens: '1000000000', // 1000 tokens
        marketCap: '10000000000' // 10000
      });
      
      expect(metrics.vSol).toBe('10.000');
      expect(metrics.vTokens).toBe('1000.000');
      expect(metrics.marketCap).toBe('10000.000');
    });
  });

  describe('Token Filtering', () => {
    it('should filter old tokens', () => {
      const oldToken = {
        mint: 'OLD',
        timestamp: Date.now() - (config.MAX_TOKEN_AGE + 1000)
      };
      
      const newToken = {
        mint: 'NEW',
        timestamp: Date.now()
      };
      
      tokenTracker.tokens.set('OLD', oldToken);
      tokenTracker.tokens.set('NEW', newToken);
      
      tokenTracker.filterOldTokens();
      
      expect(tokenTracker.tokens.has('OLD')).toBe(false);
      expect(tokenTracker.tokens.has('NEW')).toBe(true);
    });

    it('should filter low liquidity tokens', () => {
      const lowLiqToken = {
        mint: 'LOW',
        vSol: '100000' // 0.1 SOL
      };
      
      const goodLiqToken = {
        mint: 'GOOD',
        vSol: '10000000' // 10 SOL
      };
      
      tokenTracker.tokens.set('LOW', lowLiqToken);
      tokenTracker.tokens.set('GOOD', goodLiqToken);
      
      tokenTracker.filterLowLiquidityTokens();
      
      expect(tokenTracker.tokens.has('LOW')).toBe(false);
      expect(tokenTracker.tokens.has('GOOD')).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid token data', async () => {
      const invalidData = {
        mint: 'TEST'
        // Missing required fields
      };
      
      await tokenTracker.handleNewTokenAsync(invalidData);
      
      expect(tokenTracker.tokens.size).toBe(0);
      expect(console.error).toHaveBeenCalledWith('Invalid token data:', expect.any(String));
    });

    it('should handle safety check errors', async () => {
      mockSafetyChecker.isTokenSafe.mockRejectedValue(new Error('Safety check failed'));
      
      await tokenTracker.handleNewTokenAsync({
        mint: 'TEST',
        name: 'Test Token',
        symbol: 'TEST',
        timestamp: Date.now()
      });
      
      expect(tokenTracker.tokens.size).toBe(0);
      expect(console.error).toHaveBeenCalledWith('Error handling new token:', expect.any(Error));
    });
  });
});
