const { expect } = require("chai");
const SafetyChecker = require("../src/SafetyChecker");
const Token = require("../src/Token");

describe("SafetyChecker", () => {
  let safetyChecker;
  let token;
  const initialBuyAmount = 100000; // Using smaller amount for easier test calculations

  beforeEach(() => {
    safetyChecker = new SafetyChecker({
      MIN_HOLDERS: 25,
      MAX_TOP_HOLDER_CONCENTRATION: 30,
    });

    token = new Token({
      mint: "testMint",
      name: "Test Token",
      symbol: "TEST",
      uri: "testUri",
      traderPublicKey: "creator123",
      initialBuy: initialBuyAmount,
      marketCapSol: 30,
    });
  });

  describe("runSecurityChecks", () => {
    it("should fail initially due to insufficient holders", () => {
      expect(safetyChecker.runSecurityChecks(token)).to.be.false;
    });

    it("should pass with enough holders and good distribution", () => {
      // Add required number of holders with small balances
      for (let i = 1; i <= 26; i++) {
        token.update({
          traderPublicKey: `holder${i}`,
          newTokenBalance: 10, // Each holder gets a small amount
          marketCapSol: 100,
        });
      }

      // Reduce creator's holdings to avoid concentration
      token.update({
        traderPublicKey: "creator123",
        newTokenBalance: 10, // Small enough to keep concentration low
        marketCapSol: 100,
      });

      expect(safetyChecker.runSecurityChecks(token)).to.be.true;
    });
  });

  describe("holder concentration checks", () => {
    beforeEach(() => {
      // Add required number of holders first
      for (let i = 1; i <= 25; i++) {
        token.update({
          traderPublicKey: `holder${i}`,
          newTokenBalance: 1000,
          marketCapSol: 100,
        });
      }
    });

    it("should pass when holder concentration is below threshold", () => {
      // Reduce creator's holdings
      token.update({
        traderPublicKey: "creator123",
        newTokenBalance: 1000, // Equal to other holders
        marketCapSol: 100,
      });

      expect(safetyChecker.isHolderConcentrationSafe(token)).to.be.true;
      expect(safetyChecker.runSecurityChecks(token)).to.be.true;
    });

    it("should fail when holder concentration is above threshold", () => {
      // Keep creator's large holdings
      expect(safetyChecker.isHolderConcentrationSafe(token)).to.be.false;
      expect(safetyChecker.runSecurityChecks(token)).to.be.false;
    });
  });

  describe("creator exit checks", () => {
    beforeEach(() => {
      // Add required number of holders first
      for (let i = 1; i <= 25; i++) {
        token.update({
          traderPublicKey: `holder${i}`,
          newTokenBalance: 10,
          marketCapSol: 100,
          vTokensInBondingCurve: 1000,
          vSolInBondingCurve: 10,
        });
      }
    });

    it("should detect when creator has exited", () => {
      token.update({
        traderPublicKey: "creator123",
        newTokenBalance: 0,
        marketCapSol: 100,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 10,
      });

      expect(safetyChecker.isCreatorFullyExited(token)).to.be.true;
    });

    it("should detect when creator still holds tokens", () => {
      expect(safetyChecker.isCreatorFullyExited(token)).to.be.false;
    });
  });
});
