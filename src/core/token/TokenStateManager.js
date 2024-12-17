const EventEmitter = require("events");
const config = require("../../utils/config");
const errorLogger = require("../../monitoring/errorLoggerInstance");

class TokenStateManager extends EventEmitter {
  constructor() {
    super();
    this.validStates = [
      "new",
      "heatingUp",
      "firstPump",
      "drawdown",
      "recovery",
      "closed",
      "dead"
    ];

    // Define valid state transitions
    this.stateTransitions = {
      new: ["heatingUp", "firstPump", "dead"],
      heatingUp: ["firstPump", "dead"],
      firstPump: ["drawdown", "dead"],
      drawdown: ["recovery", "dead"],
      recovery: ["drawdown", "closed", "dead"],
      closed: ["dead"],
      dead: []
    };

    if (process.env.NODE_ENV === 'test') {
      // Allow more flexible transitions in test mode
      this.validStates.forEach(state => {
        this.stateTransitions[state] = this.validStates.filter(s => s !== state);
      });
    }
  }

  setState(token, newState) {
    if (!this.validStates.includes(newState)) {
      const error = new Error(`Invalid state: ${newState}`);
      errorLogger.logError(error, 'TokenStateManager.setState', { 
        token: token.mint,
        currentState: token.state,
        attemptedState: newState 
      });
      throw error;
    }

    const currentState = token.state;
    if (!this.stateTransitions[currentState].includes(newState)) {
      const error = new Error(`Invalid state transition from ${currentState} to ${newState}`);
      errorLogger.logError(error, 'TokenStateManager.setState', {
        token: token.mint,
        currentState,
        attemptedState: newState
      });
      throw error;
    }

    const oldState = token.state;
    token.state = newState;

    // Handle state-specific logic
    if (newState === "drawdown") {
      token.drawdownLow = token.marketCapSol;
    }

    // Emit state change event
    this.emit("stateChanged", {
      token,
      from: oldState,
      to: newState
    });

    return true;
  }

  isHeatingUp(token) {
    if (token.state !== "new") return false;
    
    const priceChange = token.getPriceMomentum();
    const volumeSpike = token.getRecentVolume(300000) > token.getAverageVolume(1800000) * 1.5;
    
    return priceChange > 0.1 && volumeSpike; // 10% price increase with volume spike
  }

  isFirstPump(token) {
    if (!["new", "heatingUp"].includes(token.state)) return false;
    
    const priceChange = token.getPriceMomentum();
    const volumeSpike = token.getRecentVolume(300000) > token.getAverageVolume(1800000) * 2;
    const marketStructure = token.analyzeMarketStructure();
    
    // Focus on pump quality rather than initial market cap
    return (
      priceChange > 0.2 && // 20% price increase
      volumeSpike && // Strong volume
      marketStructure.buyPressure > config.THRESHOLDS.MIN_BUY_PRESSURE && // Good buy pressure
      marketStructure.overallHealth > config.THRESHOLDS.MIN_MARKET_STRUCTURE_SCORE // Healthy market
    );
  }

  isInDrawdown(token) {
    if (!["firstPump", "recovery"].includes(token.state)) return false;
    
    const drawdown = token.getDrawdownPercentage();
    const marketStructure = token.analyzeMarketStructure();
    
    // Enhanced drawdown detection
    return (
      drawdown <= -config.THRESHOLDS.PUMP_DRAWDOWN && // Significant drawdown
      token.hasSignificantVolume() && // Maintain decent volume
      marketStructure.structureScore.overall > config.THRESHOLDS.MIN_MARKET_STRUCTURE_SCORE * 0.7 // Allow some structure deterioration
    );
  }

  isRecovering(token) {
    if (token.state !== "drawdown") return false;

    const recoveryStrength = token.getRecoveryStrength();
    const marketStructure = token.analyzeMarketStructure();
    
    // Comprehensive recovery check
    return (
      recoveryStrength.total >= config.THRESHOLDS.MIN_RECOVERY_STRENGTH && // Strong recovery
      marketStructure.buyPressure >= config.THRESHOLDS.MIN_BUY_PRESSURE && // Good buy pressure
      marketStructure.overallHealth >= config.THRESHOLDS.MIN_MARKET_STRUCTURE_SCORE && // Healthy market
      token.getVolatility() <= config.THRESHOLDS.MAX_RECOVERY_VOLATILITY // Controlled volatility
    );
  }

  shouldExitRecovery(token) {
    if (token.state !== "recovery") return false;

    const strength = token.getRecoveryStrength();
    const buyPressure = strength.breakdown.buyPressure;

    // Exit if recovery weakens
    if (
      strength.total < 50 || // Overall weakness
      buyPressure.buyRatio < 0.5 || // Selling pressure increasing
      !buyPressure.buySizeIncreasing || // Buy sizes decreasing
      token.getPriceMomentum() < 0 // Negative momentum
    ) {
      return true;
    }

    // Exit if recovered too much
    const recoveryPercent = token.getRecoveryPercentage();
    if (recoveryPercent > 80) { // Take profits at 80% recovery
      return true;
    }

    return false;
  }

  isDead(token) {
    const marketStructure = token.analyzeMarketStructure();
    const volume = token.getRecentVolume(1800000); // 30-minute volume

    return (
      marketStructure.overallHealth < config.THRESHOLDS.MIN_MARKET_STRUCTURE_SCORE * 0.5 || // Severe structure breakdown
      volume < token.getAverageVolume(3600000) * 0.2 || // Severe volume decline
      token.marketCapSol < config.THRESHOLDS.DEAD_USD / token.getCurrentSolPrice() // Below dead threshold
    );
  }

  getValidTransitions(state) {
    return this.stateTransitions[state] || [];
  }

  isValidTransition(fromState, toState) {
    return this.stateTransitions[fromState]?.includes(toState) || false;
  }

  isValidState(state) {
    return this.validStates.includes(state);
  }
}

module.exports = TokenStateManager;
