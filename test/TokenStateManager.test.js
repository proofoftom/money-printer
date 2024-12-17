const { expect } = require("chai");
const sinon = require("sinon");
const TokenStateManager = require("../src/core/token/TokenStateManager");
const Token = require("../src/core/token/Token");

describe("TokenStateManager", () => {
  let stateManager;
  let token;
  let mockToken;

  beforeEach(() => {
    stateManager = new TokenStateManager();
    
    // Create a mock token with minimum required properties
    mockToken = {
      state: "new",
      marketCapSol: 100,
      vSolInBondingCurve: 10,
      pumpMetrics: {
        priceAcceleration: 0,
        volumeSpikes: []
      },
      traderManager: {
        getLastTradeTime: sinon.stub().returns(Date.now())
      },
      getRecentVolume: sinon.stub().returns(50),
      getDrawdownPercentage: sinon.stub().returns(-20),
      getRecoveryPercentage: sinon.stub().returns(10)
    };
  });

  describe("State Transitions", () => {
    it("should validate state transitions", () => {
      expect(() => stateManager.setState(mockToken, "heatingUp")).to.not.throw();
      mockToken.state = "heatingUp";
      expect(() => stateManager.setState(mockToken, "firstPump")).to.not.throw();
      mockToken.state = "firstPump";
      expect(() => stateManager.setState(mockToken, "inPosition")).to.not.throw();
    });

    it("should reject invalid state transitions", () => {
      expect(() => stateManager.setState(mockToken, "closed")).to.throw();
      mockToken.state = "heatingUp";
      expect(() => stateManager.setState(mockToken, "unsafeRecovery")).to.throw();
    });

    it("should emit stateChanged event", () => {
      const spy = sinon.spy();
      stateManager.on("stateChanged", spy);
      
      stateManager.setState(mockToken, "heatingUp");
      
      expect(spy.calledOnce).to.be.true;
      expect(spy.firstCall.args[0]).to.deep.equal({
        token: mockToken,
        from: "new",
        to: "heatingUp"
      });
    });
  });

  describe("State Validation", () => {
    it("should validate heatingUp state", () => {
      mockToken.pumpMetrics.priceAcceleration = 1;
      expect(stateManager.isHeatingUp(mockToken, 0.5)).to.be.true;
      
      mockToken.state = "heatingUp";
      expect(stateManager.isHeatingUp(mockToken, 0.5)).to.be.false;
    });

    it("should validate firstPump state", () => {
      mockToken.pumpMetrics.volumeSpikes = [{
        volume: 100,
        timestamp: Date.now()
      }];
      expect(stateManager.isFirstPump(mockToken, 150)).to.be.true;
      
      mockToken.state = "inPosition";
      expect(stateManager.isFirstPump(mockToken, 150)).to.be.false;
    });

    it("should validate drawdown state", () => {
      mockToken.state = "inPosition";
      expect(stateManager.isInDrawdown(mockToken)).to.be.true;
      
      mockToken.getDrawdownPercentage.returns(-50);
      expect(stateManager.isInDrawdown(mockToken)).to.be.false;
    });

    it("should validate dead state", () => {
      mockToken.vSolInBondingCurve = 0.5;
      expect(stateManager.isDead(mockToken, 1)).to.be.true;
      
      mockToken.vSolInBondingCurve = 2;
      mockToken.getDrawdownPercentage.returns(-95);
      expect(stateManager.isDead(mockToken, 1)).to.be.true;
      
      mockToken.getDrawdownPercentage.returns(-50);
      mockToken.traderManager.getLastTradeTime.returns(Date.now() - 2 * 60 * 60 * 1000);
      expect(stateManager.isDead(mockToken, 1)).to.be.true;
    });
  });

  describe("Utility Methods", () => {
    it("should get valid transitions for a state", () => {
      expect(stateManager.getValidTransitions("new")).to.deep.equal(["heatingUp", "firstPump", "dead"]);
      expect(stateManager.getValidTransitions("dead")).to.deep.equal([]);
    });

    it("should validate state transitions", () => {
      expect(stateManager.isValidTransition("new", "heatingUp")).to.be.true;
      expect(stateManager.isValidTransition("new", "closed")).to.be.false;
    });

    it("should validate states", () => {
      expect(stateManager.isValidState("heatingUp")).to.be.true;
      expect(stateManager.isValidState("invalid")).to.be.false;
    });
  });
});
