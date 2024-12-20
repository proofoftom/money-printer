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

## Advanced Exit Strategies

### Pattern Recognition
- **Bearish Engulfing**: Strong reversal signal with larger bearish candle
- **Evening Star**: Three-candle reversal pattern at market tops
- **Shooting Star**: Single-candle reversal with long upper shadow

### Dynamic Take-Profit
- Adjusts based on pump strength and market conditions
- Considers token age and volume profile
- Partial exits with size based on market conditions

### OHLCV Metrics
- Volume drop detection with configurable thresholds
- Price velocity monitoring for rapid changes
- Score-based exits using multiple indicators

## Performance Monitoring

### Strategy Evaluation
```javascript
{
  executionTime: 123,        // Time taken to evaluate strategies
  triggeredStrategy: {
    reason: 'VOLUME_DROP',
    portion: 1.0
  },
  metrics: {
    currentPrice: 100,
    entryPrice: 90,
    pnl: 11.11,              // Percent gain/loss
    timeInPosition: 3600000  // Duration in position
  }
}
```

### Logging Levels

1. **Debug Level**
   - Strategy evaluation start/end
   - Configuration details
   - Performance metrics
   - Execution times

2. **Info Level**
   - Exit signals triggered
   - Position details
   - PnL information
   - Strategy decisions

3. **Error Level**
   - Strategy evaluation errors
   - Missing data handling
   - Configuration issues
   - Market condition anomalies

### Market Condition Handling

1. **High Volatility**
   - More conservative exit portions
   - Tighter trailing stops
   - Faster reaction to reversals

2. **Low Liquidity**
   - Volume-based exit triggers
   - Reduced position sizes
   - Conservative take-profit levels

3. **Price Manipulation**
   - Detection of unusual price movements
   - Protection against false signals
   - Emergency exit procedures

## Position Sizing Integration

### Risk-Based Sizing
```javascript
{
  riskFactors: {
    volatility: 0.5,        // Market volatility score
    liquidity: 0.8,         // Liquidity score
    momentum: 0.7,          // Trend strength
    safety: 0.9            // Safety score
  },
  sizingDecision: {
    baseSize: 1.0,         // Standard position size
    adjustedSize: 0.7,     // Size after risk adjustment
    reason: 'HIGH_VOLATILITY'
  }
}
```

### Dynamic Adjustments
- Reduces position size in high-risk conditions
- Increases size in favorable conditions
- Considers multiple risk factors
- Adapts to changing market conditions

## Testing Coverage

1. **Basic Conditions**
   - Stop loss triggers
   - Take profit levels
   - Trailing stop behavior

2. **Market Conditions**
   - High volatility handling
   - Low liquidity scenarios
   - Manipulation attempts

3. **Strategy Interaction**
   - Priority handling
   - Signal combination
   - Conflict resolution

4. **Edge Cases**
   - Missing data handling
   - Invalid input protection
   - Error recovery
