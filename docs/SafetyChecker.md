# Safety Checker Documentation

## Overview

The Safety Checker is responsible for validating token safety through comprehensive security checks, including market cap analysis, trading patterns, holder distribution, and volume analysis. It integrates with a Safety Logger for detailed tracking of security decisions.

## Core Components

### Safety Management
```javascript
{
  safetyLogger: SafetyLogger,  // Logging component
  priceManager: PriceManager,  // Price conversion utility
  traderManager: TraderManager // Trader management system
}
```

## Security Checks

### Minimum Requirements
```javascript
checkMinimumRequirements(token)
```
- Token age validation (20s minimum)
- Minimum liquidity check (1.5 SOL)
- Basic safety thresholds

### Rug Pull Detection
```javascript
checkRugSignals(token)
```
- Real-time creator behavior monitoring through TraderManager
- Suspicious dump detection after pumps
- Dynamic holder concentration analysis
- Liquidity removal tracking
- Trader relationship analysis

### Pump Pattern Analysis
```javascript
checkPumpDynamics(token)
```
- Price acceleration analysis (>0.5 threshold)
- Volume spike detection (>200% increase)
- Pump frequency monitoring
- Gain rate validation
- Trading pattern correlation

## Advanced Detection Metrics

### Price Acceleration
```javascript
{
  priceAcceleration: Number,  // Rate of price change
  gainRate: Number,          // %/second price increase
  volumeCorrelation: Number  // Price-volume correlation
}
```

### Volume Spikes
```javascript
{
  timestamp: Number,
  volume: Number,
  priceChange: Number,
  correlation: Number,
  traderCount: Number       // Number of unique traders involved
}
```

### Trader Behavior
```javascript
{
  recentTrades: Array,       // Recent trading activity
  tradeVolume: Number,       // Total trade volume
  buyToSellRatio: Number,    // Ratio of buy/sell volume
  tradingPattern: String,    // Identified trading pattern
  relationshipScore: Number, // Score based on trading relationships
  riskMetrics: {
    washTradingScore: Number,
    pumpParticipation: Number,
    rugPullInvolvement: Number
  }
}
```

## Optimized Parameters

### Entry Thresholds
```javascript
{
  MIN_TOKEN_AGE_SECONDS: 20,
  MIN_LIQUIDITY_SOL: 1.5,
  MAX_CREATOR_HOLDINGS: 20,
  MIN_HOLDERS: 40,
  MIN_TRADER_COUNT: 25      // Minimum unique traders
}
```

### Pump Detection
```javascript
{
  MIN_PRICE_ACCELERATION: 0.5,
  MIN_VOLUME_SPIKE: 200,
  MIN_GAIN_RATE: 2,
  MAX_PRICE_VOLATILITY: 175,
  MIN_TRADER_PARTICIPATION: 15  // Minimum traders in pump
}
```

### Exit Signals
```javascript
{
  SUSPICIOUS_DUMP: -30,        // % drop
  MAX_CREATOR_SELL: 10,       // % of liquidity
  WASH_TRADE_THRESHOLD: 0.9,   // Buy/sell ratio for wash trading
  RELATIONSHIP_THRESHOLD: 3    // Min trades for trader relationship
}
```

## Trading Pattern Analysis

### Wash Trading Detection
```javascript
{
  timeWindow: Number,          // Analysis window in ms
  minTradeCount: Number,       // Minimum trades to analyze
  volumeThreshold: Number,     // Minimum volume for analysis
  relationshipStrength: Number // Minimum relationship score
}
```

### Pump Coordination
```javascript
{
  participationThreshold: Number,  // Min traders involved
  timeWindow: Number,              // Analysis window
  volumeConcentration: Number,     // Max volume per trader
  relationshipDensity: Number      // Min relationships between traders
}
```

### Risk Scoring
```javascript
{
  traderReputation: Number,     // Individual trader score
  groupRiskScore: Number,       // Trading group risk
  patternConfidence: Number,    // Pattern detection confidence
  overallRiskLevel: String      // Combined risk assessment
}
```

## Performance Optimizations

### Real-time Monitoring
- Continuous creator behavior tracking
- Instant pump pattern detection
- Dynamic safety threshold adjustment

### Memory Efficiency
- Optimized data structures
- Efficient metric calculations
- Smart event handling

### Response Time
- Fast pump detection algorithm
- Quick exit signal generation
- Efficient safety validation

## Integration

### Token Component
- Real-time price metrics
- Volume spike detection
- Wallet activity monitoring

### Price Manager
- Dynamic price calculations
- Volatility tracking
- Market impact analysis

## Configuration

Updated configuration parameters for optimized performance:

```javascript
{
  SAFETY: {
    MIN_LIQUIDITY_SOL: 1.5,
    MIN_VOLUME_SOL: 0.3,
    MAX_WALLET_VOLUME_PERCENTAGE: 40,
    MIN_VOLUME_PRICE_CORRELATION: 0.25,
    MAX_WASH_TRADE_PERCENTAGE: 45,
    
    MIN_TOKEN_AGE_SECONDS: 20,
    MAX_HOLD_TIME_SECONDS: 240,
    
    MAX_PRICE_CHANGE_PERCENT: 250,
    MIN_PRICE_CHANGE_PERCENT: -35,
    MAX_PRICE_VOLATILITY: 175,
    
    MIN_HOLDERS: 40,
    MAX_TOP_HOLDER_CONCENTRATION: 45,
    MAX_CREATOR_HOLDINGS_PERCENT: 20,
    
    RECOVERY_THRESHOLD_PERCENT: 8,
    MAX_DRAWDOWN_PERCENT: 25
  }
}
```

## Error Handling

### Check Failures
1. **Data Validation**
   - Missing metrics
   - Invalid values
   - Data consistency

2. **Calculation Errors**
   - Numeric overflow
   - Division by zero
   - Precision issues

3. **External Dependencies**
   - Price feed issues
   - Data availability
   - Service timeouts

## Best Practices

### Security Analysis
1. **Check Execution**
   - Regular validation
   - Comprehensive analysis
   - Quick response

2. **Risk Assessment**
   - Multiple factors
   - Pattern recognition
   - Historical context

3. **Performance**
   - Efficient calculations
   - Cached results
   - Quick decisions

### Logging
1. **Result Recording**
   - Detailed logs
   - Decision tracking
   - Performance metrics

2. **Analysis**
   - Pattern identification
   - Risk correlation
   - Improvement areas

## Future Improvements

1. **Security Checks**
   - Advanced pattern detection
   - Machine learning integration
   - Real-time analysis

2. **Performance**
   - Parallel processing
   - Cached calculations
   - Optimized algorithms

3. **Integration**
   - External data sources
   - Risk scoring systems
   - Market intelligence
