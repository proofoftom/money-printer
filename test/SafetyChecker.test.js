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

  // Add more tests for SafetyChecker methods
});
