// TokenState component

class TokenState {
  constructor() {
    this.newlyCreated = new Set();
    this.heatingUp = new Set();
    this.inFirstPump = new Set();
    this.inFirstDrawdown = new Set();
    this.inDrawdown = new Set();
    this.unsafeRecovery = new Set();
    this.inPosition = new Set();
    console.log("TokenState initialized");
  }

  // Add methods for managing token states
  addTokenToState(mint, state) {
    if (this[state]) {
      this[state].add(mint);
      console.log(`Token ${mint} added to ${state}`);
    } else {
      console.error(`State ${state} does not exist`);
    }
  }

  removeTokenFromState(mint, state) {
    if (this[state]) {
      this[state].delete(mint);
      console.log(`Token ${mint} removed from ${state}`);
    } else {
      console.error(`State ${state} does not exist`);
    }
  }

  transitionTokenState(mint, fromState, toState) {
    this.removeTokenFromState(mint, fromState);
    this.addTokenToState(mint, toState);
    console.log(`Token ${mint} transitioned from ${fromState} to ${toState}`);
  }
}

module.exports = TokenState;
