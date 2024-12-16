# Position Manager

The `PositionManager` class orchestrates the lifecycle of all trading positions in the Money Printer system. It coordinates between various components to manage position creation, updates, and closures while ensuring proper state management and event handling.

## Features

- Position lifecycle management
- Multi-position coordination
- State persistence and recovery
- Transaction simulation integration
- Advanced metrics tracking
- Event-driven updates
- Risk management
- Performance analytics

## Class Structure

### Constructor
```javascript
constructor({
  wallet,
  positionStateManager,
  transactionSimulator,
  statsLogger,
  exitStrategies,
  config = {}
}) {
  this.wallet = wallet;
  this.positionStateManager = positionStateManager;
  this.transactionSimulator = transactionSimulator;
  this.statsLogger = statsLogger;
  this.exitStrategies = exitStrategies;
  this.config = config;
  
  this.positions = new Map();
  this.metrics = new PositionMetrics();
  
  this.initialize();
}
```

### Core Methods

#### Position Management
```javascript
async openPosition(token, price, size, options = {})
async closePosition(mint, price, reason)
async updatePosition(mint, price, volume)
async partialExit(mint, portion, price, reason)
validatePositions()
```

#### State Management
```javascript
async loadPositions()
async savePositions()
validateState()
getPosition(mint)
getAllPositions()
```

#### Risk Management
```javascript
validateRisk(token, size, price)
checkExposure(token)
validateTokenLimits(token)
```

## Events

### Position Lifecycle
- `positionOpened`: New position created
- `positionUpdated`: Position state changed
- `positionClosed`: Position fully closed
- `partialExit`: Partial position exit
- `allPositionsUpdated`: Batch position update

### Risk Events
- `exposureLimit`: Position size limits
- `riskAlert`: Risk threshold exceeded
- `marginCall`: Insufficient margin

### State Events
- `stateLoaded`: Positions loaded
- `stateSaved`: Positions saved
- `stateValidated`: State validation
- `error`: Error occurred

## Integration

### With Position Class
```javascript
// Create and manage position
async openPosition(token, price, size, options) {
  // Validate position parameters
  await this.validateNewPosition(token, size, price);
  
  // Create position instance
  const position = new Position({
    token,
    entryPrice: price,
    size,
    ...options
  });
  
  // Setup position monitoring
  this.setupPositionHandlers(position);
  
  // Store and persist
  this.positions.set(token.mint, position);
  await this.savePositions();
  
  return position;
}
```

### With PositionStateManager
```javascript
// Load and restore positions
async loadPositions() {
  const savedPositions = await this.positionStateManager.loadPositions();
  
  for (const data of savedPositions) {
    const position = Position.fromJSON(data);
    this.positions.set(position.token.mint, position);
    this.setupPositionHandlers(position);
  }
  
  this.emit('stateLoaded', { count: this.positions.size });
}
```

### With TransactionSimulator
```javascript
// Simulate transaction
async simulateTransaction(position, size, price) {
  const delay = await this.transactionSimulator.simulateTransactionDelay(position);
  const impact = await this.transactionSimulator.calculatePriceImpact(
    position,
    size,
    price,
    position.lastVolume
  );
  
  return { delay, impact };
}
```

### With StatsLogger
```javascript
// Log position events
logPositionEvent(type, position, metadata = {}) {
  this.statsLogger.logStats({
    type,
    position: position.id,
    token: position.token.mint,
    price: position.currentPrice,
    size: position.remainingSize,
    ...metadata
  });
}
```

## Example Usage

```javascript
// Initialize manager
const positionManager = new PositionManager({
  wallet,
  positionStateManager,
  transactionSimulator,
  statsLogger,
  exitStrategies,
  config
});

// Open position
const position = await positionManager.openPosition(token, 1.5, 2.0, {
  maxDrawdown: 0.1,
  exitStrategies: {
    takeProfit: { tiers: [
      { price: 1.65, portion: 0.5 },
      { price: 1.80, portion: 1.0 }
    ]},
    stopLoss: { price: 1.35, portion: 1.0 }
  }
});

// Update positions
await positionManager.updatePositions(updates);

// Close position
await positionManager.closePosition(token.mint, 1.7, 'takeProfit');

// Get position metrics
const metrics = positionManager.getMetrics();
```

## Configuration

```javascript
{
  POSITION_MANAGER: {
    MAX_POSITIONS: 10,
    MAX_TOKEN_EXPOSURE: 5.0,
    TOTAL_EXPOSURE_LIMIT: 20.0,
    VALIDATION_INTERVAL: 60000,
    RISK_CHECKS: {
      ENABLED: true,
      MAX_DRAWDOWN: 0.15,
      CORRELATION_LIMIT: 0.7
    },
    STATE_PERSISTENCE: {
      ENABLED: true,
      SAVE_INTERVAL: 300000
    }
  }
}
```

## Error Handling

```javascript
try {
  await this.openPosition(token, price, size);
} catch (error) {
  this.emit('error', {
    error,
    context: 'openPosition',
    token: token.mint
  });
  this.statsLogger.logError(error);
  throw error;
}
```

## Advanced Features

### Portfolio Analysis
```javascript
analyzePortfolio() {
  return {
    exposure: this.calculateExposure(),
    correlation: this.calculateCorrelation(),
    riskMetrics: this.calculateRiskMetrics(),
    performance: this.calculatePerformance()
  };
}
```

### Risk Management
```javascript
validateRisk(token, size, price) {
  // Check position limits
  if (!this.checkPositionLimits(size)) {
    throw new Error('Position size exceeds limits');
  }
  
  // Check token exposure
  if (!this.checkTokenExposure(token, size)) {
    throw new Error('Token exposure too high');
  }
  
  // Check correlation
  if (!this.checkCorrelation(token)) {
    throw new Error('Portfolio correlation too high');
  }
}
```

### Performance Monitoring
```javascript
monitorPerformance() {
  setInterval(() => {
    const metrics = this.calculateMetrics();
    this.emit('metricsUpdated', metrics);
    this.statsLogger.logMetrics(metrics);
  }, this.config.METRICS_INTERVAL);
}
```

## Best Practices

1. Regular state validation
2. Comprehensive error handling
3. Event-driven updates
4. Risk management
5. Performance monitoring
6. State persistence
7. Security considerations
8. Documentation maintenance

## Security Considerations

1. Input validation
2. State integrity
3. Access control
4. Event validation
5. Error handling
6. Audit logging
7. Rate limiting
8. Data encryption
