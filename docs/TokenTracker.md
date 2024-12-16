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

- New Token: `New token minted: [mint]`
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

## Token Tracker Documentation

### Overview

The Token Tracker is the central coordinator of the Money Printer system, managing token lifecycle, state transitions, and integrating with various components for comprehensive token monitoring and trading operations. It extends EventEmitter to provide event-based communication throughout the system.

### Core Components

#### Token Management

```javascript
{
  tokens: Map(),             // Active tokens
  safetyChecker: Object,     // Safety validation
  positionManager: Object,   // Position handling
  priceManager: Object,      // Price calculations
  errorLogger: Object        // Error tracking
}
```

### Key Features

#### Token Lifecycle Management

```javascript
handleNewToken(tokenData);
handleTokenUpdate(tradeData);
```

- Token creation and tracking
- State transition management
- Event broadcasting
- Error handling

#### Trade Processing

```javascript
processTradeUpdate(token, tradeData);
```

- Volume tracking
- Price updates
- Market cap calculations
- State evaluations

#### State Management

```javascript
evaluateTokenState(token);
```

- State transition logic
- Condition evaluation
- Safety validation
- Position management

### Token States

1. **New**

   - Initial token discovery
   - Basic validation
   - Metadata collection

2. **Heating Up**

   - Market cap monitoring
   - Volume analysis
   - Initial safety checks

3. **First Pump**

   - Price momentum tracking
   - Volume confirmation
   - Pattern recognition

4. **Drawdown**

   - Price retracement tracking
   - Volume analysis
   - Recovery potential

5. **Pumping**

   - Sustained momentum
   - Safety validation
   - Entry conditions

6. **In Position**
   - Active position monitoring
   - Exit condition tracking
   - Performance analysis

### Event System

#### Emitted Events

- `tokenAdded`: New token discovered
- `tokenStateChanged`: State transitions
- `tokenUpdated`: Trade updates
- `error`: Processing errors

#### Event Data Structure

```javascript
{
  token: Token,          // Token instance
  from: String,          // Previous state
  to: String,           // New state
  metadata: Object      // Additional data
}
```

### Integration Points

#### Safety Checker

- Token validation
- Risk assessment
- Safety monitoring

#### Position Manager

- Trade execution
- Position tracking
- Exit management

#### Price Manager

- Price calculations
- Market cap updates
- Value conversions

#### Error Logger

- Error tracking
- Debug information
- Performance monitoring

### Configuration Options

```javascript
{
  THRESHOLDS: {
    HEATING_UP: Number,
    FIRST_PUMP: Number,
    DRAWDOWN: Number,
    DEAD: Number
  },
  TIMEOUTS: {
    NEW: Number,
    HEATING_UP: Number,
    FIRST_PUMP: Number
  },
  SAFETY: {
    // Safety check configuration
  }
}
```

### Error Handling

#### Token Processing

1. **Creation Errors**

   - Data validation
   - Initialization
   - Event setup

2. **Update Errors**

   - Trade processing
   - State transitions
   - Position management

3. **State Errors**
   - Invalid transitions
   - Condition evaluation
   - Safety checks

### Best Practices

#### Token Management

1. **State Transitions**

   - Validate conditions
   - Ensure consistency
   - Handle edge cases

2. **Event Handling**

   - Proper event ordering
   - Error propagation
   - Resource cleanup

3. **Performance**
   - Efficient updates
   - Memory management
   - Event optimization

#### Integration

1. **Component Communication**

   - Clear interfaces
   - Error handling
   - State synchronization

2. **Data Flow**
   - Consistent updates
   - Validation chain
   - Error recovery

### Future Improvements

1. **State Management**

   - Advanced state machines
   - Transition validation
   - History tracking

2. **Performance**

   - Batch processing
   - Event optimization
   - Memory efficiency

3. **Analytics**
   - Pattern recognition
   - Performance metrics
   - Strategy optimization

## Token Tracker

The `TokenTracker` class orchestrates token state management and coordinates updates between tokens, positions, and other system components in the Money Printer system.

## Features

- Token state management
- Position coordination
- Price update handling
- Volume tracking
- Market monitoring
- Event coordination
- Performance tracking
- Risk management

## Class Structure

### Constructor
```javascript
constructor({
  config,
  statsLogger,
  eventEmitter,
  positionManager
}) {
  this.config = config;
  this.statsLogger = statsLogger;
  this.eventEmitter = eventEmitter;
  this.positionManager = positionManager;
  
  this.tokens = new Map();
  this.priceFeeds = new Map();
  this.metrics = new TrackerMetrics();
  
  this.initialize();
}
```

### Core Methods

#### Token Management
```javascript
addToken(token)
removeToken(token)
getToken(mint)
getAllTokens()
```

#### State Management
```javascript
updateTokenState(mint, update)
batchUpdateTokens(updates)
validateTokenStates()
```

#### Position Coordination
```javascript
handlePositionOpen(position)
handlePositionUpdate(position)
handlePositionClose(position)
validatePositionStates()
```

#### Market Analysis
```javascript
analyzeMarketConditions()
calculateCorrelations()
assessLiquidity()
evaluateRisk()
```

## Events

