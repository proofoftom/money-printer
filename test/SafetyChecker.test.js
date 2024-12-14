const { expect } = require("chai");
const SafetyChecker = require("../src/SafetyChecker");
const Token = require("../src/Token");

describe("SafetyChecker", () => {
  let safetyChecker;
  let token;
  const initialBuyAmount = 60735849.056603;

  beforeEach(() => {
    safetyChecker = new SafetyChecker();

    token = new Token({
      mint: "testMint",
      name: "Test Token",
      symbol: "TEST",
      uri: "testUri",
      traderPublicKey: "creator123",
      initialBuy: initialBuyAmount,
      vTokensInBondingCurve: 1000,
      vSolInBondingCurve: 10,
      marketCapSol: 100
    });
  });

  it("should initialize correctly", () => {
    expect(safetyChecker).to.be.an("object");
  });

  it("should analyze holder concentration", () => {
    // Simulate holder concentration analysis
    // Example: const result = safetyChecker.checkHolderConcentration(holders);
    // expect(result).to.be.true;
  });

  it("should detect creator sold all tokens", () => {
    // Simulate creator selling detection
    // Example: const result = safetyChecker.hasCreatorSoldAll(holders.creator.balance);
    // expect(result).to.be.true;
  });

  it("should validate unique holder count", () => {
    // Simulate unique holder count validation
    // Example: const result = safetyChecker.hasEnoughUniqueHolders(holders);
    // expect(result).to.be.true;
  });

  describe("runSecurityChecks", () => {
    it("should pass when creator still holds tokens", () => {
      expect(safetyChecker.runSecurityChecks(token)).to.be.true;
    });

    it("should pass when creator has sold all tokens (reduced risk)", () => {
      // Creator sells all tokens
      token.update({
        traderPublicKey: "creator123",
        newTokenBalance: 0,
        marketCapSol: 100,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 10
      });

      expect(safetyChecker.runSecurityChecks(token)).to.be.true;
    });

    it("should fail when creator sells more than threshold", () => {
      // Creator sells 75% of their tokens
      token.update({
        traderPublicKey: "creator123",
        newTokenBalance: initialBuyAmount * 0.25,
        marketCapSol: 100,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 10
      });

      expect(safetyChecker.runSecurityChecks(token)).to.be.false;
    });
  });

  describe("isCreatorSellingSuspicious", () => {
    it("should return false when creator holds most tokens", () => {
      expect(safetyChecker.isCreatorSellingSuspicious(token)).to.be.false;
    });

    it("should return true when creator sells more than threshold", () => {
      // Creator sells 75% of their tokens
      token.update({
        traderPublicKey: "creator123",
        newTokenBalance: initialBuyAmount * 0.25,
        marketCapSol: 100,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 10
      });

      expect(safetyChecker.isCreatorSellingSuspicious(token)).to.be.true;
    });
  });

  describe("isCreatorFullyExited", () => {
    it("should return false when creator still holds tokens", () => {
      expect(safetyChecker.isCreatorFullyExited(token)).to.be.false;
    });

    it("should return true when creator has sold all tokens", () => {
      // Creator sells all tokens
      token.update({
        traderPublicKey: "creator123",
        newTokenBalance: 0,
        marketCapSol: 100,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 10
      });

      expect(safetyChecker.isCreatorFullyExited(token)).to.be.true;
    });
  });

  describe("holder concentration checks", () => {
    it("should pass when holder concentration is below threshold", () => {
      // Add some holders with total concentration below 30%
      token.update({
        traderPublicKey: "holder1",
        newTokenBalance: initialBuyAmount * 0.1, // 10%
        marketCapSol: 100,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 10
      });
      token.update({
        traderPublicKey: "holder2",
        newTokenBalance: initialBuyAmount * 0.15, // 15%
        marketCapSol: 100,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 10
      });

      expect(safetyChecker.runSecurityChecks(token)).to.be.true;
      expect(safetyChecker.isHolderConcentrationSafe(token)).to.be.true;
    });

    it("should fail when holder concentration is above threshold", () => {
      // Add some holders with total concentration above 30%
      token.update({
        traderPublicKey: "holder1",
        newTokenBalance: initialBuyAmount * 0.2, // 20%
        marketCapSol: 100,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 10
      });
      token.update({
        traderPublicKey: "holder2",
        newTokenBalance: initialBuyAmount * 0.3, // 30%
        marketCapSol: 100,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 10
      });

      expect(safetyChecker.runSecurityChecks(token)).to.be.false;
      expect(safetyChecker.isHolderConcentrationSafe(token)).to.be.false;
    });
  });

  describe("minimum holder checks", () => {
    it("should fail when there are too few holders", () => {
      // Add just a few holders
      for (let i = 1; i <= 10; i++) {
        token.update({
          traderPublicKey: `holder${i}`,
          newTokenBalance: 100,
          marketCapSol: 100,
          vTokensInBondingCurve: 1000,
          vSolInBondingCurve: 10
        });
      }

      expect(safetyChecker.runSecurityChecks(token)).to.be.false;
      expect(safetyChecker.hasEnoughHolders(token)).to.be.false;
    });

    it("should pass when there are enough holders", () => {
      // Add required number of holders
      for (let i = 1; i <= 25; i++) {
        token.update({
          traderPublicKey: `holder${i}`,
          newTokenBalance: 100,
          marketCapSol: 100,
          vTokensInBondingCurve: 1000,
          vSolInBondingCurve: 10
        });
      }

      expect(safetyChecker.hasEnoughHolders(token)).to.be.true;
      // Note: This might still fail due to holder concentration
      // Let's make sure the concentration is low enough
      token.update({
        traderPublicKey: "creator123",
        newTokenBalance: initialBuyAmount * 0.01, // Reduce creator's holdings to 1%
        marketCapSol: 100,
        vTokensInBondingCurve: 1000,
        vSolInBondingCurve: 10
      });
      expect(safetyChecker.runSecurityChecks(token)).to.be.true;
    });

    it("should allow configurable minimum holder count", () => {
      const customSafetyChecker = new SafetyChecker({
        MIN_HOLDERS: 10,
        MAX_TOP_HOLDER_CONCENTRATION: 30
      });

      // Add 15 holders
      for (let i = 1; i <= 15; i++) {
        token.update({
          traderPublicKey: `holder${i}`,
          newTokenBalance: 100,
          marketCapSol: 100,
          vTokensInBondingCurve: 1000,
          vSolInBondingCurve: 10
        });
      }

      expect(customSafetyChecker.hasEnoughHolders(token)).to.be.true;
    });
  });

  // Add more tests for SafetyChecker methods
});
