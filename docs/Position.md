# Position Class

The `Position` class is a core component of the Money Printer trading system, responsible for managing individual trading positions. It encapsulates all position-related data and logic, including entry/exit management, profit/loss calculations, and state tracking.

## Features

- Position lifecycle management (open, update, close)
- Profit/Loss tracking and calculations
- Partial exit handling with advanced exit strategies
- Event-driven architecture for position updates
- Integration with Token volatility data
- Transaction simulation support
- State persistence and recovery
- Advanced metrics tracking

## Class Structure

### Constructor
```javascript
constructor({
  token,
  entryPrice,
  size,
  id = null,
  maxDrawdown = DEFAULT_MAX_DRAWDOWN,
  exitStrategies = {},
  metadata = {}
}) {
  this.token = token;
  this.entryPrice = entryPrice;
  this.size = size;
  this.remainingSize = size;
  this.id = id || uuid();
  this.isOpen = true;
  this.maxDrawdown = maxDrawdown;
  this.exitStrategies = exitStrategies;
  this.metadata = metadata;
  
  // Initialize tracking arrays
  this.partialExits = [];
  this.priceHistory = [];
  this.volumeHistory = [];
  this.profitHistory = [];
  
  // Initialize timestamps
  this.openTime = Date.now();
  this.lastUpdateTime = this.openTime;
  
  // Initialize metrics
  this.initializeMetrics();
}
```

### Core Methods

#### Position Management
```javascript
async update(currentPrice, volume, metadata = {})
async close(exitPrice, reason, metadata = {})
async partialExit(portion, price, reason, metadata = {})
validateState()
```

#### Calculations
```javascript
calculatePnL(currentPrice)
calculatePnLPercent(currentPrice)
calculateDrawdown(currentPrice)
calculateHoldTime()
calculateAverageEntryPrice()
```

#### State Management
```javascript
toJSON()
static fromJSON(data)
clone()
```

#### Metrics
```javascript
updateMetrics(price, volume)
calculateVolatility()
calculateVolumeProfile()
getPositionHealth()
```

## Events

The Position class emits the following events:

### Lifecycle Events
- `positionOpened`: When position is initially opened
- `positionUpdated`: When position price/volume is updated
- `positionClosed`: When position is fully closed
- `partialExit`: When a partial exit is executed

### Metric Events
- `metricsUpdated`: When position metrics are updated
- `drawdownAlert`: When drawdown exceeds thresholds
- `volatilityAlert`: When volatility exceeds thresholds
- `volumeAlert`: When volume conditions change significantly

### State Events
- `stateChanged`: When position state changes
- `stateValidated`: When state validation completes
- `error`: When an error occurs

## Integration

### With Token Class
```javascript
// Update position with token data
async update(price, volume) {
  const volatility = this.token.getVolatility();
  const volumeProfile = this.token.getVolumeProfile();
  
  this.updateMetrics(price, volume, { volatility, volumeProfile });
  this.emit('positionUpdated', { price, volume, metrics: this.metrics });
}
```

### With ExitStrategies
```javascript
// Check exit conditions
checkExitConditions(price, volume) {
  for (const strategy of this.exitStrategies) {
    const result = strategy.evaluate(this, price, volume);
    if (result.shouldExit) {
      this.partialExit(result.portion, price, result.reason);
    }
  }
}
```

### With TransactionSimulator
```javascript
// Simulate transaction impact
async simulateExit(portion, price) {
  const impact = await this.transactionSimulator.calculatePriceImpact(
    this,
    this.remainingSize * portion,
    price,
    this.lastVolume
  );
  return price * (1 - impact);
}
```

## Example Usage

```javascript
// Create new position
const position = new Position({
  token,
  entryPrice: 1.5,
  size: 2.0,
  exitStrategies: {
    takeProfit: { tiers: [
      { price: 1.65, portion: 0.5 },
      { price: 1.80, portion: 1.0 }
    ]},
    stopLoss: { price: 1.35, portion: 1.0 }
  }
});

// Update position
await position.update(1.6, 10000);

// Execute partial exit
await position.partialExit(0.5, 1.65, 'takeProfit_tier1');

// Close position
await position.close(1.7, 'manual');

// Get position metrics
const metrics = {
  pnl: position.calculatePnL(),
  drawdown: position.calculateDrawdown(),
  holdTime: position.calculateHoldTime(),
  volume: position.getVolumeProfile()
};
```

## Configuration

Position behavior can be configured through the config file:

```javascript
{
  POSITION: {
    MIN_SIZE: 0.1,
    MAX_SIZE: 5.0,
    MAX_DRAWDOWN: 15,
    STATE_PERSISTENCE: true,
    METRICS: {
      VOLATILITY_WINDOW: 24,
      VOLUME_WINDOW: 12,
      UPDATE_INTERVAL: 60000
    },
    PARTIAL_EXITS: {
      ENABLED: true,
      MIN_PORTION: 0.1,
      MAX_PORTIONS: 3
    }
  }
}
```

## Error Handling

```javascript
try {
  await this.update(price, volume);
} catch (error) {
  this.emit('error', {
    error,
    context: 'update',
    position: this.id
  });
  throw error;
}
```

## Best Practices

1. Regular state validation
2. Proper error handling
3. Event handling
4. Metric monitoring
5. Data persistence
6. Performance optimization
7. Security considerations
8. Documentation maintenance

## Advanced Features

### Position Health Monitoring
```javascript
getPositionHealth() {
  return {
    drawdown: this.calculateDrawdown(),
    volatility: this.calculateVolatility(),
    volumeProfile: this.getVolumeProfile(),
    holdTime: this.calculateHoldTime(),
    profitFactor: this.calculateProfitFactor()
  };
}
```

### Risk Management
```javascript
validateRisk(price, volume) {
  const health = this.getPositionHealth();
  if (health.drawdown > this.maxDrawdown) {
    this.emit('drawdownAlert', health);
    return false;
  }
  return true;
}
```

### Performance Analysis
```javascript
analyzePerformance() {
  return {
    entryQuality: this.analyzeEntry(),
    exitQuality: this.analyzeExits(),
    timing: this.analyzeTiming(),
    riskManagement: this.analyzeRisk()
  };
}
```

## Security Considerations

1. Data validation
2. State integrity
3. Error handling
4. Event validation
5. Access control
6. Audit logging
