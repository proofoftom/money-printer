const { expect } = require('chai');
const Wallet = require('../src/Wallet');

describe('Wallet', () => {
  let wallet;

  beforeEach(() => {
    wallet = new Wallet(1);
  });

  it('should initialize with the correct balance', () => {
    expect(wallet.balance).to.equal(1);
  });

  it('should update balance correctly', () => {
    wallet.updateBalance(0.5);
    expect(wallet.balance).to.equal(1.5);
    wallet.updateBalance(-0.5);
    expect(wallet.balance).to.equal(1);
  });

  it('should record a trade', () => {
    wallet.recordTrade(0.1);
    expect(wallet.totalPnL).to.equal(0.1);
    wallet.recordTrade(-0.1);
    expect(wallet.totalPnL).to.equal(0);
  });

  it('should return correct statistics', () => {
    wallet.recordTrade(0.1);
    wallet.recordTrade(-0.05);
    const stats = wallet.getStatistics();
    expect(stats.balance).to.equal(1);
    expect(stats.totalPnL).to.equal(0.05);
  });
});
