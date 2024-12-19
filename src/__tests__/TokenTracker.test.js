const TokenTracker = require("../TokenTracker");
const Token = require("../Token");
const TokenStateManager = require("../TokenStateManager");
const { EventEmitter } = require("events");

// Mock Token class
jest.mock("../Token", () => {
  const { STATES } = jest.requireActual("../TokenStateManager");
  const { EventEmitter } = jest.requireActual("events");
  
  return function MockToken(data, deps) {
    const token = {
      ...data,
      stateManager: deps.stateManager || new MockStateManager(),
      safetyChecker: deps.safetyChecker,
      priceManager: deps.priceManager,
      lastTradeType: null,
      lastTradeAmount: null,
      lastTradeTime: null,
      tokenBalance: null,
      update: function(newData) {
        // Update core token data
        if (newData.vTokensInBondingCurve !== undefined) {
          this.vTokensInBondingCurve = newData.vTokensInBondingCurve;
        }
        if (newData.vSolInBondingCurve !== undefined) {
          this.vSolInBondingCurve = newData.vSolInBondingCurve;
        }
        if (newData.marketCapSol !== undefined) {
          this.marketCapSol = newData.marketCapSol;
        }
        if (newData.newTokenBalance !== undefined) {
          this.tokenBalance = newData.newTokenBalance;
        }

        // Track trade type
        if (newData.type === 'buy' || newData.type === 'sell') {
          this.lastTradeType = newData.type;
          this.lastTradeAmount = newData.tokenAmount;
          this.lastTradeTime = Date.now();
        }

        if (this.safetyChecker.isTokenSafe(this) && this.stateManager.getCurrentState() === STATES.NEW) {
          this.stateManager.transitionTo(STATES.READY);
        }

        // Emit update event
        this.emit('updated', {
          token: this,
          tradeType: newData.type,
          tradeAmount: newData.tokenAmount
        });
      },
      checkState: function() {
        const currentState = this.stateManager.getCurrentState();
        
        if (this.safetyChecker.isTokenSafe(this) && currentState === STATES.NEW) {
          this.stateManager.transitionTo(STATES.READY);
          this.emit("stateChanged", {
            token: this,
            from: currentState,
            to: STATES.READY
          });
          this.emit("readyForPosition", { token: this });
        }
      }
    };
    
    // Add EventEmitter functionality
    Object.setPrototypeOf(token, EventEmitter.prototype);
    EventEmitter.call(token);
    
    return token;
  };
});

// Mock dependencies
const mockPriceManager = {
  solToUSD: jest.fn((sol) => sol * 100)
};

const mockSafetyChecker = {
  isTokenSafe: jest.fn()
};

const mockPositionManager = {
  positions: new Map(),
  getPosition(mint) {
    return this.positions.get(mint);
  },
  isTradingEnabled: jest.fn(() => true),
  openPosition: jest.fn(() => true)
};

const mockWebSocketManager = new EventEmitter();
mockWebSocketManager.subscribeToToken = jest.fn();
mockWebSocketManager.unsubscribeFromToken = jest.fn();

// Mock StateManager
class MockStateManager {
  constructor(state = TokenStateManager.STATES.NEW) {
    this.state = state;
  }

  getCurrentState() {
    return this.state;
  }

  transitionTo(newState) {
    this.state = newState;
  }
}

