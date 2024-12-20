const EventEmitter = require("events");

// Token state management
const STATES = {
  NEW: "NEW",       // Just created
  READY: "READY",   // Ready for position
  DEAD: "DEAD",     // Token inactive/done
  UNSAFE: "UNSAFE", // Token marked as unsafe
};

class Token extends EventEmitter {
  constructor(tokenData, { priceManager, safetyChecker, logger, config }) {
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
    this.logger = logger;
    this.config = config;

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

    // Pump metrics tracking
    this.createdAt = Date.now();
    this.highestPrice = 0;
    this.highestPriceTime = null;
    this.volume = 0;
    this.tradeCount = 0;
    this.priceHistory = [];

    // Holder tracking
    this.holders = new Map(); // Map<address, balance>
    this.totalSupplyOutsideCurve = 0;

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
      this.checkSafetyConditions();
    }, this.config.SAFETY_CHECK_INTERVAL);
  }

  cleanup() {
    if (this.safetyCheckInterval) {
      clearInterval(this.safetyCheckInterval);
    }
  }

  calculateTokenPrice() {
    if (!this.getTotalSupply() || this.getTotalSupply() === 0) {
      return 0;
    }

    // Market cap in SOL divided by total supply gives us the price per token
    const totalSupply = this.getTotalSupply();  
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

    // Update pump metrics
    this.updatePrice(this.currentPrice);

    // Check state transitions
    this.checkState();

    // Emit update event
    this.emit('updated', {
      token: this,
      tradeType: data.txType,
      tradeAmount: data.tokenAmount
    });
  }

  updatePrice(price, timestamp = Date.now()) {
    this.priceHistory.push({ price, timestamp });
    this.volume += price; // Simplified volume calculation
    this.tradeCount++;
    if (price > this.highestPrice) {
      this.highestPrice = price;
      this.highestPriceTime = timestamp;
    }
  }

  getCurrentPrice() {
    return this.currentPrice;
  }

  getHighestPrice() {
    return this.highestPrice;
  }

  getHighestPriceTime() {
    return this.highestPriceTime;
  }

  getVolumeSinceCreation() {
    return this.volume;
  }

  getTradeCount() {
    return this.tradeCount;
  }

  // Get price velocity over the last n milliseconds
  getPriceVelocity(timeWindow = 5000) {
    const now = Date.now();
    const relevantPrices = this.priceHistory.filter(p => p.timestamp >= now - timeWindow);
    if (relevantPrices.length < 2) return 0;

    const first = relevantPrices[0];
    const last = relevantPrices[relevantPrices.length - 1];
    const priceDelta = last.price - first.price;
    const timeDelta = (last.timestamp - first.timestamp) / 1000; // Convert to seconds
    
    return timeDelta > 0 ? priceDelta / timeDelta : 0;
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
        // Emit safety check failure event
        this.emit('safetyCheckFailed', {
          token: this,
          reasons: safetyCheck.reasons
        });
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

  updateHolderBalance(address, amount, isBuy) {
    let currentBalance = this.holders.get(address) || 0;
    
    if (isBuy) {
      currentBalance += amount;
      this.totalSupplyOutsideCurve += amount;
    } else {
      currentBalance -= amount;
      this.totalSupplyOutsideCurve -= amount;
    }

    if (currentBalance <= 0) {
      this.holders.delete(address);
    } else {
      this.holders.set(address, currentBalance);
    }
  }

  getTotalSupply() {
    return this.vTokensInBondingCurve + this.totalSupplyOutsideCurve;
  }

  handleTokenTrade(message) {
    const { type, trader, amount } = message;
    const isBuy = type === 'buy';
    
    // Update holder balances
    this.updateHolderBalance(trader, amount, isBuy);
    
    // Update bonding curve supply
    if (isBuy) {
      this.vTokensInBondingCurve -= amount;
    } else {
      this.vTokensInBondingCurve += amount;
    }

    // Update other trade metrics
    this.lastTradeTime = Date.now();
    this.updatePrice(this.calculateTokenPrice());
  }

  getHolderCount() {
    return this.holders.size;
  }

  getHolderBalance(address) {
    return this.holders.get(address) || 0;
  }

  getTopHolders(limit = 10) {
    return Array.from(this.holders.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([address, balance]) => ({ address, balance }));
  }

  getTopHoldersConcentration() {
    const totalSupply = this.getTotalSupply();
    if (totalSupply === 0) return 0;

    const topHoldersTotal = this.getTopHolders(10)
      .reduce((sum, { balance }) => sum + balance, 0);
    
    return (topHoldersTotal / totalSupply) * 100;
  }

  checkSafetyConditions() {
    const state = this.getCurrentState();
    if (state === STATES.UNSAFE) {
      return false;
    }

    // Check holder concentration
    const topHoldersConcentration = this.getTopHoldersConcentration();
    if (topHoldersConcentration > this.config.MAX_HOLDER_CONCENTRATION) {
      this.logger.warn(`Token marked unsafe: Top holders concentration too high (${topHoldersConcentration.toFixed(2)}%)`);
      this.setState(STATES.UNSAFE);
      return false;
    }

    // Check if there's been any trading activity
    const timeSinceLastTrade = Date.now() - this.lastTradeTime;
    if (timeSinceLastTrade > this.config.MAX_TIME_WITHOUT_TRADES) {
      this.logger.warn('Token marked unsafe: No recent trading activity');
      this.setState(STATES.UNSAFE);
      return false;
    }

    // Check if price has dropped significantly
    const currentPrice = this.getCurrentPrice();
    if (currentPrice < this.initialPrice * (1 - this.config.MAX_PRICE_DROP_PERCENT)) {
      this.logger.warn('Token marked unsafe: Price dropped significantly');
      this.setState(STATES.UNSAFE);
      return false;
    }

    return true;
  }
}

module.exports = { Token, STATES };
