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
      "inPosition",
      "drawdown",
      "unsafeRecovery",
      "closed",
      "dead"
    ];

    this.stateTransitions = {
      new: ["heatingUp", "firstPump", "dead"],
      heatingUp: ["firstPump", "inPosition", "dead"],
      firstPump: ["inPosition", "drawdown", "dead"],
      inPosition: ["drawdown", "closed", "dead"],
      drawdown: ["unsafeRecovery", "inPosition", "closed", "dead"],
      unsafeRecovery: ["inPosition", "drawdown", "closed", "dead"],
      closed: ["dead"],
      dead: []
    };
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

  // State validation methods
  isHeatingUp(token, threshold = config.SAFETY.PUMP_DETECTION.MIN_PRICE_ACCELERATION) {
    if (token.state !== "new") return false;
    return token.pumpMetrics.priceAcceleration > threshold;
  }

  isFirstPump(token, threshold = config.SAFETY.PUMP_DETECTION.MIN_VOLUME_SPIKE) {
    if (!["new", "heatingUp"].includes(token.state)) return false;
    
    const volumeSpikes = token.pumpMetrics.volumeSpikes;
    if (volumeSpikes.length === 0) return false;
    
    const recentSpike = volumeSpikes[volumeSpikes.length - 1];
    const volumeIncrease = recentSpike.volume / token.getRecentVolume(config.SAFETY.PUMP_DETECTION.PUMP_WINDOW_MS) * 100;
    
    return volumeIncrease > threshold;
  }

  isInDrawdown(token) {
    if (!["inPosition", "firstPump"].includes(token.state)) return false;
    
    const drawdown = token.getDrawdownPercentage();
    return drawdown <= config.SAFETY.MAX_DRAWDOWN;
  }

  isUnsafeRecovery(token) {
    if (token.state !== "drawdown") return false;
    
    const recovery = token.getRecoveryPercentage();
    return recovery >= config.SAFETY.RECOVERY_THRESHOLD;
  }

  isDead(token, threshold = config.SAFETY.MIN_LIQUIDITY_SOL) {
    // A token is considered dead if:
    // 1. Liquidity is below minimum threshold
    // 2. No trading activity in last hour
    // 3. Price has dropped significantly from peak
    
    if (token.vSolInBondingCurve < threshold) return true;
    
    const lastTradeTime = token.traderManager.getLastTradeTime(token.mint);
    if (Date.now() - lastTradeTime > 60 * 60 * 1000) return true;
    
    const drawdown = token.getDrawdownPercentage();
    return drawdown <= -90; // 90% drop from peak
  }

  // Utility methods
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
