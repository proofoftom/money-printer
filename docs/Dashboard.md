# Dashboard Component Documentation

## Overview

The Dashboard is a terminal-based user interface built with the Blessed library that provides real-time visualization of the Money Printer trading system. It displays token states, trading positions, wallet status, and system events in an organized, interactive layout.

## Layout Structure

```
+----------------+----------------+------------------------+
|  Wallet Status |  Balance Chart |      Status Log       |
|                |                |                       |
+----------------+----------------+------------------------+
|    New Tokens  |  Heating Up   |     First Pump        |
|                |               |                        |
+----------------+---------------+------------------------+
|    Drawdown    |    Pumping    |   Supply Recovery     |
|                |               |                        |
+----------------+---------------+------------------------+
|      Active    |    Trade      |                       |
|    Positions   |    History    |                       |
+----------------+---------------+------------------------+
```

## Components

### Status Displays

1. **Wallet Status**

   - Current balance
   - Position count
   - Win/loss ratio

2. **Balance Chart**

   - Historical balance tracking
   - Real-time updates
   - Visual trend analysis

3. **Status Log**
   - System events
   - Error messages
   - Trading notifications

### Token State Sections

1. **New Tokens**

   - Recently minted tokens
   - Initial market metrics
   - Age tracking

2. **Heating Up**

   - Tokens gaining momentum
   - Volume increases
   - Market cap growth

3. **First Pump**

   - Initial price surge
   - Volume confirmation
   - Safety metrics

4. **Drawdown**

   - Price retracement
   - Volume analysis
   - Recovery potential

5. **Pumping**

   - Sustained price increase
   - Volume confirmation
   - Entry conditions

6. **Supply Recovery**
   - Supply distribution
   - Holder metrics
   - Safety status

### Trading Information

1. **Active Positions**

   - Current trades
   - Entry prices
   - Profit/loss tracking

2. **Trade History**
   - Recent trades
   - Performance metrics
   - Exit reasons

## Display Formatting

### Token Display Format

```
SYMBOL         AGE | MC: $VALUE   | H: COUNT T: CONCENTRATION%
VOL     1m: $VALUE | 5m: $VALUE   | 1h: $VALUE
─────────────────────────────────────────────────
```

### Position Display Format

```
SYMBOL: Entry $PRICE | Current $PRICE | PNL: VALUE%
```

## Key Features

### Real-time Updates

- Automatic refresh of all displays
- Event-driven updates
- Performance optimized rendering

### Interactive Elements

- Scrollable sections
- Focus management
- Keyboard shortcuts

### Data Visualization

- Balance history chart
- Token metrics formatting
- Color-coded status indicators

## Integration Points

### TokenTracker

- Token state updates
- Volume metrics
- Safety status

### PositionManager

- Trade execution
- Position tracking
- Balance updates

### WebSocketManager

- Real-time data feed
- Event processing
- Connection status

## Event Handling

### System Events

```javascript
// Console log redirection
console.log = (...args) => {
  this.logStatus(args.join(" "));
};

// Error logging
console.error = (...args) => {
  this.logStatus(args.join(" "), "error");
};
```

### Token Events

- State transitions
- Volume updates
- Safety alerts

### Trading Events

- Position opens
- Position closes
- Balance changes

## Configuration Options

```javascript
{
  screen: {
    title: "Money Printer Trading Dashboard",
    smartCSR: true
  },
  refresh: {
    interval: 1000,
    balanceChart: 5000
  },
  display: {
    maxLogLines: 100,
    maxTradeHistory: 50
  }
}
```

## Best Practices

1. **Performance**

   - Throttle updates
   - Batch renders
   - Clean old data

2. **Memory Management**

   - Limit history size
   - Regular cleanup
   - Efficient data structures

3. **Error Handling**
   - Graceful degradation
   - Clear error messages
   - Recovery procedures

## Keyboard Shortcuts

- `q`: Quit application
- `↑/↓`: Scroll focused box
- `tab`: Change focus
- `escape`: Reset focus

## Error Handling

1. **Display Errors**

   - Color-coded messages
   - Error categorization
   - Persistent display

2. **Recovery**

   - Auto-refresh on error
   - Component reinitialization
   - State consistency checks

3. **Logging**
   - Error tracking
   - Debug information
   - System status

## Position Management Integration

### Position Manager

```javascript
class PositionManager {
  constructor() {
    this.positions = new Map();
  }

  addPosition(position) {
    this.positions.set(position.id, position);
  }

  removePosition(positionId) {
    this.positions.delete(positionId);
  }

  updatePosition(position) {
    this.positions.set(position.id, position);
  }

  getPosition(positionId) {
    return this.positions.get(positionId);
  }
}
```

### Integration with Dashboard

```javascript
class Dashboard {
  constructor(positionManager) {
    this.positionManager = positionManager;
  }

  updatePositionData(position) {
    this.positionManager.updatePosition(position);
  }

  getPositionData(positionId) {
    return this.positionManager.getPosition(positionId);
  }
}
```

## Example Usage

```javascript
const positionManager = new PositionManager();
const dashboard = new Dashboard(positionManager);

// Add a new position
const position = {
  id: 1,
  token: 'ABC',
  entryPrice: 100,
  currentPrice: 120,
  size: 1000
};
positionManager.addPosition(position);

// Update a position
position.currentPrice = 130;
positionManager.updatePosition(position);

// Get a position
const positionData = dashboard.getPositionData(1);
console.log(positionData);
