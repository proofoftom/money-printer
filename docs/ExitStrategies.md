# Exit Strategies Documentation

## Overview

The Exit Strategies component is responsible for managing the conditions under which trading positions are closed. It implements multiple exit strategies that work together to protect profits and minimize losses.

## Core Features

### Take Profit Strategy
- Multiple profit-taking tiers
- Partial position exits at different price levels
- Configurable profit percentages for each tier

### Stop Loss Protection
- Fixed stop loss based on entry price
- Prevents catastrophic losses
- Exits entire remaining position

### Trailing Stop
- Dynamic stop loss that follows price upward
- Locks in profits during uptrends
- Adjustable trailing distance

### Volume-Based Exit
- Monitors trading volume patterns
- Exits on significant volume decrease
- Uses historical volume comparisons

### Time-Based Exit
- Maximum position hold time
- Time extensions based on performance
- Gradual exit approach for time-sensitive positions

## Implementation Details

### Position Tracking
```javascript
{
  remainingPosition: 1.0,    // Tracks remaining position size
  triggeredTiers: Set(),     // Records triggered take-profit tiers
  trailingStopPrice: null,   // Current trailing stop level
  volumeHistory: [],         // Recent volume data points
  peakVolume: 0             // Highest observed volume
}
```

### Exit Conditions

1. **Take Profit Tiers**
   - Tier 1: Small partial exit at first target
   - Tier 2: Larger exit at second target
   - Tier 3: Final exit at maximum target

2. **Stop Loss Conditions**
   - Fixed percentage below entry
   - Trailing stop activation threshold
   - Volume-based stop adjustment

3. **Volume Requirements**
   - Minimum volume maintenance
   - Rolling average comparisons
   - Sharp decline detection

4. **Time Management**
   - Base hold time limit
   - Performance-based extensions
   - Accelerated exit on poor performance

## Configuration Options

```javascript
{
  takeProfit: {
    tiers: [
      { percentage: 20, portion: 0.3 },
      { percentage: 50, portion: 0.4 },
      { percentage: 100, portion: 0.3 }
    ]
  },
  stopLoss: {
    percentage: 15,
    trailing: {
      activation: 30,
      distance: 10
    }
  },
  volume: {
    dropThreshold: 0.5,
    timeWindow: 300
  },
  time: {
    baseLimit: 3600,
    extension: 1800
  }
}
```

## Usage Example

```javascript
const exitStrategies = new ExitStrategies(config);

// Check exit conditions
const result = exitStrategies.shouldExit(
  position,
  currentPrice,
  currentVolume
);

if (result.shouldExit) {
  // Exit position with specified portion
  closePosition(position, result.portion, result.reason);
}
```

## Integration Points

- **Position Manager**: Primary interface for exit decisions
- **Token Tracker**: Provides market data and volume metrics
- **Safety Checker**: Influences exit decisions based on safety scores
- **Transaction Simulator**: Validates exit feasibility

## Error Handling

- Graceful degradation on missing data
- Default to conservative exits on errors
- Logging of all exit decisions and reasons

## Best Practices

1. **Regular Monitoring**
   - Check exit conditions frequently
   - Update trailing stops promptly
   - Maintain accurate volume history

2. **Risk Management**
   - Never disable stop losses
   - Keep take-profit tiers realistic
   - Monitor volume patterns consistently

3. **Performance Optimization**
   - Cache frequently used calculations
   - Minimize redundant checks
   - Efficient volume history management

## Exit Strategies

The `ExitStrategies` class manages the various exit conditions and strategies for positions in the Money Printer system. It implements multiple exit types and coordinates with the Position and PositionManager classes to execute exits at optimal times.

## Features

- Multiple exit strategy types
- Dynamic strategy adjustment
- Real-time monitoring
- Position-specific configurations
- Performance tracking
- Event-driven architecture

## Exit Types

### 1. Take Profit (TP)
```javascript
{
  type: 'takeProfit',
  tiers: [
    { price: 1.1, portion: 0.3 },  // 10% profit, exit 30%
    { price: 1.2, portion: 0.5 },  // 20% profit, exit 50%
    { price: 1.3, portion: 1.0 }   // 30% profit, exit remaining
  ]
}
```

### 2. Stop Loss (SL)
```javascript
{
  type: 'stopLoss',
  price: 0.9,           // 10% loss
  portion: 1.0          // Full exit
}
```

### 3. Trailing Stop
```javascript
{
  type: 'trailingStop',
  callback: 0.05,       // 5% callback from peak
  activation: 1.1       // Activates at 10% profit
}
```

### 4. Volume-Based
```javascript
{
  type: 'volume',
  threshold: 0.5,       // 50% volume decrease
  timeframe: 300        // Over 5 minutes
}
```

