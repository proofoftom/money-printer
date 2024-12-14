# TokenTracker Component

## Overview

The TokenTracker component is responsible for monitoring and managing the lifecycle of tokens, from discovery to position exit. It integrates with the PumpPortal WebSocket API to receive real-time trade data and broadcasts state changes to connected dashboard clients.

## Token Lifecycle

### 1. Initial Discovery & Pumping Phase

- New token is discovered
- Token enters "heating up" state when market cap reaches `config.thresholds.heatingUp`
- Token enters "first pump" state when market cap reaches `config.thresholds.firstPump`
- During pumping, tracks peak price

### 2. Drawdown Phase

- Enters drawdown when price drops by `config.thresholds.drawdown` percentage from peak
- During drawdown:
  - Exits pumping state
  - Tracks drawdown low price
  - Monitors for recovery

### 3. Recovery & Security Check Phase

- Recovery is triggered when price increases by `config.thresholds.recovery` percentage from drawdown low
- Upon recovery:
  1. Run security checks (via SafetyChecker)
  2. If security checks PASS:
     - Enter position at current price
     - Begin monitoring for take profit
  3. If security checks FAIL:
     - Return to recovery state
     - Track new price peaks
     - Monitor for next drawdown
     - Repeat drawdown/recovery cycle until either:
       a) Security checks pass and position is opened
       b) Token dies (price drops below `config.thresholds.dead`)

### 4. Position Management Phase

- Once position is opened:
  1. Monitor for take profit target (`config.thresholds.takeProfitTarget`)
  2. When take profit is hit:
     - If `config.trading.trailingTakeProfit` is enabled:
       - Enter take profit state
       - Track new highs after take profit
       - Exit on trailing drawdown (`config.thresholds.trailDrawdown`)
     - If `config.trading.trailingTakeProfit` is disabled:
       - Exit position immediately at take profit target
  3. Monitor for stop loss (`config.thresholds.stopLoss`)

Note: The system uses either trailing take profit OR fixed take profit exclusively, based on the `trailingTakeProfit` configuration. Both mechanisms cannot be active simultaneously.

### 5. Position Exit

Positions can be closed for several reasons:

- Take profit target hit (with or without trailing stop)
- Stop loss triggered
- Token death (price drops below `config.thresholds.deadToken`)

## State Management

The TokenTracker uses TokenState to maintain various sets and maps:

- `newTokens`: Recently discovered tokens
- `heatingUp`: Tokens showing initial price momentum
- `firstPump`: Tokens in first pump phase
- `inDrawdown`: Tokens in drawdown phase
- `inRecovery`: Tokens recovering from drawdown
- `inUnsafeRecovery`: Tokens recovering but not meeting safety criteria
- `pumpPeaks`: Track highest price during pump
- `allTimeHighs`: Track highest price ever
- `drawdownLows`: Track lowest price during drawdown
- `openPositions`: Currently active positions
- `closedPositions`: Historical position data
- `inTakeProfit`: Tokens that have hit take profit target
- `trailingPeaks`: Track highest price after take profit for trailing stop

## Configuration

Key configuration parameters that control the token lifecycle:

```javascript
{
  thresholds: {
    heatingUp: 9000, // Initial market cap threshold to consider token heating up (in USD)
    firstPump: 12000, // Market cap threshold to consider token pumping (in USD)
    dead: 7000, // Market cap threshold to consider token dead (in USD)
    pumpDrawdown: 30, // Minimum price drop to enter drawdown state (in %)
    recovery: 10, // Price increase needed to consider recovery (in %)
    takeProfitTiers: [
      { percentage: 30, portion: 0.4 }, // Exit 40% at 30% profit
      { percentage: 50, portion: 0.4 }, // Exit 40% at 50% profit
      { percentage: 100, portion: 0.2 }, // Hold 20% for moonshots
    ],
    trailDrawdown: 30, // How far price can drop from peak before selling (in %)
  },
  trading: {
    trailingTakeProfit: true,  // Enable/disable trailing take profit
    trailingStopLoss: true,  // Enable/disable trailing stop loss
  }
}
```

## Safety Checks

The TokenTracker uses SafetyChecker to validate tokens before position entry:

- Holder concentration checks
- Minimum holder requirements
- Creator holding verification

These checks are performed after each recovery until they pass or the token dies.

## Safety Checks

### Holder Concentration

```javascript
maxHolderConcentration: 30; // Maximum percentage for top 10 holders
```

### Creator Holding

```javascript
checkCreatorHolding: true; // Check if creator has sold all tokens
```

### Minimum Holders

```javascript
minHolders: 30; // Minimum number of unique holders required
```

## Position Management

Position management is now handled by the PositionManager class, which is responsible for opening and closing positions based on configured strategies. This includes trailing stop loss and take profit mechanisms.

The TokenTracker delegates position-related operations to the PositionManager, ensuring a clear separation of concerns and streamlined management of trading strategies.

## Broadcasting

### Token Updates

```javascript
{
  type: "tokenUpdate",
  data: {
    mint: string,
    state: "heatingUp|pumping|drawdown|dead",
    marketCap: number,
    position?: object
  }
}
```

### Position Updates

```javascript
{
  type: "positionUpdate",
  data: {
    mint: string,
    position: {
      entryPrice: number,
      exitPrice: number,
      pnl: number,
      isWin: boolean
    },
    accountBalance: number,
    wins: number,
    losses: number
  }
}
```

## Logging Format

### Token State Changes

- New Token: `New token created: [mint]`
- Heating Up: `Token [mint] is heating up! Market cap: [marketCap] USD`
- Pumping: `Token [mint] is pumping! Market cap: [marketCap] USD`
- Drawdown: `Token [mint] in drawdown. Market cap: [marketCap] USD`
- Recovery: `Token [mint] has recovered! Market cap: [marketCap] USD`
- Dead: `Token [mint] has died. Market cap ([marketCap] USD) fell below [threshold] USD`

### Position Updates

- Entry: `Entering position for token [mint] at [marketCap] USD`
- Take Profit: `Token [mint] hit take profit target! Market cap: [marketCap] USD`
- Stop Loss: `Token [mint] hit stop loss. Market cap: [marketCap] USD`
- Stats: `Trading Statistics: Total Trades: [total], Win Rate: [rate]%, Total Profit: $[profit]`

## Suggestions for Improvement

- Ensure the configuration parameters are flexible and well-documented, especially for thresholds and trading strategies.
- Consider adding more detailed logging for state transitions to aid in debugging and monitoring.
