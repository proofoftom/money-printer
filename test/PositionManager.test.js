const { expect } = require('chai');
const PositionManager = require('../src/PositionManager');
const Wallet = require('../src/Wallet');

describe('PositionManager', () => {
  let positionManager;

  beforeEach(() => {
    const wallet = new Wallet(1); // Starting balance of 1 SOL
    positionManager = new PositionManager(wallet);
  });

  it('should initialize correctly', () => {
    expect(positionManager).to.be.an('object');
  });

  it('should open a position and deduct balance', () => {
    positionManager.openPosition('mint1', 40); // Equivalent to $9000 USD marketCap
    expect(positionManager.wallet.balance).to.be.closeTo(0.2, 0.01); // Reflects 2% position size
    expect(positionManager.positions.has('mint1')).to.be.true;
  });

  it('should not open a position if balance is insufficient', () => {
    positionManager.wallet.balance = 0.01;
    const result = positionManager.openPosition('mint2', 40); // Equivalent to $9000 USD marketCap
    expect(result).to.be.false;
    expect(positionManager.wallet.balance).to.equal(0.01);
    expect(positionManager.positions.has('mint2')).to.be.false;
  });

  it('should close a position and calculate profit/loss', () => {
    positionManager.openPosition('mint1', 40); // Equivalent to $9000 USD marketCap
    const pnl = positionManager.closePosition('mint1', 44); // Equivalent to $9900 USD exitPrice
    expect(pnl).to.be.closeTo(0.08, 0.0001); // Reflects 2% position size
    expect(positionManager.wallet.balance).to.be.closeTo(1.08, 0.01);
    expect(positionManager.positions.has('mint1')).to.be.false;
  });

  it('should integrate with Wallet to update balance', () => {
    positionManager.openPosition('mint1', 40); // Equivalent to $9000 USD marketCap
    positionManager.closePosition('mint1', 44); // Equivalent to $9900 USD exitPrice
    expect(positionManager.wallet.balance).to.be.closeTo(1.08, 0.01);
  });

  it('should integrate with Wallet to record trades', () => {
    positionManager.openPosition('mint1', 40); // Equivalent to $9000 USD marketCap
    positionManager.closePosition('mint1', 44); // Equivalent to $9900 USD exitPrice
    const stats = positionManager.wallet.getStatistics();
    expect(stats.wins).to.equal(1);
    expect(stats.losses).to.equal(0);
    expect(stats.totalPnL).to.be.closeTo(0.08, 0.0001); // Reflects 2% position size
  });

  // Add more tests for PositionManager methods
});