### 5. Time-Based
```javascript
{
  type: 'time',
  maxHoldTime: 3600,    // 1 hour max hold
  minHoldTime: 300      // 5 minutes min hold
}
```

## Class Structure

### Constructor
```javascript
constructor(config, statsLogger) {
  this.config = config;
  this.statsLogger = statsLogger;
  this.activeStrategies = new Map();
}
```

### Core Methods

#### Strategy Management
```javascript
setStrategy(position, strategy)
updateStrategy(position, updates)
removeStrategy(position)
```

#### Exit Evaluation
```javascript
shouldExit(position, currentPrice, volume)
evaluateTP(position, price)
evaluateSL(position, price)
evaluateTrailing(position, price)
evaluateVolume(position, volume)
evaluateTime(position)
```

## Events

The ExitStrategies class emits the following events:

### Strategy Events
- `strategySet`: New strategy configured
- `strategyUpdated`: Strategy parameters updated
- `strategyRemoved`: Strategy removed

### Exit Events
- `takeProfitTriggered`
- `stopLossTriggered`
- `trailingStopTriggered`
- `volumeExitTriggered`
- `timeExitTriggered`

## Integration

### With Position Class
```javascript
// Monitor position for exits
position.on('update', (price, volume) => {
  const exitResult = this.shouldExit(position, price, volume);
  if (exitResult.shouldExit) {
    position.partialExit(exitResult.portion, price, exitResult.reason);
  }
});
```

### With StatsLogger
```javascript
// Log exit events
this.statsLogger.logStats({
  type: 'EXIT_TRIGGERED',
  strategy: exitResult.type,
  position: position.id,
  price: price
});
```

## Example Usage

```javascript
// Configure exit strategy
exitStrategies.setStrategy(position, {
  takeProfit: {
    tiers: [
      { price: entryPrice * 1.1, portion: 0.3 },
      { price: entryPrice * 1.2, portion: 0.7 },
      { price: entryPrice * 1.3, portion: 1.0 }
    ]
  },
  stopLoss: {
    price: entryPrice * 0.9,
    portion: 1.0
  },
  trailingStop: {
    callback: 0.05,
    activation: entryPrice * 1.1
  }
});

// Update strategy
exitStrategies.updateStrategy(position, {
  stopLoss: { price: entryPrice * 0.95 }
});
```

## Configuration

The ExitStrategies can be configured through the config file:

```javascript
{
  EXIT_STRATEGIES: {
    DEFAULT_TAKE_PROFIT: {
      TIERS: [
        { PROFIT: 0.1, PORTION: 0.3 },
        { PROFIT: 0.2, PORTION: 0.5 },
        { PROFIT: 0.3, PORTION: 1.0 }
      ]
    },
    DEFAULT_STOP_LOSS: {
      LOSS: 0.1,
      PORTION: 1.0
    },
    TRAILING_STOP: {
      DEFAULT_CALLBACK: 0.05,
      MIN_ACTIVATION: 0.1
    },
    VOLUME_EXIT: {
      ENABLED: true,
      DEFAULT_THRESHOLD: 0.5,
      MIN_TIMEFRAME: 300
    },
    TIME_EXIT: {
      ENABLED: true,
      MAX_HOLD_TIME: 3600,
      MIN_HOLD_TIME: 300
    }
  }
}
```

## Error Handling

```javascript
try {
  const exitResult = this.shouldExit(position, price, volume);
} catch (error) {
  this.emit('error', {
    error,
    context: 'exitEvaluation',
    position: position.id
  });
  this.statsLogger.logError(error);
}
```

## Performance Optimization

1. Efficient price tracking
2. Optimized volume calculations
3. Smart update intervals
4. Memory management
5. Event batching

## Best Practices

1. Regular strategy review
2. Proper error handling
3. Performance monitoring
4. Data validation
5. Event handling
6. Configuration management
7. Testing and simulation
8. Documentation maintenance

## Strategy Development

### Adding New Strategies
```javascript
class CustomStrategy extends BaseStrategy {
  evaluate(position, price, volume) {
    // Custom evaluation logic
    return {
      shouldExit: boolean,
      portion: number,
      reason: string
    };
  }
}
```

### Strategy Testing
```javascript
async testStrategy(strategy, historicalData) {
  const results = [];
  for (const data of historicalData) {
    const result = strategy.evaluate(position, data.price, data.volume);
    results.push(result);
  }
  return this.analyzeResults(results);
}
```

## Security Considerations

1. Parameter validation
2. Price manipulation protection
3. Volume verification
4. Time synchronization
5. Error logging
6. Access control
