const { expect } = require("chai");
const sinon = require("sinon");
const Token = require("../src/Token");
const TokenManager = require("../src/TokenManager");
const MockPriceManager = require("./mocks/mockPriceManager");

describe("TokenManager", () => {
  let tokenManager;
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
      closePosition: sinon.stub().returns({ profitLoss: 0.4, portion: 1.0 }),
      getPosition: sinon.stub().returns({
        entryPrice: 10000,
        size: 0.1,
        highestPrice: 15000,
        currentPrice: 15000
      }),
      updatePosition: sinon.stub().returns({
        profitLoss: 0.4,
        portion: 0.4,
        entryPrice: 10000,
        exitPrice: 15000
      })
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

    tokenManager = new TokenManager(safetyChecker, positionManager, priceManager);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("Token Management", () => {
    it("should add new tokens and emit events", () => {
      const token = tokenManager.handleNewToken(tokenData);
      expect(token).to.be.instanceOf(Token);
      expect(tokenManager.tokens.get(tokenData.mint)).to.equal(token);
    });

    it("should track token state transitions", () => {
      const token = tokenManager.handleNewToken(tokenData);
      token.setState("heatingUp");
      expect(token.state).to.equal("heatingUp");
    });

    it("should manage positions based on token state", async () => {
      const token = tokenManager.handleNewToken(tokenData);
      token.setState("drawdown");
      token.drawdownLow = 80;
      
      await tokenManager.handleTokenUpdate({
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
      const token = tokenManager.handleNewToken(tokenData);
      token.setState("inPosition");
      
      // Mock a partial exit (take profit)
      positionManager.updatePosition.returns({
        profitLoss: 0.4,
        portion: 0.4,
        entryPrice: 10000,
        exitPrice: 15000
      });
      
      await tokenManager.handleTokenUpdate({
        ...tokenData,
        marketCapSol: 150
      });

      expect(positionManager.updatePosition.called).to.be.true;
      expect(token.state).to.equal("inPosition"); // Still in position after partial exit
    });

    it("should handle stop loss", async () => {
      const token = tokenManager.handleNewToken(tokenData);
      token.setState("inPosition");
      
      // Mock a full exit (stop loss)
      positionManager.updatePosition.returns({
        profitLoss: -0.2,
        portion: 1.0,
        entryPrice: 10000,
        exitPrice: 8000
      });
      
      await tokenManager.handleTokenUpdate({
        ...tokenData,
        marketCapSol: 70
      });

      expect(positionManager.updatePosition.called).to.be.true;
      expect(token.state).to.equal("closed");
    });
  });

  describe("Token Queries", () => {
    it("should get tokens by state", () => {
      const token1 = tokenManager.handleNewToken({ ...tokenData, mint: "mint1" });
      const token2 = tokenManager.handleNewToken({ ...tokenData, mint: "mint2" });
      
      token1.setState("heatingUp");
      token2.setState("heatingUp");
      
      const heatingUpTokens = tokenManager.getTokensByState("heatingUp");
      expect(heatingUpTokens).to.have.lengthOf(2);
    });
  });
});
