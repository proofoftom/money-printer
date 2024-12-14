# TokenState Component Documentation

## Overview

TokenState manages the complete lifecycle state of tokens, providing efficient data structures for tracking various token states and metrics.

## Data Structures

### Token Status Sets

```javascript
class TokenState {
  newlyCreated = new Set(); // Newly minted tokens
  heatingUp = new Set(); // Tokens that are showing initial signs of activity
  inFirstPumpPhase = new Set(); // Tokens that are in their first pump phase
  inFirstDrawdown = new Set(); // Tokens that have entered their first drawdown phase
  inUnsafeRecovery = new Set(); // Tokens recovering but not meeting safety criteria
  inUnsafeDrawdown = new Set(); // Tokens recovering but not meeting safety criteria
  inPosition = new Set(); // Tokens that are currently in a trading position
}
```

### Price Tracking Maps

```javascript
class TokenState {
  marketCap = new Map(); // Current market cap for each token
  pumpPeaks = new Map(); // Highest price points during initial pump phase
  trailingPeaks = new Map(); // Highest price points after position entry (for trailing take profit)
  drawdownLows = new Map(); // Lowest price points during drawdown phases
  allTimeHighs = new Map(); // All-time high prices for each token
}
```

### Position Management Maps

```javascript
class TokenState {
  openPositions = new Map(); // Currently active trading positions
  closedPositions = new Map(); // Historical trading positions
}
```

## Lifecycle

1. **New Mint**: Tokens start in the `new` state when they are first minted.
2. **Heating Up**: Tokens transition to the `heatingUp` state when they show initial signs of activity.
3. **First Pump**: Tokens move to the `inFirstPump` state during their first significant price increase.
4. **First Drawdown**: Tokens enter the `inFirstDrawdown` state after their first pump when prices start to fall.
5. **Drawdown**: Tokens transition to the `inDrawdown` state during subsequent price declines.
6. **Recovery**: Tokens may enter the `unsafeRecovery` state if they begin to recover but do not meet all safety criteria.
7. **In Position**: Tokens are in the `inPosition` state when they are actively traded.

## State Management

### Active State Detection

```javascript
checkActive(mint);
```

Checks if a token is in any active state:

- Heating up
- Pumping
- In drawdown
- Has open positions

### State Cleanup

```javascript
cleanup(mint);
```

Responsibilities:

- Removes token data from all collections
- Unsubscribes from WebSocket updates

## Methods

### constructor()

Initializes a new TokenState instance with empty collections.

### cleanup(mint)

Removes all state data for a specific token except its dead status.

Parameters:

- `mint`: The token mint address to clean up

## Usage Patterns

### 1. Token Creation

```javascript
// Add new token
newTokens.add(mint);
marketCap.set(mint, initialMarketCap);
```

### 2. Holder Management

```javascript
// Update holder balances
if (!holders.has(mint)) {
  holders.set(mint, new Map());
}
const tokenHolders = holders.get(mint);
tokenHolders.set(holder, balance);
```

### 3. State Transitions

```javascript
// Transition to heating up
newTokens.delete(mint);
heatingUp.add(mint);

// Transition to pumping
heatingUp.delete(mint);
inFirstPump.add(mint);
```

### 4. Position Tracking

```javascript
// Open position
openPositions.set(mint, {
  size: positionSize,
  entryPrice: marketCap,
  timestamp: new Date().toISOString(),
});

// Close position
closedPositions.set(mint, {
  entry: position.entryPrice,
  exit: marketCap,
  profit: calculatedProfit,
  reason: closeReason,
  timestamp: new Date().toISOString(),
});
```

## State Transitions

### Take Profit Handling

1. When a token hits take profit:
   - If trailing take profit is enabled:
     - Token enters `inTakeProfit` set
     - Peak price tracked in `trailingPeaks`
   - If trailing take profit is disabled:
     - Position is closed immediately
     - Token state is cleaned up

### Peak Tracking

- `pumpPeaks`: Used to track highest prices during initial pump phase
- `trailingPeaks`: Used specifically for trailing take profit after position entry

## Best Practices

### 1. Data Consistency

- Always update related collections together
- Use atomic operations for state transitions
- Maintain referential integrity

### 2. Memory Management

- Clean up unused data promptly
- Keep dead tokens for reference
- Remove stale holder data

### 3. State Validation

- Check for active states before transitions
- Validate market cap updates
- Verify holder balance changes

## Performance Optimization

### Collection Choice

- `Set` for simple membership testing
- `Map` for key-value associations
- Efficient lookups and updates

### Memory Efficiency

- Remove unnecessary data in cleanup
- Use primitive types where possible
- Maintain minimal state information

### Concurrent Access

- Safe for single-threaded operations
- Consider locks for multi-threaded use
- Maintain atomicity in updates

## Suggestions for Improvement

- Implement thorough state validation checks to prevent data inconsistencies.
- Optimize memory usage by cleaning up stale data promptly.
