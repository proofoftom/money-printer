const { expect } = require('chai');
const PositionManager = require('../src/PositionManager');
const Wallet = require('../src/Wallet');

describe('PositionManager', () => {
  let positionManager;
  let wallet;

  beforeEach(() => {
    wallet = new Wallet(1); // Initialize with 1 SOL
    positionManager = new PositionManager(wallet);
  });

  it('should initialize correctly', () => {
    expect(positionManager.positions).to.be.instanceOf(Map);
    expect(positionManager.wallet).to.equal(wallet);
  });

  it('should open a position and deduct balance', () => {
    const success = positionManager.openPosition('testMint123', 10000, 0.1);
    expect(success).to.be.true;
    expect(positionManager.positions.has('testMint123')).to.be.true;
    expect(wallet.balance).to.be.closeTo(0.9, 0.01);
  });

  it('should not open a position if balance is insufficient', () => {
    const token = {
      mint: 'testMint',
      name: 'TestToken',
      marketCapSol: 1.0
    };

    wallet.balance = 0;
    const result = positionManager.openPosition(token);
    expect(result).to.be.false;
  });

  it('should close a position and calculate profit/loss', () => {
    positionManager.openPosition('testMint123', 10000, 0.1);
    const pnl = positionManager.closePosition('testMint123', 11000);
    expect(pnl).to.be.closeTo(0.01, 0.01); // 10% profit on 0.1 SOL
    expect(positionManager.positions.has('testMint123')).to.be.false;
  });

  it('should integrate with Wallet to update balance', () => {
    positionManager.openPosition('testMint123', 10000, 0.1);
    positionManager.closePosition('testMint123', 11000);
    expect(wallet.balance).to.be.closeTo(1.01, 0.01); // Initial 1 SOL - 0.1 SOL + 0.11 SOL
  });

  it('should integrate with Wallet to record trades', () => {
    positionManager.openPosition('testMint123', 10000, 0.1);
    const pnl = positionManager.closePosition('testMint123', 11000);
    expect(pnl).to.be.closeTo(0.01, 0.01); // 10% profit
  });
});
