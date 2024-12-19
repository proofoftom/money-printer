const EventEmitter = require("events");
const Token = require("./Token");
const config = require("./config");
const { STATES } = require("./TokenStateManager");

class TokenTracker extends EventEmitter {
  constructor({ safetyChecker, positionManager, priceManager, webSocketManager }) {
    super();
    this.safetyChecker = safetyChecker;
    this.positionManager = positionManager;
    this.priceManager = priceManager;
    this.webSocketManager = webSocketManager;
    this.tokens = new Map();

    // Set up WebSocket event listeners
    this.webSocketManager.on("newToken", (tokenData) => {
      this.handleNewToken(tokenData);
    });

    this.webSocketManager.on("tokenTrade", (tradeData) => {
      if (this.tokens.has(tradeData.mint)) {
        const token = this.tokens.get(tradeData.mint);
        token.update(tradeData);
        this.emit("tokenUpdated", token);
      }
    });
  }

  handleNewToken(tokenData) {
    if (this.tokens.has(tokenData.mint)) {
      // Update existing token
      const token = this.tokens.get(tokenData.mint);
      token.update(tokenData);
      this.emit("tokenUpdated", token);
      return;
    }

    const token = new Token(tokenData, {
      priceManager: this.priceManager,
      safetyChecker: this.safetyChecker
    });

    // Listen for state changes
    token.on("stateChanged", ({ token, from, to }) => {
      this.emit("tokenStateChanged", { token, from, to });
      this.emit("tokenUpdated", token);

      // Unsubscribe and remove dead tokens
      if (to === STATES.DEAD) {
        this.webSocketManager?.unsubscribeFromToken(token.mint);
        this.removeToken(token.mint);
      }
    });

    // Listen for position opportunities
    token.on("readyForPosition", ({ token }) => {
      // Skip if we already have a position
      if (this.positionManager.getPosition(token.mint)) {
        return;
      }

      // Check market cap threshold
      const marketCapUSD = this.priceManager.solToUSD(token.marketCapSol);
      if (marketCapUSD > config.THRESHOLDS.MAX_ENTRY_CAP_USD) {
        return;
      }

      // Open position
      this.positionManager.openPosition(token);
    });

    this.tokens.set(tokenData.mint, token);
    this.emit("tokenAdded", token);
  }

  removeToken(mint) {
    const token = this.tokens.get(mint);
    if (token) {
      this.tokens.delete(mint);
      this.emit("tokenRemoved", token);
    }
  }

  getToken(mint) {
    return this.tokens.get(mint);
  }

  async handleNewTokenAsync(tokenData) {
    try {
      if (!this.validateTokenData(tokenData)) {
        console.error('Invalid token data:', JSON.stringify(tokenData));
        return;
      }

      const token = {
        ...tokenData,
        age: this.calculateTokenAge(tokenData),
        ...this.formatMarketMetrics(tokenData)
      };

      const isSafe = await this.safetyChecker.isTokenSafe(token);
      if (!isSafe) {
        return;
      }

      this.tokens.set(token.mint, token);
      this.emit('tokenAdded', token);
    } catch (error) {
      console.error('Error handling new token:', error);
    }
  }

  async handleTokenUpdateAsync(tokenData) {
    try {
      const existingToken = this.tokens.get(tokenData.mint);
      if (!existingToken) {
        return;
      }

      const updatedToken = {
        ...existingToken,
        ...tokenData,
        age: this.calculateTokenAge(tokenData),
        ...this.formatMarketMetrics(tokenData)
      };

      this.tokens.set(tokenData.mint, updatedToken);
      this.emit('tokenUpdated', updatedToken);
    } catch (error) {
      console.error('Error updating token:', error);
    }
  }

  validateTokenData(tokenData) {
    const requiredFields = ['mint', 'name', 'symbol', 'timestamp'];
    return requiredFields.every(field => tokenData[field]);
  }

  calculateTokenAge(token) {
    const ageInMinutes = (Date.now() - token.timestamp) / (60 * 1000);
    
    if (ageInMinutes < 60) {
      return `${Math.floor(ageInMinutes)}m`;
    }
    
    const ageInHours = ageInMinutes / 60;
    if (ageInHours < 24) {
      return `${Math.floor(ageInHours)}h`;
    }
    
    return `${Math.floor(ageInHours / 24)}d`;
  }

  formatMarketMetrics(token) {
    return {
      vSol: (parseFloat(token.vSol) / 1e6).toFixed(3),
      vTokens: (parseFloat(token.vTokens) / 1e6).toFixed(3),
      marketCap: (parseFloat(token.marketCap) / 1e6).toFixed(3)
    };
  }

  filterOldTokens() {
    const maxAge = config.MAX_TOKEN_AGE;
    const now = Date.now();

    for (const [mint, token] of this.tokens.entries()) {
      const tokenAge = now - token.timestamp;
      if (tokenAge > maxAge) {
        this.tokens.delete(mint);
        this.emit('tokenRemoved', { mint, reason: 'age' });
      }
    }
  }

  filterLowLiquidityTokens() {
    const minLiquidity = config.MIN_LIQUIDITY_SOL * 1e6; // Convert to lamports

    for (const [mint, token] of this.tokens.entries()) {
      const liquiditySol = parseFloat(token.vSol);
      if (liquiditySol < minLiquidity) {
        this.tokens.delete(mint);
        this.emit('tokenRemoved', { mint, reason: 'liquidity' });
      }
    }
  }

  getTokenStats() {
    const stats = {
      total: this.tokens.size,
      new: 0,
      ready: 0,
      dead: 0,
      avgMarketCapUSD: 0,
      totalMarketCapUSD: 0
    };

    let totalMarketCapSOL = 0;
    for (const token of this.tokens.values()) {
      switch (token.stateManager.getCurrentState()) {
        case STATES.NEW:
          stats.new++;
          break;
        case STATES.READY:
          stats.ready++;
          break;
        case STATES.DEAD:
          stats.dead++;
          break;
      }
      totalMarketCapSOL += token.marketCapSol;
    }

    stats.totalMarketCapUSD = this.priceManager.solToUSD(totalMarketCapSOL);
    stats.avgMarketCapUSD = stats.total > 0 ? this.priceManager.solToUSD(totalMarketCapSOL / stats.total) : 0;

    return stats;
  }
}

module.exports = TokenTracker;
