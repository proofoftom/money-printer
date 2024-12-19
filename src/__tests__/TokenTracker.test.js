const EventEmitter = require('events');
const { Token, STATES } = require('../Token');
const TokenTracker = require('../TokenTracker');

// Mock Token class
jest.mock("../Token", () => {
  const { STATES } = jest.requireActual("../Token");
  const { EventEmitter } = jest.requireActual("events");
  
  class MockToken extends EventEmitter {
    constructor(data, deps) {
      super();
      this.mint = data.mint;
      this.symbol = data.symbol;
      this.state = STATES.NEW;
      this.marketCapSol = data.marketCapSol || 0;
      this.highestMarketCap = this.marketCapSol;
      this.safetyChecker = deps.safetyChecker;
      this.getCurrentPrice = jest.fn().mockReturnValue(1);
      this.getDrawdownPercentage = jest.fn().mockReturnValue(0);
      this.update = jest.fn();
      this.getCurrentState = jest.fn().mockReturnValue(this.state);
      this.setState = jest.fn().mockImplementation((newState) => {
        const oldState = this.state;
        this.state = newState;
        this.emit('stateChanged', { token: this, from: oldState, to: newState });
        if (newState === STATES.READY) {
          this.emit('readyForPosition', { token: this });
        }
        return { success: true, from: oldState, to: newState };
      });
      this.checkState = jest.fn().mockImplementation(() => {
        if (this.safetyChecker.isTokenSafe(this)) {
          this.setState(STATES.READY);
        }
      });
    }
  }

  return {
    Token: MockToken,
    STATES
  };
});

// Mock dependencies
const mockSafetyChecker = {
  isTokenSafe: jest.fn().mockReturnValue(true)
};

const mockPositionManager = {
  openPosition: jest.fn().mockReturnValue(true),
  isTradingEnabled: jest.fn().mockReturnValue(true)
};

const mockPriceManager = {
  getPrice: jest.fn().mockReturnValue(1)
};

const mockWebSocketManager = new EventEmitter();
mockWebSocketManager.subscribeToToken = jest.fn();
mockWebSocketManager.unsubscribeFromToken = jest.fn();

