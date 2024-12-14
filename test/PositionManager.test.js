const { expect } = require("chai");
const PositionManager = require("../src/PositionManager");
const Wallet = require("../src/Wallet");

describe("PositionManager", () => {
  let positionManager;

  beforeEach(() => {
    const wallet = new Wallet(1); // Starting balance of 1 SOL
    positionManager = new PositionManager(wallet);
  });

  it("should initialize correctly", () => {
    expect(positionManager).to.be.an("object");
  });

  it("should open a position and deduct balance", () => {
    positionManager.openPosition("mint1", 40); // MarketCap value
    expect(positionManager.wallet.balance).to.be.closeTo(0.9, 0.01); // Reflects 0.1 SOL position size
    expect(positionManager.positions.has("mint1")).to.be.true;
  });

  it("should not open a position if balance is insufficient", () => {
    positionManager.wallet.balance = 0.05;
    const result = positionManager.openPosition("mint2", 40); // MarketCap value
    expect(result).to.be.false;
    expect(positionManager.wallet.balance).to.equal(0.05);
    expect(positionManager.positions.has("mint2")).to.be.false;
  });

  it("should close a position and calculate profit/loss", () => {
    positionManager.openPosition("mint1", 40); // MarketCap value
    const pnl = positionManager.closePosition("mint1", 44); // ExitPrice value
    expect(pnl).to.be.closeTo(0.4, 0.01); // Reflects correct profit/loss calculation
    expect(positionManager.wallet.balance).to.be.closeTo(1.4, 0.01);
    expect(positionManager.positions.has("mint1")).to.be.false;
    expect(positionManager.wins).to.equal(1); // Check win count
    expect(positionManager.losses).to.equal(0); // Check loss count
  });

  it("should integrate with Wallet to update balance", () => {
    positionManager.openPosition("mint1", 40); // MarketCap value
    positionManager.closePosition("mint1", 44); // ExitPrice value
    expect(positionManager.wallet.balance).to.be.closeTo(1.4, 0.01);
    expect(positionManager.wins).to.equal(1); // Check win count
    expect(positionManager.losses).to.equal(0); // Check loss count
  });

  it("should integrate with Wallet to record trades", () => {
    positionManager.openPosition("mint1", 40); // MarketCap value
    positionManager.closePosition("mint1", 44); // ExitPrice value
    const stats = positionManager.wallet.getStatistics();
    expect(positionManager.wins).to.equal(1);
    expect(positionManager.losses).to.equal(0);
    expect(stats.totalPnL).to.be.closeTo(0.4, 0.01); // Reflects correct profit/loss calculation
  });

  // Add more tests for PositionManager methods
});
