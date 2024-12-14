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
    tokenState.addTokenToState('mint1', 'heatingUp');
    expect(tokenState.heatingUp.has('mint1')).to.be.true;
    tokenState.removeTokenFromState('mint1', 'heatingUp');
    expect(tokenState.heatingUp.has('mint1')).to.be.false;
  });

  it('should handle state transitions correctly', () => {
    tokenState.addTokenToState('mint1', 'heatingUp');
    tokenState.transitionTokenState('mint1', 'heatingUp', 'firstPump');
    expect(tokenState.heatingUp.has('mint1')).to.be.false;
    expect(tokenState.firstPump.has('mint1')).to.be.true;
  });

  // Add more tests for TokenState methods
});
