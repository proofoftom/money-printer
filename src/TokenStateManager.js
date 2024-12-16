const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const config = require('./config');

class TokenStateManager extends EventEmitter {
  constructor() {
    super();
    this.tokens = new Map();
    this.stateFile = path.join(process.cwd(), 'data', 'token_states.json');
    this.ensureDataDirectory();
    
    // Clear token states on startup if configured
    if (config.TOKEN_MANAGER && config.TOKEN_MANAGER.CLEAR_ON_STARTUP) {
      this.clearTokenStates();
    }
    
    this.loadTokenStates();
    
    // Periodic state persistence
    const saveInterval = (config.TOKEN_MANAGER && config.TOKEN_MANAGER.SAVE_INTERVAL) || 60000;
    setInterval(() => this.saveTokenStates(), saveInterval);
  }

  ensureDataDirectory() {
    const dataDir = path.dirname(this.stateFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  loadTokenStates() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const data = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
        data.tokens.forEach(tokenData => {
          this.tokens.set(tokenData.mint, {
            mint: tokenData.mint,
            state: tokenData.state,
            stateEnteredAt: new Date(tokenData.stateEnteredAt),
            previousState: tokenData.previousState,
            metrics: tokenData.metrics || {}
          });
        });
        console.log(`Loaded ${this.tokens.size} token states from state file`);
      }
    } catch (error) {
      console.error('Error loading token states:', error);
    }
  }

  saveTokenStates() {
    try {
      const data = {
        tokens: Array.from(this.tokens.values()),
        lastSaved: new Date().toISOString()
      };
      fs.writeFileSync(this.stateFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error saving token states:', error);
    }
  }

  addToken(token) {
    const tokenState = {
      mint: token.mint,
      state: 'minted',
      stateEnteredAt: new Date(),
      previousState: null,
      metrics: {}
    };
    
    this.tokens.set(token.mint, tokenState);
    this.emit('tokenStateChanged', {
      token,
      from: null,
      to: 'minted',
      metrics: {}
    });
    
    // Automatically transition to heating up state after minting
    this.transitionToHeatingUp(token);
    
    this.saveTokenStates();
    return tokenState;
  }

  transitionToHeatingUp(token) {
    const tokenState = this.tokens.get(token.mint);
    if (!tokenState) return null;

    const previousState = tokenState.state;
    tokenState.previousState = previousState;
    tokenState.state = 'heatingUp';
    tokenState.stateEnteredAt = new Date();

    this.emit('tokenStateChanged', {
      token,
      from: previousState,
      to: 'heatingUp',
      metrics: tokenState.metrics
    });

    return tokenState;
  }

  updateTokenState(token, newState, metrics = {}) {
    const tokenState = this.tokens.get(token.mint);
    if (!tokenState) return null;

    const previousState = tokenState.state;
    tokenState.previousState = previousState;
    tokenState.state = newState;
    tokenState.stateEnteredAt = new Date();
    tokenState.metrics = { ...tokenState.metrics, ...metrics };

    this.emit('tokenStateChanged', {
      token,
      from: previousState,
      to: newState,
      metrics: tokenState.metrics
    });

    this.saveTokenStates();
    return tokenState;
  }

  getTokenState(mint) {
    return this.tokens.get(mint);
  }

  getTokensInState(state) {
    return Array.from(this.tokens.values())
      .filter(tokenState => tokenState.state === state);
  }

  clearTokenStates() {
    this.tokens.clear();
    if (fs.existsSync(this.stateFile)) {
      fs.unlinkSync(this.stateFile);
    }
  }
}

module.exports = TokenStateManager;
