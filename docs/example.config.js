export const config = {
  // Price Movement Thresholds
  stateThresholds: {
    heatingUp: 9000, // Initial price increase to consider token heating up (in %)
    firstPump: 18000, // Price increase to consider token pumping (in %)
    dead: 7000, // Price level to consider token dead (in %)
    pumpDrawdown: 30, // Minimum price drop to enter drawdown state (in %)
    recovery: 10, // Price increase needed to consider recovery (in %)
  },

  // Trading Parameters
  trading: {
    initialSOLBalance: 1, // Starting balance in SOL for trading
    positionSize: 0.1, // Size of each position (in SOL)
    transactionFee: 0.002, // Fee per transaction (in SOL)
    slippage: 10, // Expected slippage per trade (in %)
    takeProfitLevel: 40, // Target profit level (in %) if not trailing
    stopLossLevel: 20, // Maximum loss before forced exit (in %) if not trailing
    trailingStopLoss: { enabled: true, percentage: 20 }, // Enable/disable trailing stop loss
    trailingTakeProfit: { enabled: false, percentage: 30 }, // Enable/disable trailing take profit
    takeProfitTiers: {
      enabled: true, // Enable/disable tiered take profit
      tiers: [
        { percentage: 30, portion: 0.4 }, // Exit 40% at 30% profit
        { percentage: 50, portion: 0.4 }, // Exit 40% at 50% profit
        { percentage: 100, portion: 0.2 }, // Hold 20% for moonshots
      ],
    },
  },

  // Risk Management
  safety: {
    maxHolderConcentration: 30, // Max % of supply held by top holders
    topHoldersToCheck: 10, // Number of top holders to analyze
    checkCreatorSoldAll: true, // Check if creator still holds tokens
    minHolders: 25, // Minimum number of holders required
    maxBuyCap: 36000, // Maximum price to enter position
  },

  // Technical Analysis Settings
  technical: {
    rsiPeriod: 14, // Period for RSI calculation
    rsiOverbought: 70, // RSI level to consider overbought
    rsiOversold: 30, // RSI level to consider oversold
    macdFast: 12, // Fast period for MACD
    macdSlow: 26, // Slow period for MACD
    macdSignal: 9, // Signal period for MACD
    volatilityPeriod: 14, // Period for volatility calculation
  },

  // Debug Settings
  debug: {
    logLevel: "info", // Log level (debug, info, warn, error)
    logTrades: true, // Log all trade actions
    logPriceUpdates: false, // Log price updates
    saveTradeHistory: true, // Save trade history to file
  },
};
