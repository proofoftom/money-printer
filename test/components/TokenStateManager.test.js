const TokenStateManager = require('../../src/core/token/TokenStateManager');
const EventEmitter = require('events');

jest.mock('../../src/core/token/Token');
jest.mock('../../src/utils/config', () => ({
  MCAP: {
    MIN: 1000,
  },
  SAFETY: {
    MIN_MARKET_STRUCTURE_SCORE: 0.5,
  },
}));

describe('TokenStateManager', () => {
  let stateManager;
  let mockToken;

  beforeEach(() => {
    stateManager = new TokenStateManager();
    mockToken = {
      state: 'new',
      isUnsafe: false,
      stateChangedAt: Date.now(),
      stateChangeReason: '',
      marketCap: 2000, // Above MIN threshold
      emit: jest.fn(),
      isPumping: jest.fn().mockReturnValue(false),
      isSafe: jest.fn().mockReturnValue(true)
    };
  });

  describe('State Transitions', () => {
    it('should allow valid state transitions', () => {
      stateManager.setState(mockToken, 'pumping');
      expect(mockToken.state).toBe('pumping');

      stateManager.setState(mockToken, 'drawdown');
      expect(mockToken.state).toBe('drawdown');

      stateManager.setState(mockToken, 'recovery');
      expect(mockToken.state).toBe('recovery');
    });

    it('should allow any transition in test mode', () => {
      mockToken.state = 'new';
      stateManager.setState(mockToken, 'closed'); // This would be invalid in production
      expect(mockToken.state).toBe('closed');

      mockToken.state = 'closed';
      stateManager.setState(mockToken, 'pumping'); // This would be invalid in production
      expect(mockToken.state).toBe('pumping');
    });
  });

  describe('Unsafe Token Handling', () => {
    it('should mark token as unsafe without changing state', () => {
      mockToken.state = 'drawdown';
      stateManager.markTokenUnsafe(mockToken, 'Test safety failure');
      
      expect(mockToken.isUnsafe).toBe(true);
      expect(mockToken.unsafeReason).toBe('Test safety failure');
      expect(mockToken.state).toBe('drawdown'); // State should not change
    });

    it('should prevent unsafe tokens from transitioning to open state from drawdown', () => {
      mockToken.state = 'drawdown';
      mockToken.isUnsafe = true;

      stateManager.setState(mockToken, 'open');
      expect(mockToken.state).toBe('drawdown'); // Should remain in drawdown
    });

    it('should prevent unsafe tokens from transitioning to open state from recovery', () => {
      mockToken.state = 'recovery';
      mockToken.isUnsafe = true;

      stateManager.setState(mockToken, 'open');
      expect(mockToken.state).toBe('recovery'); // Should remain in recovery
    });

    it('should allow unsafe tokens to transition between drawdown and recovery', () => {
      mockToken.state = 'drawdown';
      mockToken.isUnsafe = true;

      stateManager.setState(mockToken, 'recovery');
      expect(mockToken.state).toBe('recovery');

      stateManager.setState(mockToken, 'drawdown');
      expect(mockToken.state).toBe('drawdown');
    });

    it('should allow safe tokens to transition to open state', () => {
      mockToken.state = 'recovery';
      mockToken.isUnsafe = false;

      stateManager.setState(mockToken, 'open');
      expect(mockToken.state).toBe('open');
    });
  });

  describe('Event Emission', () => {
    it('should emit stateChanged event on valid transitions', (done) => {
      stateManager.on('stateChanged', ({ token, from, to, reason }) => {
        expect(token).toBe(mockToken);
        expect(from).toBe('new');
        expect(to).toBe('pumping');
        expect(reason).toBe('test reason');
        done();
      });

      stateManager.setState(mockToken, 'pumping', 'test reason');
    });

    it('should emit tokenUnsafe event when marking token unsafe', (done) => {
      stateManager.on('tokenUnsafe', ({ token, reason }) => {
        expect(token).toBe(mockToken);
        expect(reason).toBe('test unsafe reason');
        done();
      });

      stateManager.markTokenUnsafe(mockToken, 'test unsafe reason');
    });
  });

  describe('Token Evaluation', () => {
    it('should mark token as unsafe when safety check fails', async () => {
      mockToken.isSafe = jest.fn().mockReturnValue(false);
      
      await stateManager.evaluateToken(mockToken);
      
      expect(mockToken.isUnsafe).toBe(true);
      expect(mockToken.unsafeReason).toBe('Failed safety checks');
    });

    it('should not change state when marking token as unsafe', async () => {
      mockToken.state = 'recovery';
      mockToken.isSafe = jest.fn().mockReturnValue(false);
      
      await stateManager.evaluateToken(mockToken);
      
      expect(mockToken.state).toBe('recovery'); // State should remain unchanged
    });

    it('should not mark new token as dead when market cap is low', async () => {
      mockToken.state = 'new';
      mockToken.marketCap = 500; // Below MIN threshold
      mockToken.isSafe = jest.fn().mockReturnValue(true);
      
      await stateManager.evaluateToken(mockToken);
      
      expect(mockToken.state).toBe('new'); // Should remain in new state
    });

    it('should mark pumping token as dead when market cap is low', async () => {
      mockToken.state = 'pumping';
      mockToken.marketCap = 500; // Below MIN threshold
      mockToken.isSafe = jest.fn().mockReturnValue(true);
      
      await stateManager.evaluateToken(mockToken);
      
      expect(mockToken.state).toBe('dead');
      expect(mockToken.stateChangeReason).toBe('Market cap too low');
    });

    it('should mark recovery token as dead when market cap is low', async () => {
      mockToken.state = 'recovery';
      mockToken.marketCap = 500; // Below MIN threshold
      mockToken.isSafe = jest.fn().mockReturnValue(true);
      
      await stateManager.evaluateToken(mockToken);
      
      expect(mockToken.state).toBe('dead');
      expect(mockToken.stateChangeReason).toBe('Market cap too low');
    });
  });
});