describe("TokenTracker", () => {
  let tokenTracker;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    mockSafetyChecker.isTokenSafe.mockReset();
    mockPositionManager.isTradingEnabled.mockReset();
    mockPositionManager.openPosition.mockReset();
    mockWebSocketManager.subscribeToToken.mockReset();
    mockWebSocketManager.unsubscribeFromToken.mockReset();
    mockPriceManager.solToUSD.mockReset();

    // Set default mock implementations
    mockSafetyChecker.isTokenSafe.mockReturnValue(false);
    mockPositionManager.isTradingEnabled.mockReturnValue(true);
    mockPositionManager.openPosition.mockReturnValue(true);
    mockPriceManager.solToUSD.mockImplementation(sol => sol * 100);

    tokenTracker = new TokenTracker({
      safetyChecker: mockSafetyChecker,
      positionManager: mockPositionManager,
      priceManager: mockPriceManager,
      webSocketManager: mockWebSocketManager
    });
  });

  describe("Token Tracking and Events", () => {
    describe("handleNewToken", () => {
      it("should emit tokenAdded event when new token is added", (done) => {
        const newToken = {
          mint: "new-token-123",
          symbol: "NEW",
          marketCapSol: 1000,
          isSafe: true
        };

        tokenTracker.once("tokenAdded", (token) => {
          expect(token.mint).toBe(newToken.mint);
          done();
        });

        tokenTracker.handleNewToken(newToken);
      });

      it("should emit tokenUpdated event when existing token is updated", (done) => {
        const token = {
          mint: "token-123",
          symbol: "UPD",
          marketCapSol: 1000,
          isSafe: true
        };

        // First add the token
        tokenTracker.handleNewToken(token);

        // Update the token
        const updatedToken = {
          ...token,
          marketCapSol: 2000
        };

        tokenTracker.once("tokenUpdated", (token) => {
          expect(token.marketCapSol).toBe(2000);
          done();
        });

        tokenTracker.handleNewToken(updatedToken);
      });

      it("should emit tokenRemoved event when token is removed", (done) => {
        const token = {
          mint: "token-to-remove",
          symbol: "REM",
          marketCapSol: 1000,
          isSafe: true
        };

        // First add the token
        tokenTracker.handleNewToken(token);
        
        // Then set up the event listener
        tokenTracker.once("tokenRemoved", (removedToken) => {
          expect(removedToken.mint).toBe(token.mint);
          done();
        });

        // Finally remove the token
        process.nextTick(() => {
          tokenTracker.removeToken(token.mint);
        });
      }, 10000); // Increase timeout to 10 seconds
    });

    describe("getTokenStats", () => {
      test("should return correct stats for multiple tokens", () => {
        // Create tokens with different states via state manager
        const tokens = [
          {
            mint: 'test-mint-1',
            name: 'Test Token 1',
            symbol: 'TEST1',
            marketCapSol: 10, // $1000 USD
            vTokensInBondingCurve: 1000,
            vSolInBondingCurve: 100,
            stateManager: new MockStateManager(TokenStateManager.STATES.NEW)
          },
          {
            mint: 'test-mint-2',
            name: 'Test Token 2',
            symbol: 'TEST2',
            marketCapSol: 20, // $2000 USD
            vTokensInBondingCurve: 1000,
            vSolInBondingCurve: 100,
            stateManager: new MockStateManager(TokenStateManager.STATES.READY)
          },
          {
            mint: 'test-mint-3',
            name: 'Test Token 3',
            symbol: 'TEST3',
            marketCapSol: 30, // $3000 USD
            vTokensInBondingCurve: 1000,
            vSolInBondingCurve: 100,
            stateManager: new MockStateManager(TokenStateManager.STATES.DEAD)
          }
        ];

        // Add tokens
        tokens.forEach(token => {
          tokenTracker.tokens.set(token.mint, token);
        });

        // Get stats
        const stats = tokenTracker.getTokenStats();

        // Price manager converts 1 SOL to 100 USD
        expect(stats.total).toBe(3);
        expect(stats.new).toBe(1);
        expect(stats.ready).toBe(1);
        expect(stats.dead).toBe(1);
        expect(stats.avgMarketCapUSD).toBe(2000); // (10 + 20 + 30) / 3 * 100
      });
    });
  });

  describe('WebSocket Event Handling', () => {
    test('handles newToken event from WebSocket', () => {
      const tokenData = {
        mint: 'new-token-mint',
        name: 'New Token',
        symbol: 'NEW',
        marketCapSol: 100,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 100
      };

      // Simulate WebSocket emitting a newToken event
      tokenTracker.webSocketManager.emit('newToken', tokenData);

      // Check if token was added
      const token = tokenTracker.getToken('new-token-mint');
      expect(token).toBeDefined();
      expect(token.mint).toBe('new-token-mint');
      expect(token.name).toBe('New Token');
    });

    test('handles tokenTrade event from WebSocket', () => {
      // First add a token
      const tokenData = {
        mint: 'trade-test-mint',
        name: 'Trade Test Token',
        symbol: 'TTT',
        marketCapSol: 100,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 100
      };
      tokenTracker.handleNewToken(tokenData);

      const tradeData = {
        mint: 'trade-test-mint',
        type: 'buy',
        tokenAmount: 100,
        newTokenBalance: 500,
        vTokensInBondingCurve: 1100,
        vSolInBondingCurve: 150,
        marketCapSol: 150
      };

      // Set up spy for tokenUpdated event
      const tokenUpdatedSpy = jest.fn();
      tokenTracker.on('tokenUpdated', tokenUpdatedSpy);

      // Simulate WebSocket emitting a tokenTrade event
      tokenTracker.webSocketManager.emit('tokenTrade', tradeData);

      // Get the updated token
      const token = tokenTracker.getToken('trade-test-mint');
      
      // Verify token was updated
      expect(token.vTokensInBondingCurve).toBe(1100);
      expect(token.vSolInBondingCurve).toBe(150);
      expect(token.marketCapSol).toBe(150);
      expect(token.tokenBalance).toBe(500);
      expect(token.lastTradeType).toBe('buy');
      expect(token.lastTradeAmount).toBe(100);

      // Verify tokenUpdated event was emitted
      expect(tokenUpdatedSpy).toHaveBeenCalled();
    });

    test('ignores tokenTrade event for unknown token', () => {
      const tradeData = {
        mint: 'unknown-token-mint',
        type: 'buy',
        tokenAmount: 100,
        vTokensInBondingCurve: 1100,
        vSolInBondingCurve: 150,
        marketCapSol: 150
      };

      // Set up spy for tokenUpdated event
      const tokenUpdatedSpy = jest.fn();
      tokenTracker.on('tokenUpdated', tokenUpdatedSpy);

      // Simulate WebSocket emitting a tokenTrade event for unknown token
      tokenTracker.webSocketManager.emit('tokenTrade', tradeData);

      // Verify no token was added
      expect(tokenTracker.getToken('unknown-token-mint')).toBeUndefined();
      
      // Verify no tokenUpdated event was emitted
      expect(tokenUpdatedSpy).not.toHaveBeenCalled();
    });
  });

  describe('Position Management', () => {
    test('attempts to open position when token becomes ready', () => {
      const tokenData = {
        mint: 'test-mint',
        name: 'Test Token',
        symbol: 'TEST',
        marketCapSol: 100,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 100
      };

      // Mock position manager methods
      mockPositionManager.isTradingEnabled.mockReturnValue(true);
      mockPositionManager.openPosition.mockReturnValue(true);

      // Set up spy for positionOpened event
      const positionOpenedSpy = jest.fn();
      tokenTracker.on('positionOpened', positionOpenedSpy);

      // Add token and trigger readyForPosition event
      tokenTracker.handleNewToken(tokenData);
      const token = tokenTracker.getToken('test-mint');
      token.emit('readyForPosition', { token });

      // Verify position was opened
      expect(mockPositionManager.openPosition).toHaveBeenCalledWith(token);
      expect(positionOpenedSpy).toHaveBeenCalledWith({ token });
    });

    test('does not open position when trading is disabled', () => {
      const tokenData = {
        mint: 'test-mint-2',
        name: 'Test Token 2',
        symbol: 'TEST2',
        marketCapSol: 100,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 100
      };

      // Mock trading as disabled
      mockPositionManager.isTradingEnabled.mockReturnValue(false);

      // Set up spy for positionOpened event
      const positionOpenedSpy = jest.fn();
      tokenTracker.on('positionOpened', positionOpenedSpy);

      // Add token and trigger readyForPosition event
      tokenTracker.handleNewToken(tokenData);
      const token = tokenTracker.getToken('test-mint-2');
      token.emit('readyForPosition', { token });

      // Verify no position was opened
      expect(mockPositionManager.openPosition).not.toHaveBeenCalled();
      expect(positionOpenedSpy).not.toHaveBeenCalled();
    });

    test('handles failed position opening', () => {
      const tokenData = {
        mint: 'test-mint-3',
        name: 'Test Token 3',
        symbol: 'TEST3',
        marketCapSol: 100,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 100
      };

      // Mock trading as enabled but position opening as failed
      mockPositionManager.isTradingEnabled.mockReturnValue(true);
      mockPositionManager.openPosition.mockReturnValue(false);

      // Set up spy for positionOpened event
      const positionOpenedSpy = jest.fn();
      tokenTracker.on('positionOpened', positionOpenedSpy);

      // Add token and trigger readyForPosition event
      tokenTracker.handleNewToken(tokenData);
      const token = tokenTracker.getToken('test-mint-3');
      token.emit('readyForPosition', { token });

      // Verify position opening was attempted but failed
      expect(mockPositionManager.openPosition).toHaveBeenCalledWith(token);
      expect(positionOpenedSpy).not.toHaveBeenCalled();
    });
  });
});
