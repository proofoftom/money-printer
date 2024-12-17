const { expect } = require("chai");
const sinon = require("sinon");
const Token = require("../src/core/token/Token");

describe("Token", () => {
  let token;
  let tokenData;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    tokenData = {
      mint: "testMint123",
      name: "Test Token",
      symbol: "TEST",
      uri: "test-uri",
      traderPublicKey: "creator123",
      initialBuy: 1000000,
      vTokensInBondingCurve: 1000000,
      vSolInBondingCurve: 10,
      marketCapSol: 10,
      signature: "sig123",
      bondingCurveKey: "curve123",
    };
    token = new Token(tokenData);
  });

  afterEach(() => {
    process.env.NODE_ENV = undefined;
    if (token) {
      token.cleanup();
    }
    sinon.restore();
  });

  describe("State Management", () => {
    it("should initialize with 'new' state", () => {
      expect(token.state).to.equal("new");
    });

    it("should emit state change events", (done) => {
      token.on("stateChanged", ({ token: t, from, to }) => {
        expect(t).to.equal(token);
        expect(from).to.equal("new");
        expect(to).to.equal("heatingUp");
        done();
      });

      token.setState("heatingUp");
    });

    it("should track highest market cap", () => {
      token.update({
        marketCapSol: 15,
        vTokensInBondingCurve: 1000000,
        vSolInBondingCurve: 15,
      });
      expect(token.highestMarketCap).to.equal(15);
      token.update({
        marketCapSol: 12,
        vTokensInBondingCurve: 1000000,
        vSolInBondingCurve: 12,
      });
      expect(token.highestMarketCap).to.equal(15);
    });

    it("should track drawdown low when in drawdown state", () => {
      token.setState("drawdown");
      token.update({
        marketCapSol: 8,
        vTokensInBondingCurve: 1000000,
        vSolInBondingCurve: 8,
      });
      expect(token.drawdownLow).to.equal(8);
      token.update({
        marketCapSol: 6,
        vTokensInBondingCurve: 1000000,
        vSolInBondingCurve: 6,
      });
      expect(token.drawdownLow).to.equal(6);
    });

    it("should allow setting state to inPosition", () => {
      token.setState("inPosition");
      expect(token.state).to.equal("inPosition");
    });
  });

  describe("Market Calculations", () => {
    it("should calculate drawdown percentage correctly", () => {
      token.highestMarketCap = 20;
      token.marketCapSol = 10;
      expect(token.getDrawdownPercentage()).to.equal(50);
    });

    it("should calculate recovery percentage when in drawdown", () => {
      token.setState("drawdown");
      token.drawdownLow = 5;
      token.marketCapSol = 10;
      expect(token.getRecoveryPercentage()).to.equal(100);
    });

    it("should return 0 recovery percentage when not in drawdown", () => {
      token.setState("heatingUp");
      token.drawdownLow = 5;
      token.marketCapSol = 10;
      expect(token.getRecoveryPercentage()).to.equal(0);
    });
  });

  describe("State Checks", () => {
    it("should check if token is heating up", () => {
      token.marketCapSol = 10;
      expect(token.isHeatingUp(9)).to.be.true;
      expect(token.isHeatingUp(11)).to.be.false;
    });

    it("should check if token is in first pump", () => {
      token.marketCapSol = 15;
      expect(token.isFirstPump(12)).to.be.true;
      expect(token.isFirstPump(20)).to.be.false;
    });

    it("should check if token is dead", () => {
      token.marketCapSol = 5;
      expect(token.isDead(7)).to.be.true;
      expect(token.isDead(3)).to.be.false;
    });
  });

  describe("holder tracking", () => {
    it("should initialize with creator as holder when newTokenBalance provided", () => {
      const token = new Token({
        ...tokenData,
        traderPublicKey: "creator123",
        newTokenBalance: 500,
      });
      expect(token.getHolderCount()).to.equal(1);
      expect(token.getTotalTokensHeld()).to.equal(500);
    });

    it("should initialize with creator as holder on initialBuy", () => {
      const token = new Token({
        ...tokenData,
        traderPublicKey: "creator123",
        initialBuy: 60735849.056603,
        newTokenBalance: undefined,
      });
      expect(token.getHolderCount()).to.equal(1);
      expect(token.getTotalTokensHeld()).to.equal(60735849.056603);
    });

    it("should not initialize creator as holder without initialBuy or newTokenBalance", () => {
      const token = new Token({
        ...tokenData,
        traderPublicKey: "creator123",
        initialBuy: false,
        newTokenBalance: undefined,
      });
      expect(token.getHolderCount()).to.equal(0);
      expect(token.getTotalTokensHeld()).to.equal(0);
    });

    let token;
    const tokenData = {
      mint: "testMint",
      name: "Test Token",
      symbol: "TEST",
      uri: "testUri",
      traderPublicKey: "creator123",
      initialBuy: true,
      vTokensInBondingCurve: 1000,
      vSolInBondingCurve: 10,
      marketCapSol: 100,
      signature: "sig123",
      bondingCurveKey: "curve123",
      newTokenBalance: 500,
    };

    beforeEach(() => {
      token = new Token(tokenData);
    });

    it("should initialize with creator as holder", () => {
      expect(token.getHolderCount()).to.equal(1);
      expect(token.getTotalTokensHeld()).to.equal(500);
    });

    it("should update holder balances", () => {
      token.update({
        traderPublicKey: "holder456",
        newTokenBalance: 200,
        marketCapSol: 100,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 10,
      });

      expect(token.getHolderCount()).to.equal(2);
      expect(token.getTotalTokensHeld()).to.equal(700);
    });

    it("should remove holders with zero balance", () => {
      token.update({
        traderPublicKey: "creator123",
        newTokenBalance: 0,
        marketCapSol: 100,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 10,
      });

      expect(token.getHolderCount()).to.equal(0);
      expect(token.getTotalTokensHeld()).to.equal(0);
    });
  });

  describe("creator holdings tracking", () => {
    let token;
    const initialBuyAmount = 60735849.056603;

    beforeEach(() => {
      token = new Token({
        ...tokenData,
        traderPublicKey: "creator123",
        initialBuy: initialBuyAmount,
      });
    });

    it("should track creator's initial holdings", () => {
      expect(token.getCreatorHoldings()).to.equal(initialBuyAmount);
      expect(token.creatorInitialHoldings).to.equal(initialBuyAmount);
      expect(token.hasCreatorSoldAll()).to.be.false;
      expect(token.getCreatorSellPercentage()).to.equal(0);
    });

    it("should track creator's selling activity", () => {
      // Creator sells half their tokens
      token.update({
        traderPublicKey: "creator123",
        newTokenBalance: initialBuyAmount / 2,
        marketCapSol: 100,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 10,
      });

      expect(token.getCreatorHoldings()).to.equal(initialBuyAmount / 2);
      expect(token.hasCreatorSoldAll()).to.be.false;
      expect(token.getCreatorSellPercentage()).to.equal(50);

      // Creator sells all tokens
      token.update({
        traderPublicKey: "creator123",
        newTokenBalance: 0,
        marketCapSol: 100,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 10,
      });

      expect(token.getCreatorHoldings()).to.equal(0);
      expect(token.hasCreatorSoldAll()).to.be.true;
      expect(token.getCreatorSellPercentage()).to.equal(100);
    });
  });

  describe("holder concentration", () => {
    let token;
    const initialBuyAmount = 1000;

    beforeEach(() => {
      token = new Token({
        ...tokenData,
        initialBuy: initialBuyAmount,
      });
    });

    it("should calculate top holder concentration", () => {
      // Add some holders
      token.update({
        traderPublicKey: "holder1",
        newTokenBalance: 200,
        marketCapSol: 100,
      });
      token.update({
        traderPublicKey: "holder2",
        newTokenBalance: 300,
        marketCapSol: 100,
      });
      token.update({
        traderPublicKey: "holder3",
        newTokenBalance: 500,
        marketCapSol: 100,
      });

      const topHolders = token.getTopHolders(3);
      expect(topHolders).to.have.length(3);
      expect(topHolders[0].balance).to.equal(1000); // creator
      expect(topHolders[1].balance).to.equal(500); // holder3
      expect(topHolders[2].balance).to.equal(300); // holder2

      // Total supply = 2000 (1000 + 200 + 300 + 500)
      // Top 2 holders = 1500 (1000 + 500)
      // Concentration = (1500 / 2000) * 100 = 75%
      expect(token.getTopHolderConcentration(2)).to.equal(75);
    });

    it("should handle empty holders", () => {
      const token = new Token({
        ...tokenData,
        initialBuy: undefined,
      });
      expect(token.getTopHolders()).to.have.length(0);
      expect(token.getTopHolderConcentration()).to.equal(0);
    });
  });
});
