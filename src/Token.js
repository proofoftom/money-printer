const EventEmitter = require("events");

// Token state management
const STATES = {
  NEW: "NEW",       // Just created
  READY: "READY",   // Ready for position
  DEAD: "DEAD",     // Token inactive/done
};

class Token extends EventEmitter {
  constructor(tokenData, { priceManager, safetyChecker }) {
    super();
    // Essential token properties
    this.mint = tokenData.mint;
    this.name = tokenData.name;
    this.symbol = tokenData.symbol;
    this.minted = tokenData.minted || Date.now();
    this.traderPublicKey = tokenData.traderPublicKey;
    this.vTokensInBondingCurve = tokenData.vTokensInBondingCurve;
    this.vSolInBondingCurve = tokenData.vSolInBondingCurve;
    this.marketCapSol = tokenData.marketCapSol;
    this.bondingCurveKey = tokenData.bondingCurveKey;
    
    // Core dependencies
    this.priceManager = priceManager;
    this.safetyChecker = safetyChecker;

    // State management
    this.state = STATES.NEW;
    this.highestMarketCap = this.marketCapSol;

    // Price tracking
    this.currentPrice = this.calculateTokenPrice();
    this.initialPrice = this.currentPrice;

    // Trade tracking
    this.lastTradeType = null;
    this.lastTradeAmount = null;
    this.lastTradeTime = null;
    this.tokenBalance = null;

    // Safety check interval
    this.safetyCheckInterval = null;
    this.startSafetyChecks();
  }

  startSafetyChecks() {
    // Clear any existing interval
    if (this.safetyCheckInterval) {
      clearInterval(this.safetyCheckInterval);
    }

    // Start regular safety checks every 2 seconds
    this.safetyCheckInterval = setInterval(() => {
      this.checkState();
    }, 2000);
  }

  cleanup() {
    if (this.safetyCheckInterval) {
      clearInterval(this.safetyCheckInterval);
    }
  }

  calculateTokenPrice() {
    if (!this.vTokensInBondingCurve || this.vTokensInBondingCurve === 0) {
      return 0;
    }

    // Market cap in SOL divided by total supply gives us the price per token
    const totalSupply = this.vTokensInBondingCurve;  // All tokens are in bonding curve initially
    return this.marketCapSol / totalSupply;
  }

  getCurrentPrice() {
    return this.calculateTokenPrice();
  }

  getDrawdownPercentage() {
    if (this.highestMarketCap === 0) return 0;
    return ((this.highestMarketCap - this.marketCapSol) / this.highestMarketCap) * 100;
  }

  update(data) {
    // Update core token data
    if (data.vTokensInBondingCurve !== undefined) {
      this.vTokensInBondingCurve = data.vTokensInBondingCurve;
    }
    if (data.vSolInBondingCurve !== undefined) {
      this.vSolInBondingCurve = data.vSolInBondingCurve;
    }
    if (data.marketCapSol !== undefined) {
      this.marketCapSol = data.marketCapSol;
    }
    if (data.newTokenBalance !== undefined) {
      this.tokenBalance = data.newTokenBalance;
    }

    // Track trade type from WebSocket message
    if (data.txType === 'buy' || data.txType === 'sell') {
      this.lastTradeType = data.txType;
      this.lastTradeAmount = data.tokenAmount;
      this.lastTradeTime = Date.now();
      
      // Emit trade event with detailed info
      this.emit('trade', {
        token: this,
        type: data.txType,
        amount: data.tokenAmount,
        newBalance: data.newTokenBalance,
        marketCapSol: this.marketCapSol,
        price: this.calculateTokenPrice()
      });
    }

    // Update highest market cap
    if (this.marketCapSol > this.highestMarketCap) {
      this.highestMarketCap = this.marketCapSol;
    }

    // Update current price
    const newPrice = this.calculateTokenPrice();
    if (newPrice !== this.currentPrice) {
      const oldPrice = this.currentPrice;
      this.currentPrice = newPrice;
      this.emit('priceChanged', {
        token: this,
        oldPrice,
        newPrice,
        tradeType: this.lastTradeType
      });
    }

    // Check state transitions
    this.checkState();

    // Emit update event
    this.emit('updated', {
      token: this,
      tradeType: data.txType,
      tradeAmount: data.tokenAmount
    });
  }

  // State management methods
  getCurrentState() {
    return this.state;
  }

  transitionTo(newState) {
    if (!Object.values(STATES).includes(newState)) {
      return false;
    }

    const oldState = this.state;
    this.state = newState;
    
    this.emit("stateChanged", { token: this, from: oldState, to: newState });
    
    return {
      success: true,
      from: oldState,
      to: newState
    };
  }

  setState(newState) {
    return this.transitionTo(newState);
  }

  checkState() {
    const currentState = this.getCurrentState();
    
    // Check if token is safe
    const safetyCheck = this.safetyChecker.isTokenSafe(this);
    
    if (currentState === STATES.NEW) {
      if (safetyCheck.safe) {
        // Token is safe, transition to READY and emit readyForPosition
        this.transitionTo(STATES.READY);
        this.emit('readyForPosition', this);
        
        // Stop regular safety checks once ready
        this.cleanup();
      } else {
        // Log safety check failure reasons
        console.debug(`Safety check failed for ${this.symbol}:`, safetyCheck.reasons);
      }
    } else if (currentState === STATES.READY) {
      if (!safetyCheck.safe) {
        // Token is no longer safe, transition to DEAD
        this.transitionTo(STATES.DEAD);
        this.cleanup();
      }
    }

    // Check for dead state (20% drawdown from peak)
    if (this.getDrawdownPercentage() >= 20 && currentState !== STATES.DEAD) {
      this.transitionTo(STATES.DEAD);
      this.cleanup();
    }

    return currentState;
  }
}

module.exports = { Token, STATES };