### Token Events
- `tokenAdded`: New token tracked
- `tokenRemoved`: Token removed
- `tokenUpdated`: Token state changed
- `tokenAlert`: Token alert triggered

### Position Events
- `positionOpened`: New position created
- `positionUpdated`: Position changed
- `positionClosed`: Position closed
- `positionAlert`: Position alert triggered

### Market Events
- `marketUpdate`: Market conditions
- `liquidityAlert`: Liquidity changes
- `correlationAlert`: Correlation changes
- `riskAlert`: Risk threshold breach

### System Events
- `stateValidated`: State validation
- `metricsUpdated`: New metrics
- `error`: Error occurred

## Integration

### With Token Class
```javascript
// Handle token updates
async handleTokenUpdate(token, update) {
  // Update token state
  await token.updateState(update);
  
  // Update positions
  for (const position of token.getActivePositions()) {
    await this.positionManager.updatePosition(
      position.id,
      update.price,
      update.volume
    );
  }
  
  // Update metrics
  this.metrics.updateTokenMetrics(token);
  
  // Emit events
  this.emit('tokenUpdated', {
    token: token.mint,
    update,
    positions: token.activePositions.size
  });
}
```

### With PositionManager
```javascript
// Handle position events
handlePositionEvent(event) {
  const { position, type } = event;
  const token = this.getToken(position.token.mint);
  
  switch (type) {
    case 'open':
      token.addPosition(position);
      break;
    case 'update':
      token.updatePositionState(position);
      break;
    case 'close':
      token.removePosition(position);
      break;
  }
  
  this.validateTokenState(token);
}
```

## Example Usage

```javascript
// Initialize tracker
const tracker = new TokenTracker({
  config,
  statsLogger,
  eventEmitter,
  positionManager
});

// Add token
const token = new Token({
  mint: 'So11111111111111111111111111111111111111112',
  name: 'Wrapped SOL',
  symbol: 'SOL',
  decimals: 9
});
tracker.addToken(token);

// Update token state
await tracker.updateTokenState(token.mint, {
  price: 1.5,
  volume: 10000,
  timestamp: Date.now()
});

// Handle position
const position = await positionManager.openPosition(token, 1.5, 2.0);
tracker.handlePositionOpen(position);

// Get market analysis
const market = tracker.analyzeMarketConditions();
const risk = tracker.evaluateRisk();
```

## Configuration

```javascript
{
  TOKEN_TRACKER: {
    UPDATE_INTERVAL: 60000,
    BATCH_SIZE: 100,
    VALIDATION_INTERVAL: 300000,
    PRICE_FEEDS: {
      PRIMARY: 'jupiter',
      BACKUP: 'birdeye'
    },
    MARKET_ANALYSIS: {
      CORRELATION_WINDOW: 24,
      LIQUIDITY_THRESHOLD: 10000,
      RISK_CHECK_INTERVAL: 300000
    },
    POSITION_TRACKING: {
      MAX_POSITIONS_PER_TOKEN: 5,
      STATE_VALIDATION_INTERVAL: 60000
    },
    METRICS: {
      UPDATE_INTERVAL: 60000,
      HISTORY_LENGTH: 1000
    }
  }
}
```

## Error Handling

```javascript
try {
  await this.updateTokenState(mint, update);
} catch (error) {
  this.emit('error', {
    error,
    context: 'tokenUpdate',
    token: mint
  });
  
  // Attempt recovery
  await this.recoverTokenState(mint);
}
```

## Performance Optimization

1. Batch Processing
```javascript
async processBatch(updates) {
  const batch = new Map();
  for (const update of updates) {
    batch.set(update.token, {
      price: update.price,
      volume: update.volume
    });
  }
  await this.batchUpdateTokens(batch);
}
```

2. Efficient Updates
```javascript
optimizeUpdates() {
  // Group updates by token
  const groups = new Map();
  for (const update of this.pendingUpdates) {
    const group = groups.get(update.token) || [];
    group.push(update);
    groups.set(update.token, group);
  }
  
  // Process groups
  for (const [token, updates] of groups) {
    this.processTokenUpdates(token, updates);
  }
}
```

## Market Analysis

### Correlation Analysis
```javascript
calculateCorrelations() {
  const correlations = new Map();
  for (const [mintA, tokenA] of this.tokens) {
    for (const [mintB, tokenB] of this.tokens) {
      if (mintA !== mintB) {
        correlations.set(
          `${mintA}-${mintB}`,
          this.calculateTokenCorrelation(tokenA, tokenB)
        );
      }
    }
  }
  return correlations;
}
```

### Liquidity Assessment
```javascript
assessLiquidity() {
  return Array.from(this.tokens.values())
    .map(token => ({
      token: token.mint,
      liquidity: token.calculateLiquidity(),
      depth: token.getMarketDepth(),
      risk: this.calculateLiquidityRisk(token)
    }));
}
```

## Best Practices

1. Regular state validation
2. Efficient updates
3. Error handling
4. Event coordination
5. Performance monitoring
6. Risk management
7. Security measures
8. Documentation maintenance

## Security Considerations

1. Input validation
2. State integrity
3. Access control
4. Event validation
5. Error handling
6. Rate limiting
7. Data encryption
8. Audit logging
