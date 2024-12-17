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
    sandbox = sinon.createSandbox();
    clock = sandbox.useFakeTimers();
    wallet = new Wallet(5.0); 
    positionManager = new PositionManager(wallet);
    
    // Stub transaction simulator methods for predictable tests
    sandbox.stub(positionManager.transactionSimulator, 'simulateTransactionDelay').resolves(100);
    sandbox.stub(positionManager.transactionSimulator, 'calculatePriceImpact').callsFake((size, price) => price * 1.005); // 0.5% slippage
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should initialize correctly", () => {
    expect(positionManager.positions).to.be.instanceof(Map);
    expect(positionManager.positions.size).to.equal(0);
    expect(positionManager.wins).to.equal(0);
    expect(positionManager.losses).to.equal(0);
    expect(positionManager.transactionSimulator).to.be.instanceof(TransactionSimulator);
  });

  it("should open a position with simulated transaction delay and price impact", async () => {
    const result = await positionManager.openPosition("testMint", 1000, 30); 
    expect(result).to.be.true;
    expect(positionManager.positions.size).to.equal(1);
    expect(wallet.balance).to.be.lessThan(5.0);

    const position = positionManager.positions.get("testMint");
    expect(position.entryPrice).to.be.closeTo(1005, 0.01); 
    expect(position.simulatedDelay).to.equal(100);
  });

  it("should not open a position if balance is insufficient", async () => {
    wallet = new Wallet(0.01);
    positionManager = new PositionManager(wallet);
    const result = await positionManager.openPosition("testMint", 1000, 30); 
    expect(result).to.be.false;
    expect(positionManager.positions.size).to.equal(0);
  });

  it("should close a position with simulated transaction delay and price impact", async () => {
    await positionManager.openPosition("testMint", 1000, 30); 
    const result = await positionManager.closePosition("testMint", 1100); 
    
    expect(result).to.have.property('profitLoss');
    expect(result.executionPrice).to.be.closeTo(1105.5, 0.01); 
    expect(result.intendedExitPrice).to.equal(1100);
    expect(result.transactionDelay).to.equal(100);
    expect(result.priceImpact).to.be.closeTo(0.5, 0.01);
    expect(positionManager.positions.size).to.equal(0);
    expect(positionManager.wins).to.equal(1);
    expect(positionManager.losses).to.equal(0);
  });

  it("should integrate with Wallet to update balance considering price impact", async () => {
    await positionManager.openPosition("testMint", 1000, 30); 
    const result = await positionManager.closePosition("testMint", 1100); 
    expect(result).to.have.property('profitLoss');
    expect(wallet.balance).to.be.greaterThan(5.0);
  });

  it("should handle partial position closes with simulated execution", async () => {
    await positionManager.openPosition("testMint", 1000, 30); 
    const result = await positionManager.closePosition("testMint", 1100, 0.5); 
    
    expect(result.portion).to.equal(0.5);
    expect(result.remainingSize).to.equal(0.5);
    expect(result.executionPrice).to.be.closeTo(1105.5, 0.01); 
    expect(result.transactionDelay).to.equal(100);
    expect(positionManager.positions.get("testMint")).to.not.be.null;
  });

  it("should track position metrics considering simulated prices", async () => {
    await positionManager.openPosition("testMint", 1000, 30); 
    
    // Update position with various prices
    await positionManager.updatePosition("testMint", 1200);
    await positionManager.updatePosition("testMint", 900);
    await positionManager.updatePosition("testMint", 1100);
    
    const result = await positionManager.closePosition("testMint", 1100);
    
    expect(result.maxUpside).to.be.closeTo(19.4, 0.1); 
    expect(result.maxDrawdown).to.be.closeTo(25, 0.1); 
  });

  it("should log transaction simulation metrics", async () => {
    await positionManager.openPosition("testMint", 1000, 30); 
    const result = await positionManager.closePosition("testMint", 1100); 
    
    expect(result).to.have.property('transactionDelay');
    expect(result).to.have.property('priceImpact');
    expect(result).to.have.property('executionPrice');
  });
});
