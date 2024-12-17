const { expect } = require("chai");
const sinon = require("sinon");
const PositionManager = require("../src/core/position/PositionManager");
const Wallet = require("../src/utils/Wallet");
const TransactionSimulator = require("../src/utils/TransactionSimulator");
const config = require("../src/utils/config");

describe("PositionManager", () => {
  let positionManager;
  let wallet;
  let clock;
  let sandbox;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    sandbox = sinon.createSandbox();
    clock = sandbox.useFakeTimers();
    wallet = new Wallet(5.0); 
    positionManager = new PositionManager(wallet);
    
    // Stub transaction simulator methods for predictable tests
    sandbox.stub(positionManager.transactionSimulator, 'simulateTransactionDelay').resolves(100);
    sandbox.stub(positionManager.transactionSimulator, 'calculatePriceImpact').callsFake((size, price) => price * 1.005); // 0.5% slippage
  });

  afterEach(() => {
    process.env.NODE_ENV = undefined;
    sandbox.restore();
    positionManager.cleanup();
  });

  it("should initialize correctly", () => {
    expect(positionManager.stateManager).to.exist;
    expect(positionManager.wins).to.equal(0);
    expect(positionManager.losses).to.equal(0);
    expect(positionManager.transactionSimulator).to.be.instanceof(TransactionSimulator);
  });

  it("should open a position with simulated transaction delay and price impact", async () => {
    const result = await positionManager.openPosition("testMint", 1000, 30); 
    expect(result).to.be.true;
    
    const position = positionManager.stateManager.getPosition("testMint");
    expect(position).to.exist;
    expect(position.entryPrice).to.be.closeTo(1005, 0.01); 
    expect(wallet.balance).to.be.lessThan(5.0);
  });

  it("should not open a position if balance is insufficient", async () => {
    wallet = new Wallet(0.01);
    positionManager = new PositionManager(wallet);
    
    // Re-stub for new instance
    sandbox.stub(positionManager.transactionSimulator, 'simulateTransactionDelay').resolves(100);
    sandbox.stub(positionManager.transactionSimulator, 'calculatePriceImpact').callsFake((size, price) => price * 1.005);
    
    const result = await positionManager.openPosition("testMint", 1000, 30);
    expect(result).to.be.false;
    
    const position = positionManager.stateManager.getPosition("testMint");
    expect(position).to.be.undefined;
  });

  it("should close a position with simulated transaction delay and price impact", async () => {
    // First open a position
    await positionManager.openPosition("testMint", 1000, 30);
    
    // Then close it
    const result = await positionManager.closePosition("testMint", 1500);
    expect(result.success).to.be.true;
    expect(result.profitLoss).to.exist;
    expect(result.exitPrice).to.exist;
    
    const position = positionManager.stateManager.getPosition("testMint");
    expect(position).to.be.undefined;
  });

  it("should integrate with Wallet to update balance considering price impact", async () => {
    const initialBalance = wallet.balance;
    
    // Open position
    await positionManager.openPosition("testMint", 1000, 30);
    expect(wallet.balance).to.be.lessThan(initialBalance);
    
    // Close position with profit
    const result = await positionManager.closePosition("testMint", 1500);
    expect(result.success).to.be.true;
    expect(result.profitLoss).to.be.above(0);
    expect(wallet.balance).to.be.above(initialBalance);
  });

  it("should handle partial position closes with simulated execution", async () => {
    // Open position
    await positionManager.openPosition("testMint", 1000, 30);
    
    // Close half the position
    const result = await positionManager.closePosition("testMint", 1500, 0.5);
    expect(result.success).to.be.true;
    expect(result.portion).to.equal(0.5);
    
    const position = positionManager.stateManager.getPosition("testMint");
    expect(position).to.exist;
    expect(position.size).to.be.closeTo(15, 0.01); // Half of original 30
  });

  it("should track position metrics considering simulated prices", async () => {
    // Open position
    await positionManager.openPosition("testMint", 1000, 30);
    
    const position = positionManager.stateManager.getPosition("testMint");
    
    // Update position with new price
    await positionManager.updatePosition("testMint", 1200);
    expect(position.currentPrice).to.equal(1200);
    expect(position.maxUpside).to.be.above(0);
    expect(position.maxDrawdown).to.equal(0);
    
    // Update with lower price
    await positionManager.updatePosition("testMint", 900);
    expect(position.maxDrawdown).to.be.below(0);
  });

  it("should log transaction simulation metrics", async () => {
    const result = await positionManager.openPosition("testMint", 1000, 30);
    expect(result).to.be.true;
    
    const position = positionManager.stateManager.getPosition("testMint");
    expect(position.entryPrice).to.be.closeTo(1005, 0.01); // With 0.5% slippage
    expect(position.simulatedDelay).to.equal(100);
  });
});
