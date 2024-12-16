# Token Component Documentation

## Overview

The Token component is the core data structure that represents and manages individual tokens in the Money Printer system. It extends EventEmitter to provide real-time updates on token state changes and maintains comprehensive token metrics including market data, holder information, and volume statistics.

## Core Features

### Token Identification

- Mint address
- Token name and symbol
- Creation timestamp
- URI and metadata
- Bonding curve information

### Market Data Tracking

- Current market cap in SOL
- Historical high market cap
- Bonding curve metrics
  - Tokens in bonding curve
  - SOL in bonding curve
- Token price calculation

### Volume Analytics

```javascript
{
  trades: [],              // Recent trade history
  lastCleanup: timestamp,  // Last data cleanup time
  cleanupInterval: 300000  // 5-minute cleanup interval
}
```

### Holder Management

- Map of holder addresses to balances
- Creator holdings tracking
- Holder concentration analysis
- Top holder calculations

## Key Methods

### Price Calculations

```javascript
calculateTokenPrice();
```

- Computes current token price using bonding curve values
- Updates price tracking metrics
- Used for volume calculations

### Volume Tracking

```javascript
addTrade(amount, timestamp);
getVolume(timeframe); // '1m', '5m', '30m'
```

- Records individual trades
- Calculates volume over specified timeframes
- Maintains rolling trade history
- Automatic data cleanup

### Holder Analysis

```javascript
updateHolder(address, amount);
getHolderCount();
getTopHolderConcentration(count);
```

- Updates holder balances
- Calculates unique holder metrics
- Analyzes top holder concentration

### State Management

```javascript
setState(newState);
```

- Manages token lifecycle states
- Emits state change events
- Updates related metrics (e.g., drawdown tracking)

### Price Analysis

```javascript
updatePriceMetrics();
```

- Updates circular price buffer
- Calculates price acceleration
- Detects pump conditions
- Tracks volume spikes
- Emits price updates with metrics

### Volume Analysis

```javascript
getRecentVolume(timeWindow);
```

- Calculates volume within specified time window
- Uses optimized wallet data structure
- Filters by timestamp for efficiency

## Events

The Token component emits the following events:

- `stateChanged`: When token state transitions
- `holderUpdated`: When holder balances change
- `volumeUpdated`: When new trades are recorded
- `priceUpdate`: Emits price with acceleration and pump metrics
- `volumeSpike`: When significant volume increase detected
- `pumpDetected`: When pump conditions are met

## Data Structure

### Core Properties

```javascript
{
  // Identification
  mint: String,
  name: String,
  symbol: String,
  minted: Timestamp,
  uri: String,

  // Market Data
  vTokensInBondingCurve: Number,
  vSolInBondingCurve: Number,
  marketCapSol: Number,
  currentPrice: Number,

  // State Tracking
  state: String,
  highestMarketCap: Number,
  drawdownLow: Number,

  // Holder Data
  holders: Map<String, Number>,
  creatorInitialHoldings: Number,

  // Price Tracking
  priceBuffer: {
    data: Array(30),    // Fixed-size circular buffer
    head: Number,       // Current buffer position
    size: Number,       // Buffer size (30 data points)
    count: Number       // Current number of entries
  },

  // Pump Metrics
  pumpMetrics: {
    lastPumpTime: Number,      // Timestamp of last pump
    pumpCount: Number,         // Number of pumps detected
    highestGainRate: Number,   // Highest %/second gain rate
    volumeSpikes: Array,       // Volume spike history
    priceAcceleration: Number  // Current price acceleration
  }
}
```

### Volume Data Structure

```javascript
{
  trades: [{
    amount: Number,
    timestamp: Number
  }],
  lastCleanup: Timestamp,
  cleanupInterval: Number
}
```

### Wallet Data Structure

```javascript
wallets: Map<String, {
  balance: Number,
  initialBalance: Number,
  trades: Array,
  firstSeen: Number,
  lastActive: Number,
  isCreator: Boolean
}>
```

## Integration Points

### TokenTracker

- Receives token updates
- Manages token lifecycle
- Coordinates state transitions

### Dashboard

- Displays token metrics
- Shows volume statistics
- Presents holder information

### SafetyChecker

- Analyzes holder concentration
- Monitors creator activity
- Validates token safety

## Error Handling

1. **Data Validation**

   - Validates input parameters
   - Ensures numeric values are positive
   - Handles missing or invalid data

2. **State Transitions**

   - Validates state changes
   - Maintains state consistency
   - Logs invalid transitions

3. **Volume Calculations**
   - Handles edge cases
   - Manages timeframe boundaries
   - Validates trade data

## Best Practices

1. **Data Management**

   - Regular cleanup of old trade data
   - Efficient holder balance updates
   - Proper event emission

2. **Performance**

   - Optimized volume calculations
   - Efficient holder analysis
   - Cached calculations where appropriate

3. **State Consistency**
   - Atomic state updates
   - Proper event ordering
   - Synchronized holder updates

## Performance Optimizations

### Circular Buffer
- O(1) price updates
- Constant memory usage
- Efficient historical analysis

### Pump Detection
- Real-time price acceleration tracking
- Volume spike correlation
- Pattern recognition for pump dynamics

### Memory Management
- Automatic data cleanup
- Optimized data structures
- Efficient event handling

## Configuration

Key configuration parameters:

```javascript
{
  volume: {
    cleanupInterval: 300000,  // 5 minutes
    timeframes: ['1m', '5m', '30m']
  },
  holders: {
    maxConcentration: 80,     // 80%
    minHolders: 10
  },
  BUFFER_SIZE: 30,            // Price buffer size
  PUMP_THRESHOLD: 25,         // % increase for pump
  MIN_VOLUME_SPIKE: 200,      // % increase for volume spike
  CLEANUP_INTERVAL: 300000    // 5-minute data cleanup
}
```

## Position Management Integration

The Token component now integrates with the position management system for trading operations.

### Position Class

```javascript
class Position {
  constructor({
    token,
    entryPrice,
    size
  }) {
    this.token = token;
    this.entryPrice = entryPrice;
    this.size = size;
  }

  update(price, volume) {
    // Update position state
  }

  getHealth() {
    // Calculate position health
  }
}
```

### Token Class

```javascript
class Token {
  // ...

  addPosition(position) {
    // Add position to token
  }

  removePosition(position) {
    // Remove position from token
  }

  updatePositionState(position, state) {
    // Update position state
  }

  getActivePositions() {
    // Get active positions
  }
}
```

### Integration Example

```javascript
const token = new Token({
  mint: 'So11111111111111111111111111111111111111112',
  name: 'Wrapped SOL',
  symbol: 'SOL',
  decimals: 9
});

const position = new Position({
  token,
  entryPrice: 1.5,
  size: 2.0
});

token.addPosition(position);

// Update token state
token.updatePrice(1.5);
token.updateVolume(10000);

// Get token metrics
const metrics = token.getPerformanceStats();
const risk = token.calculateRiskMetrics();
const health = token.analyzeTokenHealth();
