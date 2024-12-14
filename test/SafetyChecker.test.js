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
      // First clear creator's initial balance
      token.update({
        traderPublicKey: "creator123",
        newTokenBalance: 0,
        marketCapSol: 100,
      });
      
      // Add 40 holders with equal distribution
      const totalSupply = initialBuyAmount;
      const regularBalance = totalSupply / 40; // Equal distribution
      
      for (let i = 1; i <= 40; i++) {
        token.update({
          traderPublicKey: `holder${i}`,
          newTokenBalance: regularBalance,
          marketCapSol: 100,
        });
      }

      expect(safetyChecker.runSecurityChecks(token)).to.be.true;
    });
  });

  describe("holder concentration checks", () => {
    beforeEach(() => {
      // Add required number of holders first
      for (let i = 1; i <= 25; i++) {
        token.update({
          traderPublicKey: `holder${i}`,
          newTokenBalance: 1000, // Equal distribution
          marketCapSol: 100,
        });
      }
    });

    it("should pass when holder concentration is below threshold", () => {
      // First clear creator's initial balance
      token.update({
        traderPublicKey: "creator123",
        newTokenBalance: 0,
        marketCapSol: 100,
      });

      const totalSupply = initialBuyAmount;
      const regularBalance = totalSupply / 50; // 2% each for regular holders
      const topHolderBalance = totalSupply / 40; // 2.5% for top holders
      
      // Set regular holder balances (40 holders with 2% each)
      for (let i = 10; i <= 50; i++) {
        token.update({
          traderPublicKey: `holder${i}`,
          newTokenBalance: regularBalance,
          marketCapSol: 100,
        });
      }

      // Update top 9 holders with slightly higher balances (2.5% each)
      for (let i = 1; i <= 9; i++) {
        token.update({
          traderPublicKey: `holder${i}`,
          newTokenBalance: topHolderBalance,
          marketCapSol: 100,
        });
      }

      // Update creator's balance to be same as top holders (2.5%)
      token.update({
        traderPublicKey: "creator123",
        newTokenBalance: topHolderBalance,
        marketCapSol: 100,
      });

      expect(safetyChecker.isHolderConcentrationSafe(token)).to.be.true;
      expect(safetyChecker.runSecurityChecks(token)).to.be.true;
    });

    it("should fail when holder concentration is above threshold", () => {
      // Top 10 holders (including creator) will have more than 30% combined
      const totalSupply = 26000;
      const targetBalance = (totalSupply * 0.04); // Each top holder gets 4%
      
      // Update top 9 holders with high balances
      for (let i = 1; i <= 9; i++) {
        token.update({
          traderPublicKey: `holder${i}`,
          newTokenBalance: targetBalance,
          marketCapSol: 100,
        });
      }

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
