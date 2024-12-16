const { expect } = require('chai');
const TokenStateManager = require('../src/TokenStateManager');
const Token = require('../src/Token');
const config = require('../src/config');

describe('TokenStateManager', () => {
  let stateManager;
  let mockToken;
  let mockConfig;

  beforeEach(() => {
    // Mock config for testing
    mockConfig = {
      TOKEN_MANAGER: {
        HEATING_PERIOD: 1000, // 1 second for faster testing
        VOLUME_THRESHOLD: 1,
        DRAWDOWN_THRESHOLD: 0.7,
        RECOVERY_THRESHOLD: 0.5
      }
    };

    // Create mock token
    mockToken = {
      mint: 'test-mint-123',
      symbol: 'TEST',
      volume: 2,
      currentPrice: 1.0,
      marketCapSol: 1000,
      getMarketConditions: () => ({
        trend: 'neutral',
        strength: 0.5
      }),
      getVolumeProfile: () => ({
        trend: 'stable',
        dropPercentage: 0
      })
    };

    stateManager = new TokenStateManager();
  });

  describe('Token State Lifecycle', () => {
    it('should initialize token in minted state', () => {
      const state = stateManager.addToken(mockToken);
      expect(state.state).to.equal('minted');
      expect(state.previousState).to.be.null;
    });

    it('should transition to heating up state after minting', (done) => {
      stateManager.addToken(mockToken);
      setTimeout(() => {
        const state = stateManager.getTokenState(mockToken.mint);
        expect(state.state).to.equal('heatingUp');
        done();
      }, 10); // Give it a small delay to transition
    });

    it('should transition to active state after heating period with sufficient volume', (done) => {
      mockToken.volume = 2; // Above volume threshold
      stateManager.addToken(mockToken);
      
      // Wait for heating period
      setTimeout(() => {
        stateManager.updateTokenState(mockToken, 'active', {
          marketConditions: mockToken.getMarketConditions(),
          volumeProfile: mockToken.getVolumeProfile(),
          currentPrice: mockToken.currentPrice,
          marketCapSol: mockToken.marketCapSol
        });
        
        const state = stateManager.getTokenState(mockToken.mint);
        expect(state.state).to.equal('active');
        done();
      }, mockConfig.TOKEN_MANAGER.HEATING_PERIOD + 100);
    });

    it('should not transition to active state if volume is insufficient', (done) => {
      mockToken.volume = 0.5; // Below volume threshold
      stateManager.addToken(mockToken);
      
      setTimeout(() => {
        const state = stateManager.getTokenState(mockToken.mint);
        expect(state.state).to.equal('heatingUp');
        done();
      }, mockConfig.TOKEN_MANAGER.HEATING_PERIOD + 100);
    });
  });

  describe('State Transitions', () => {
    it('should transition to drawdown state when market conditions are bearish', (done) => {
      stateManager.addToken(mockToken);
      
      setTimeout(() => {
        const initialState = stateManager.getTokenState(mockToken.mint);
        expect(initialState.state).to.equal('heatingUp');

        // Update market conditions to trigger drawdown
        mockToken.getMarketConditions = () => ({
          trend: 'bearish',
          strength: 0.8 // Above DRAWDOWN_THRESHOLD
        });

        stateManager.updateTokenState(mockToken, 'drawdown', {
          marketConditions: mockToken.getMarketConditions(),
          volumeProfile: mockToken.getVolumeProfile()
        });

        const state = stateManager.getTokenState(mockToken.mint);
        expect(state.state).to.equal('drawdown');
        expect(state.previousState).to.equal('heatingUp');
        done();
      }, 10);
    });

    it('should recover from drawdown when market conditions improve', () => {
      // Start in drawdown state
      stateManager.addToken(mockToken);
      stateManager.updateTokenState(mockToken, 'drawdown');

      // Update market conditions to trigger recovery
      mockToken.getMarketConditions = () => ({
        trend: 'bullish',
        strength: 0.6 // Above RECOVERY_THRESHOLD
      });

      stateManager.updateTokenState(mockToken, 'active', {
        marketConditions: mockToken.getMarketConditions(),
        volumeProfile: mockToken.getVolumeProfile()
      });

      const state = stateManager.getTokenState(mockToken.mint);
      expect(state.state).to.equal('active');
      expect(state.previousState).to.equal('drawdown');
    });
  });

  describe('State Persistence', () => {
    it('should save and load token states', () => {
      stateManager.addToken(mockToken);
      stateManager.saveTokenStates();

      const newStateManager = new TokenStateManager();
      newStateManager.loadTokenStates();

      const state = newStateManager.getTokenState(mockToken.mint);
      expect(state).to.exist;
      expect(state.mint).to.equal(mockToken.mint);
    });

    it('should maintain state history through save/load cycle', () => {
      stateManager.addToken(mockToken);
      stateManager.updateTokenState(mockToken, 'active');
      stateManager.updateTokenState(mockToken, 'drawdown');
      stateManager.saveTokenStates();

      const newStateManager = new TokenStateManager();
      newStateManager.loadTokenStates();

      const state = newStateManager.getTokenState(mockToken.mint);
      expect(state.state).to.equal('drawdown');
      expect(state.previousState).to.equal('active');
    });
  });

  describe('Event Emission', () => {
    it('should emit events on state changes', (done) => {
      let eventCount = 0;
      stateManager.on('tokenStateChanged', ({ token, from, to }) => {
        if (eventCount === 0) {
          expect(token.mint).to.equal(mockToken.mint);
          expect(from).to.be.null;
          expect(to).to.equal('minted');
          eventCount++;
        } else if (eventCount === 1) {
          expect(token.mint).to.equal(mockToken.mint);
          expect(from).to.equal('minted');
          expect(to).to.equal('heatingUp');
          done();
        }
      });

      stateManager.addToken(mockToken);
    });

    it('should include metrics in state change events', (done) => {
      const metrics = {
        marketConditions: mockToken.getMarketConditions(),
        volumeProfile: mockToken.getVolumeProfile(),
        currentPrice: mockToken.currentPrice,
        marketCapSol: mockToken.marketCapSol
      };

      stateManager.on('tokenStateChanged', ({ token, metrics: eventMetrics }) => {
        if (token.state === 'active') {
          expect(eventMetrics).to.deep.equal(metrics);
          done();
        }
      });

      stateManager.addToken(mockToken);
      setTimeout(() => {
        stateManager.updateTokenState(mockToken, 'active', metrics);
      }, 10);
    });
  });
});
