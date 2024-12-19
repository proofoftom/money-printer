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
      }
    };
    
    // Add EventEmitter functionality
    Object.setPrototypeOf(token, EventEmitter.prototype);
    EventEmitter.call(token);
    
    return token;
  };
});

class MockSafetyChecker {
  isTokenSafe(token) {
    return token.isSafe;
  }
}

class MockPriceManager {
  solToUSD(amount) {
    return amount * 100;
  }
}

class MockPositionManager extends EventEmitter {
  constructor() {
    super();
    this.positions = new Map();
  }

  getPosition(mint) {
    return this.positions.get(mint);
  }
}

class MockWebSocketManager extends EventEmitter {
  constructor() {
    super();
  }
  
  unsubscribeFromToken() {}
  subscribeToToken() {}
}

class MockStateManager {
  constructor(initialState = TokenStateManager.STATES.NEW) {
    this.state = initialState;
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
  let mockSafetyChecker;
  let mockPriceManager;
  let mockPositionManager;
  let mockWebSocketManager;

  beforeEach(() => {
    mockSafetyChecker = new MockSafetyChecker();
    mockPriceManager = new MockPriceManager();
    mockPositionManager = new MockPositionManager();
    mockWebSocketManager = new MockWebSocketManager();
    
    tokenTracker = new TokenTracker({
      safetyChecker: mockSafetyChecker,
      priceManager: mockPriceManager,
      positionManager: mockPositionManager,
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
      it("should return correct stats for multiple tokens", () => {
        const tokens = [
          {
            mint: "token1",
            symbol: "TK1",
            marketCapSol: 1000,
            isSafe: true
          },
          {
            mint: "token2",
            symbol: "TK2",
            marketCapSol: 2000,
            isSafe: true
          },
          {
            mint: "token3",
            symbol: "TK3",
            marketCapSol: 3000,
            isSafe: false
          }
        ];

        // Add tokens with different states
        tokenTracker.handleNewToken(tokens[0]); // Will be NEW
        
        // Set token2 to READY
        tokenTracker.handleNewToken(tokens[1]);
        const token2 = tokenTracker.getToken(tokens[1].mint);
        token2.stateManager.transitionTo(TokenStateManager.STATES.READY);
        
        // Set token3 to DEAD
        tokenTracker.handleNewToken(tokens[2]);
        const token3 = tokenTracker.getToken(tokens[2].mint);
        token3.stateManager.transitionTo(TokenStateManager.STATES.DEAD);

        const stats = tokenTracker.getTokenStats();

        expect(stats.total).toBe(3);
        expect(stats.new).toBe(1);
        expect(stats.ready).toBe(1);
        expect(stats.dead).toBe(1);
        expect(stats.avgMarketCapUSD).toBe(200000); // (1000 + 2000 + 3000) / 3 * 100
        expect(stats.totalMarketCapUSD).toBe(600000); // (1000 + 2000 + 3000) * 100
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
});
