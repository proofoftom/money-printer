// Token state management
const STATES = {
  NEW: "new",       // Just created
  READY: "ready",   // Ready for position
  DEAD: "dead",     // Token inactive/done
};

class TokenStateManager {
  constructor() {
    this.state = STATES.NEW;
  }

  getCurrentState() {
    return this.state;
  }

  transitionTo(newState) {
    if (!Object.values(STATES).includes(newState)) {
      return false;
    }

    const oldState = this.state;
    this.state = newState;
    
    return {
      success: true,
      from: oldState,
      to: newState
    };
  }

  setState(newState) {
    return this.transitionTo(newState);
  }
}

module.exports = {
  STATES,
  TokenStateManager
};
