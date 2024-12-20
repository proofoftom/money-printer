const { EventEmitter } = require('events');
const Token = require('./Token');

class TokenTracker extends EventEmitter {
  constructor(config, logger, webSocketManager, positionManager) {
    super();
    this.config = config;
    this.logger = logger;
    this.webSocketManager = webSocketManager;
    this.positionManager = positionManager;
    this.tokens = new Map();

    // Set up WebSocket event listeners
    if (this.webSocketManager) {
      this.webSocketManager.on("newToken", (tokenData) => {
        this.handleNewToken(tokenData);
      });

      this.webSocketManager.on("tokenTrade", (tradeData) => {
        this.handleTokenTrade(tradeData);
      });
    }
  }

  async handleNewToken(tokenData) {
    try {
      this.logger.info('New token detected', {
        mint: tokenData.mint,
        symbol: tokenData.symbol
      });

      // Create new Token instance
      const token = new Token(tokenData, {
        logger: this.logger,
        config: this.config
      });

      // Set up token event listeners
      token.on('readyForPosition', async () => {
        if (this.config.TRADING.ENABLED) {
          try {
            await this.positionManager.openPosition(token);
          } catch (error) {
            this.logger.error('Failed to open position', error);
          }
        } else {
          this.logger.info('Trading is disabled, skipping position opening');
        }
      });

      token.on('stateChanged', ({ oldState, newState }) => {
        this.logger.debug('Token state changed', {
          mint: token.mint,
          oldState,
          newState
        });
      });

      // Store token
      this.tokens.set(tokenData.mint, token);

      // Subscribe to token trades
      this.webSocketManager.subscribeToToken(tokenData.mint);

      // Start safety checks
      token.startSafetyChecks();

    } catch (error) {
      this.logger.error('Error handling new token:', error);
    }
  }

  handleTokenTrade(tradeData) {
    const token = this.tokens.get(tradeData.mint);
    if (token) {
      token.update(tradeData);

      this.logger.debug('Token trade detected', {
        mint: tradeData.mint,
        txType: tradeData.txType
      });

      this.logger.debug('Token updated', {
        mint: tradeData.mint,
        marketCapSol: tradeData.marketCapSol
      });
    }
  }

  removeToken(mint) {
    const token = this.tokens.get(mint);
    if (token) {
      token.cleanup();
      this.tokens.delete(mint);
      this.webSocketManager.unsubscribeFromToken(mint);
    }
  }
}

module.exports = TokenTracker;
