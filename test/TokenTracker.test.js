const { expect } = require("chai");
const sinon = require("sinon");
const TokenTracker = require("../src/TokenTracker");
const Token = require("../src/Token");
const MockPriceManager = require("./mocks/mockPriceManager");

describe("TokenTracker", () => {
  let tokenTracker;
  let safetyChecker;
  let positionManager;
  let priceManager;
  let tokenData;

  beforeEach(() => {
    safetyChecker = {
      runSecurityChecks: sinon.stub().resolves(true)
    };

    positionManager = {
      openPosition: sinon.stub().returns(true),
      closePosition: sinon.stub().returns(0.4),
      getPosition: sinon.stub().returns({
        entryPrice: 10000,
        size: 0.1,
        highestPrice: 15000
      }),
      updateHighestPrice: sinon.stub()
    };

    priceManager = new MockPriceManager();

    tokenData = {
      mint: "testMint123",
      name: "Test Token",
      symbol: "TEST",
      uri: "test-uri",
      traderPublicKey: "creator123",
      initialBuy: 1000000,
      vTokensInBondingCurve: 1000000,
      vSolInBondingCurve: 10,
      marketCapSol: 100,
    };

    tokenTracker = new TokenTracker(safetyChecker, positionManager, priceManager);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("Token Management", () => {
    it("should add new tokens and emit events", () => {
      const token = tokenTracker.handleNewToken(tokenData);
      expect(token).to.be.instanceOf(Token);
      expect(tokenTracker.tokens.get(tokenData.mint)).to.equal(token);
    });

    it("should track token state transitions", () => {
      const token = tokenTracker.handleNewToken(tokenData);
      token.setState("heatingUp");
      expect(token.state).to.equal("heatingUp");
    });

    it("should manage positions based on token state", async () => {
      const token = tokenTracker.handleNewToken(tokenData);
      token.setState("drawdown");
      token.drawdownLow = 80;
      
      await tokenTracker.handleTokenUpdate({
        ...tokenData,
        marketCapSol: 90
      });

      expect(safetyChecker.runSecurityChecks.called).to.be.true;
      expect(positionManager.openPosition.called).to.be.true;
      expect(token.state).to.equal("inPosition");
    });
  });

  describe("Position Management", () => {
    it("should handle take profit execution", async () => {
      const token = tokenTracker.handleNewToken(tokenData);
      token.setState("inPosition");
      
      await tokenTracker.handleTokenUpdate({
        ...tokenData,
        marketCapSol: 150
      });

      expect(positionManager.closePosition.called).to.be.true;
    });

    it("should handle stop loss", async () => {
      const token = tokenTracker.handleNewToken(tokenData);
      token.setState("inPosition");
      
      await tokenTracker.handleTokenUpdate({
        ...tokenData,
        marketCapSol: 70
      });

      expect(positionManager.closePosition.called).to.be.true;
      expect(token.state).to.equal("closed");
    });
  });

  describe("Token Queries", () => {
    it("should get tokens by state", () => {
      const token1 = tokenTracker.handleNewToken({ ...tokenData, mint: "mint1" });
      const token2 = tokenTracker.handleNewToken({ ...tokenData, mint: "mint2" });
      
      token1.setState("heatingUp");
      token2.setState("heatingUp");
      
      const heatingUpTokens = tokenTracker.getTokensByState("heatingUp");
      expect(heatingUpTokens).to.have.lengthOf(2);
    });
  });
});
