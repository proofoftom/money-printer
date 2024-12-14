const { expect } = require("chai");
const sinon = require("sinon");
const Token = require("../src/Token");

describe("Token", () => {
  let token;
  let tokenData;

  beforeEach(() => {
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
      bondingCurveKey: "curve123"
    };
    token = new Token(tokenData);
  });

  afterEach(() => {
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
      token.update({ marketCapSol: 15, vTokensInBondingCurve: 1000000, vSolInBondingCurve: 15 });
      expect(token.highestMarketCap).to.equal(15);
      token.update({ marketCapSol: 12, vTokensInBondingCurve: 1000000, vSolInBondingCurve: 12 });
      expect(token.highestMarketCap).to.equal(15);
    });

    it("should track drawdown low when in drawdown state", () => {
      token.setState("drawdown");
      token.update({ marketCapSol: 8, vTokensInBondingCurve: 1000000, vSolInBondingCurve: 8 });
      expect(token.drawdownLow).to.equal(8);
      token.update({ marketCapSol: 6, vTokensInBondingCurve: 1000000, vSolInBondingCurve: 6 });
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
});
