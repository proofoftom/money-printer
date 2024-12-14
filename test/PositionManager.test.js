const { expect } = require("chai");
const PositionManager = require("../src/PositionManager");
const Wallet = require("../src/Wallet");

describe("PositionManager", () => {
  let positionManager;
  let wallet;

  beforeEach(() => {
    wallet = new Wallet(1.0);
    positionManager = new PositionManager(wallet);
  });

  it("should initialize correctly", () => {
    expect(positionManager.positions).to.be.instanceof(Map);
    expect(positionManager.positions.size).to.equal(0);
    expect(positionManager.wins).to.equal(0);
    expect(positionManager.losses).to.equal(0);
  });

  it("should open a position and deduct balance", () => {
    const result = positionManager.openPosition("testMint", 100);
    expect(result).to.be.true;
    expect(positionManager.positions.size).to.equal(1);
    expect(wallet.balance).to.be.lessThan(1.0);
  });

  it("should not open a position if balance is insufficient", () => {
    wallet = new Wallet(0.01);
    positionManager = new PositionManager(wallet);
    const result = positionManager.openPosition("testMint", 100);
    expect(result).to.be.false;
    expect(positionManager.positions.size).to.equal(0);
  });

  it("should close a position and calculate profit/loss", () => {
    positionManager.openPosition("testMint", 100);
    const result = positionManager.closePosition("testMint", 110);
    expect(result).to.have.property('profitLoss');
    expect(result.profitLoss).to.be.greaterThan(0);
    expect(positionManager.positions.size).to.equal(0);
    expect(positionManager.wins).to.equal(1);
    expect(positionManager.losses).to.equal(0);
  });

  it("should integrate with Wallet to update balance", () => {
    positionManager.openPosition("testMint", 100);
    const result = positionManager.closePosition("testMint", 110);
    expect(result).to.have.property('profitLoss');
    expect(wallet.balance).to.be.greaterThan(1.0);
  });

  it("should integrate with Wallet to record trades", () => {
    positionManager.openPosition("testMint", 100);
    const result = positionManager.closePosition("testMint", 110);
    expect(result).to.have.property('profitLoss');
    expect(wallet.totalPnL).to.be.greaterThan(0);
  });
});
