const { EventEmitter } = require("events");

const STATES = {
  NEW: "NEW",
  READY: "READY",
  UNSAFE: "UNSAFE",
  DEAD: "DEAD",
};

class Token extends EventEmitter {
  constructor(tokenData, { priceManager, safetyChecker, logger, config }) {
    super();

    // Validate required token data
    const requiredFields = [
      "mint",
      "symbol",
      "vTokensInBondingCurve",
      "vSolInBondingCurve",
      "marketCapSol",
    ];

    for (const field of requiredFields) {
      if (!tokenData[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate numeric fields
    const numericFields = [
      "vTokensInBondingCurve",
      "vSolInBondingCurve",
      "marketCapSol",
    ];
    for (const field of numericFields) {
      if (typeof tokenData[field] !== "number" || isNaN(tokenData[field])) {
        throw new Error(`Invalid numeric value for field: ${field}`);
      }
    }

    // Validate dependencies
    if (!safetyChecker || !logger || !config) {
      throw new Error("Missing required dependencies");
    }

    this.mint = tokenData.mint;
    this.name = tokenData.name;
    this.symbol = tokenData.symbol;
    this.createdAt = Date.now();
    this.minted = tokenData.minted;
    this.traderPublicKey = tokenData.traderPublicKey;
    this.bondingCurveKey = tokenData.bondingCurveKey;
    this.vTokensInBondingCurve = tokenData.vTokensInBondingCurve;
    this.vSolInBondingCurve = tokenData.vSolInBondingCurve;
    this.marketCapSol = tokenData.marketCapSol;
    this.totalSupplyOutsideCurve = 0;
    this.holders = new Map();
    this.totalSupply = this.calculateTotalSupply();

    // Price tracking
    this.currentPrice = this.calculateTokenPrice();
    this.initialPrice = this.currentPrice;
    this.highestPrice = this.currentPrice;
    this.highestPriceTime = Date.now();
    this.highestMarketCap = this.marketCapSol;
    this.priceHistory = [];

    // Trade tracking
    this.volume = 0;
    this.tradeCount = 0;
    this.lastTradeType = null;
    this.lastTradeAmount = null;
    this.lastTradeTime = null;

    // Dependencies
    this.priceManager = priceManager;
    this.safetyChecker = safetyChecker;
    this.logger = logger;
    this.config = config;

    // State
    this.state = STATES.NEW;

    // Start safety checks
    this.safetyCheckInterval = setInterval(
      () => this.checkSafetyConditions(),
      this.config.SAFETY_CHECK_INTERVAL
    );

    this.logger.info("Token initialized", {
      mint: this.mint,
      symbol: this.symbol,
      price: this.currentPrice,
      marketCapSol: this.marketCapSol,
    });
  }

  calculateTokenPrice() {
    if (this.vTokensInBondingCurve === 0) return 0;
    return this.vSolInBondingCurve / this.vTokensInBondingCurve;
  }

  calculateTotalSupply() {
    const totalHolderSupply = Array.from(this.holders.values()).reduce(
      (a, b) => a + b,
      0
    );
    return this.vTokensInBondingCurve + totalHolderSupply;
  }

  update(tradeData) {
    try {
      // Validate required trade data
      const requiredFields = [
        "txType",
        "tokenAmount",
        "vTokensInBondingCurve",
        "vSolInBondingCurve",
        "marketCapSol",
        "newTokenBalance",
        "traderPublicKey",
      ];

      for (const field of requiredFields) {
        if (field === "newTokenBalance" && tradeData[field] === 0) {
          continue; // Allow zero balance
        }
        if (!tradeData[field]) {
          throw new Error(`Missing required trade data field: ${field}`);
        }
      }

      // Validate numeric fields
      const numericFields = [
        "tokenAmount",
        "vTokensInBondingCurve",
        "vSolInBondingCurve",
        "marketCapSol",
      ];
      for (const field of numericFields) {
        if (typeof tradeData[field] !== "number" || isNaN(tradeData[field])) {
          throw new Error(
            `Invalid numeric value for trade data field: ${field}`
          );
        }
      }

      // Update trade metrics
      this.lastTradeType = tradeData.txType;
      this.lastTradeAmount = tradeData.tokenAmount;
      this.lastTradeTime = Date.now();
      this.volume += tradeData.tokenAmount;
      this.tradeCount++;

      // Update market metrics
      this.vTokensInBondingCurve = tradeData.vTokensInBondingCurve;
      this.vSolInBondingCurve = tradeData.vSolInBondingCurve;
      this.marketCapSol = tradeData.marketCapSol;
      this.totalSupply = this.calculateTotalSupply();

      // Update price metrics
      this.currentPrice = this.calculateTokenPrice();
      if (this.currentPrice > this.highestPrice) {
        this.highestPrice = this.currentPrice;
        this.highestPriceTime = Date.now();
      }
      if (this.marketCapSol > this.highestMarketCap) {
        this.highestMarketCap = this.marketCapSol;
      }

      // Add to price history
      this.priceHistory.push({
        price: this.currentPrice,
        marketCapSol: this.marketCapSol,
        timestamp: Date.now(),
      });

      // Update holder balance
      this.updateHolderBalance(
        tradeData.traderPublicKey,
        tradeData.newTokenBalance
      );

      // Emit trade event with WebSocket-compatible structure
      // THIS IS THE EXACT STRUCTURE, DO NOT CHANGE UNLESS YOU KNOW WHAT YOU ARE DOING
      this.emit("trade", {
        txType: tradeData.txType,
        signature: tradeData.signature,
        mint: this.mint,
        traderPublicKey: tradeData.traderPublicKey,
        tokenAmount: tradeData.tokenAmount,
        newTokenBalance: tradeData.newTokenBalance,
        bondingCurveKey: tradeData.bondingCurveKey,
        vTokensInBondingCurve: this.vTokensInBondingCurve,
        vSolInBondingCurve: this.vSolInBondingCurve,
        marketCapSol: this.marketCapSol,
      });

      this.emit("updated", this);

      this.logger.debug("Token updated", {
        mint: this.mint,
        txType: tradeData.txType,
        price: this.currentPrice,
        marketCapSol: this.marketCapSol,
      });
    } catch (error) {
      this.logger.error("Error updating token", {
        mint: this.mint,
        error: error.message,
        tradeData,
      });
      throw error;
    }
  }

  updateHolderBalance(traderPublicKey, newBalance) {
    if (newBalance === 0) {
      this.holders.delete(traderPublicKey);
    } else {
      this.holders.set(traderPublicKey, newBalance);
    }
    this.totalSupply = this.calculateTotalSupply();
  }

  getHolderBalance(traderPublicKey) {
    return this.holders.get(traderPublicKey) || 0;
  }

  getHolderCount() {
    return this.holders.size;
  }

  getTopHolderConcentration(topNHolders = 10) {
    if (this.totalSupply === 0) return 0;

    const topNHoldings = Array.from(this.holders.values())
      .sort((a, b) => b - a)
      .slice(0, topNHolders)
      .reduce((a, b) => a + b, 0);

    return (topNHoldings / this.totalSupply) * 100;
  }

  checkSafetyConditions() {
    try {
      const { safe, reasons } = this.safetyChecker.isTokenSafe(this);
      const previousState = this.state;

      if (safe && this.state === STATES.NEW) {
        this.state = STATES.READY;
      } else if (!safe && this.state !== STATES.DEAD) {
        this.state = STATES.UNSAFE;
      }

      // Check for dead state based on drawdown
      if (this.getDrawdownPercentage() >= 90) {
        this.state = STATES.DEAD;
      }

      if (this.state !== previousState) {
        this.emit("stateChanged", {
          from: previousState,
          to: this.state,
          token: this,
          reasons,
        });

        if (this.state === STATES.READY) {
          this.emit("readyForPosition", { token: this });
        }

        this.logger.info("Token state changed", {
          mint: this.mint,
          from: previousState,
          to: this.state,
          reasons,
        });
      }
    } catch (error) {
      this.logger.error("Error checking safety conditions", {
        mint: this.mint,
        error: error.message,
      });
      // Don't throw here as this is called from an interval
    }
  }

  getDrawdownPercentage() {
    if (this.highestMarketCap === 0) return 0;
    return (
      ((this.highestMarketCap - this.marketCapSol) / this.highestMarketCap) *
      100
    );
  }

  cleanup() {
    try {
      if (this.safetyCheckInterval) {
        clearInterval(this.safetyCheckInterval);
      }
      this.removeAllListeners();
      this.logger.debug("Token cleaned up", { mint: this.mint });
    } catch (error) {
      this.logger.error("Error cleaning up token", {
        mint: this.mint,
        error: error.message,
      });
    }
  }
}

module.exports = { Token, STATES };
