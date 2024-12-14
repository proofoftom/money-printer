module.exports = {
  // WebSocket configuration
  WEBSOCKET: {
    URL: "wss://pumpportal.fun/data-api/real-time",
    RECONNECT_TIMEOUT: 5000, // 5 seconds
  },

  // Position sizing
  POSITION: {
    SIZE_SOL: 0.1, // Default position size in SOL
    MIN_SIZE_SOL: 0.05, // Minimum position size
    MAX_SIZE_SOL: 1.0, // Maximum position size
  },

  // Market thresholds
  THRESHOLDS: {
    HEATING_UP: 9000, // Market cap in SOL to consider token heating up
    FIRST_PUMP: 12000, // Market cap in SOL to consider first pump
    DEAD: 7000, // Market cap in SOL to consider token dead
    PUMP_DRAWDOWN: 30, // Percentage drawdown to enter drawdown phase
    RECOVERY: 10, // Percentage recovery from drawdown low to consider recovery
    TRAIL_DRAWDOWN: 30, // Percentage drawdown from peak to trigger trailing stop
  },

  // Take profit configuration
  TAKE_PROFIT: {
    ENABLED: true,
    TRAILING: true, // Use trailing take profit
    TIERS: [
      { percentage: 30, portion: 0.4 }, // Take 40% profit at 30% gain
      { percentage: 50, portion: 0.4 }, // Take 40% profit at 50% gain
      { percentage: 100, portion: 0.2 }, // Take final 20% at 100% gain
    ],
  },

  // Safety checks
  SAFETY: {
    MIN_LIQUIDITY_SOL: 5, // Minimum SOL in bonding curve
    MAX_PRICE_IMPACT: 10, // Maximum price impact percentage
    MIN_HOLDERS: 10, // Minimum number of token holders
    MAX_CREATOR_OWNERSHIP: 50, // Maximum percentage owned by creator
  },

  // Trading hours (UTC)
  TRADING: {
    ENABLED: true,
    START_HOUR: 0, // 24-hour format
    END_HOUR: 24, // 24-hour format
    WEEKEND_TRADING: true,
  },

  // Risk management
  RISK: {
    MAX_CONCURRENT_POSITIONS: 5,
    MAX_DAILY_LOSS_SOL: 1,
    MAX_POSITION_SOL: 0.5,
    DAILY_RESET_HOUR: 0, // UTC hour to reset daily stats
  },
};
