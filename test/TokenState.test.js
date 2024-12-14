const { expect } = require('chai');
const TokenState = require('../src/TokenState');

describe('TokenState', () => {
  let tokenState;

  beforeEach(() => {
    tokenState = new TokenState();
  });

  it('should initialize correctly', () => {
    expect(tokenState).to.be.an('object');
  });

  it('should add and remove tokens from states', () => {
    // Simulate adding and removing tokens from states
    tokenState.addTokenToState('mint', 'heatingUp');
    expect(tokenState.heatingUp).to.include('mint');
    tokenState.removeTokenFromState('mint', 'heatingUp');
    expect(tokenState.heatingUp).to.not.include('mint');
  });

  it('should handle state transitions correctly', () => {
    // Simulate state transitions and verify consistency
    tokenState.addTokenToState('mint', 'heatingUp');
    tokenState.transitionTokenState('mint', 'heatingUp', 'pumping');
    expect(tokenState.pumping).to.include('mint');
    expect(tokenState.heatingUp).to.not.include('mint');
  });

  // Add more tests for TokenState methods
});