describe("TokenTracker", () => {
  let tokenTracker;
  let defaultTokenData;

  beforeEach(() => {
    jest.clearAllMocks();
    
    tokenTracker = new TokenTracker({
      safetyChecker: mockSafetyChecker,
      positionManager: mockPositionManager,
      priceManager: mockPriceManager,
      webSocketManager: mockWebSocketManager
    });

    defaultTokenData = {
      mint: 'test-mint',
      symbol: 'TEST',
      marketCapSol: 100,
      vTokensInBondingCurve: 1000,
      vSolInBondingCurve: 100
    };
  });

  describe('Token Tracking and Events', () => {
    describe('handleNewToken', () => {
      test('should emit tokenAdded event when new token is added', () => {
        const addSpy = jest.spyOn(tokenTracker, 'emit');
        tokenTracker.handleNewToken(defaultTokenData);
        
        expect(addSpy).toHaveBeenCalledWith('tokenAdded', expect.any(Object));
        expect(tokenTracker.tokens.has('test-mint')).toBeTruthy();
      });

      test('should emit tokenUpdated event when existing token is updated', () => {
        tokenTracker.handleNewToken(defaultTokenData);
        
        const updateSpy = jest.spyOn(tokenTracker, 'emit');
        tokenTracker.handleNewToken({
          ...defaultTokenData,
          marketCapSol: 150
        });
        
        expect(updateSpy).toHaveBeenCalledWith('tokenUpdated', expect.any(Object));
      });

      test('should emit tokenRemoved event when token is removed', () => {
        tokenTracker.handleNewToken(defaultTokenData);
        const token = tokenTracker.getToken('test-mint');
        const removeSpy = jest.spyOn(tokenTracker, 'emit');
        
        tokenTracker.removeToken('test-mint');
        
        expect(removeSpy).toHaveBeenCalledWith('tokenRemoved', token);
        expect(tokenTracker.tokens.has('test-mint')).toBeFalsy();
      });
    });

    describe('getTokenStats', () => {
      test('should return correct stats for multiple tokens', () => {
        const tokens = [
          new Token({
            mint: 'test-mint-1',
            symbol: 'TEST1',
            marketCapSol: 100,
            vTokensInBondingCurve: 1000,
            vSolInBondingCurve: 100
          }, {
            priceManager: mockPriceManager,
            safetyChecker: mockSafetyChecker
          }),
          new Token({
            mint: 'test-mint-2',
            symbol: 'TEST2',
            marketCapSol: 200,
            vTokensInBondingCurve: 2000,
            vSolInBondingCurve: 200
          }, {
            priceManager: mockPriceManager,
            safetyChecker: mockSafetyChecker
          })
        ];

        tokens.forEach(token => tokenTracker.handleNewToken(token));
        
        const stats = tokenTracker.getTokenStats();
        expect(stats.totalTokens).toBe(2);
        expect(stats.activeTokens).toBe(2);
        expect(stats.deadTokens).toBe(0);
      });
    });
  });

  describe('WebSocket Event Handling', () => {
    test('handles newToken event from WebSocket', () => {
      const addSpy = jest.spyOn(tokenTracker, 'handleNewToken');
      
      mockWebSocketManager.emit('newToken', defaultTokenData);
      
      expect(addSpy).toHaveBeenCalledWith(defaultTokenData);
    });

    test('handles tokenTrade event from WebSocket', () => {
      tokenTracker.handleNewToken(defaultTokenData);
      
      const tradeData = {
        mint: 'test-mint',
        type: 'buy',
        amount: 100
      };
      
      mockWebSocketManager.emit('tokenTrade', tradeData);
      
      const trackedToken = tokenTracker.tokens.get('test-mint');
      expect(trackedToken.update).toHaveBeenCalledWith(tradeData);
    });
  });

  describe('Position Management', () => {
    test('attempts to open position when token becomes ready', () => {
      mockPositionManager.openPosition.mockReturnValue(true);
      tokenTracker.handleNewToken(defaultTokenData);
      
      expect(mockPositionManager.openPosition).toHaveBeenCalled();
    });

    test('does not open position when trading is disabled', () => {
      mockPositionManager.isTradingEnabled.mockReturnValue(false);
      tokenTracker.handleNewToken(defaultTokenData);
      
      expect(mockPositionManager.openPosition).not.toHaveBeenCalled();
    });

    test('handles failed position opening', () => {
      // Set up position manager to fail before creating token
      mockPositionManager.openPosition.mockReturnValue(false);
      mockPositionManager.isTradingEnabled.mockReturnValue(true);
      
      // Set up error spy before creating token
      const errorSpy = jest.spyOn(tokenTracker, 'emit');
      
      // Create token and add to tracker
      const token = new Token(defaultTokenData, {
        priceManager: mockPriceManager,
        safetyChecker: mockSafetyChecker
      });
      
      // Prevent automatic state check
      token.checkState = jest.fn();
      tokenTracker.handleNewToken(token);
      
      // Now trigger ready state
      token.setState(STATES.READY);
      
      // Verify position manager was called and error was emitted
      expect(mockPositionManager.openPosition).toHaveBeenCalled();
      const calls = mockPositionManager.openPosition.mock.calls;
      expect(calls.length).toBe(1);
      const [calledToken] = calls[0];
      expect(calledToken.mint).toBe(defaultTokenData.mint);
      expect(calledToken.symbol).toBe(defaultTokenData.symbol);
      
      expect(errorSpy).toHaveBeenCalledWith('error', {
        message: `Failed to open position for token ${defaultTokenData.symbol}`
      });
    });
  });
});
