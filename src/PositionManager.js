const EventEmitter = require("events");
const Position = require("./Position");

class PositionManager extends EventEmitter {
  constructor({
    wallet,
    exitStrategies,
    priceManager,
    logger,
    config,
    analytics,
    safetyChecker,
  }) {
    super();
    this.wallet = wallet;
    this.exitStrategies = exitStrategies;
    this.priceManager = priceManager;
    this.logger = logger;
    this.config = config;
    this.analytics = analytics;
    this.safetyChecker = safetyChecker;
    this.position = null;
    this._tradingEnabled = true;
  }

  initialize(tokenTracker) {
    this.tokenTracker = tokenTracker;

    // Listen for tokens that are ready for positions
    this.tokenTracker.on("tokenAdded", (token) => {
      token.on(
        "readyForPosition",
        async ({ token, metrics, suggestedSize }) => {
          await this.handleReadyForPosition(token, metrics, suggestedSize);
        }
      );
    });
  }

  async handleReadyForPosition(token, metrics, suggestedSize) {
    if (!this.isTradingEnabled()) {
      this.logger.info("Trading is disabled, cannot open position");
      return;
    }

    if (this.position && this.position.state !== Position.STATES.CLOSED) {
      this.logger.info(`Active position exists for ${this.position.symbol}`);
      return;
    }

    // Run safety checks
    const { safe, reasons } = await this.safetyChecker.isTokenSafe(token);
    if (!safe) {
      this.logger.warn("Failed safety check before opening position", {
        mint: token.mint,
        reasons,
      });
      return;
    }

    try {
      const position = new Position(token, this.priceManager);

      const success = await position.open(token.currentPrice, suggestedSize);
      if (success) {
        this.position = position;
        this.logger.info("Opened position", {
          mint: token.mint,
          price: token.currentPrice,
          size: suggestedSize,
          metrics,
        });

        // Handle position updates and closure
        this.setupPositionListeners(token, position);
      }
    } catch (error) {
      this.logger.error("Error opening position", {
        mint: token.mint,
        error: error.message,
      });
    }
  }

  setupPositionListeners(token, position) {
    // Update position price on each token price update
    token.on("priceUpdate", ({ price }) => {
      if (position && position.state === "OPEN") {
        position.updatePrice(price);

        // Check exit conditions
        const exitSignals = this.exitStrategies.checkExitSignals(position);
        if (exitSignals.shouldExit) {
          this.closePosition(exitSignals.reason);
        }
      }
    });

    // Handle position close
    position.on("closed", (positionState) => {
      this.logger.info("Position closed", {
        mint: token.mint,
        reason: positionState.closeReason,
        roi: positionState.roiPercentage,
        pnl: positionState.realizedPnLSol,
      });

      // Clean up position
      this.position = null;
    });
  }

  isTradingEnabled() {
    return this._tradingEnabled;
  }

  pauseTrading() {
    this._tradingEnabled = false;
    this.logger?.info("Trading paused");
  }

  resumeTrading() {
    this._tradingEnabled = true;
    this.logger?.info("Trading resumed");
  }

  calculatePositionSize(token) {
    const walletBalance = this.wallet.getBalance();
    const maxRiskAmount = walletBalance * this.config.RISK_PER_TRADE;
    const maxMcapAmount = token.marketCapSol * this.config.MAX_MCAP_POSITION;
    return Math.min(maxRiskAmount, maxMcapAmount);
  }

  closePosition(reason = "manual") {
    if (!this.position || this.position.state === Position.STATES.CLOSED) {
      return false;
    }

    try {
      const success = this.position.close(reason);
      if (success) {
        this.emit("positionClosed", { position: this.position, reason });
        if (this.analytics) {
          this.analytics.trackTrade(this.position);
        }
      }
      return success;
    } catch (error) {
      this.logger?.error("Failed to close position:", error);
      if (this.analytics) {
        this.analytics.trackError("trading");
      }
      return false;
    }
  }

  closeAllPositions(reason = "emergency") {
    if (!this.position) {
      return true;
    }
    return this.closePosition(reason);
  }
}

module.exports = PositionManager;
