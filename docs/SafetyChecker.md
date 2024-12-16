# Safety Checker Documentation

## Overview

The Safety Checker is responsible for validating token safety through comprehensive security checks, including market cap analysis, trading patterns, holder distribution, and volume analysis. It integrates with a Safety Logger for detailed tracking of security decisions.

## Core Components

### Safety Management
```javascript
{
  safetyLogger: SafetyLogger,  // Logging component
  priceManager: PriceManager   // Price conversion utility
}
```

## Security Checks

### Market Cap Validation
```javascript
checkMarketCap(token)
```
- Minimum/maximum thresholds
- USD value calculation
- Market size assessment

### Token Age Check
```javascript
checkTokenAge(token)
```
- Minimum age requirement
- Creation time validation
- Age-based risk assessment

### Price Action Analysis
```javascript
checkPriceAction(token)
```
- Volatility measurement
- Pump detection
- Price movement patterns

### Trading Pattern Analysis
```javascript
checkTradingPatterns(token)
```
- Wash trading detection
- Manipulation patterns
- Volume correlation

### Holder Distribution
```javascript
checkHolderDistribution(token)
```
- Concentration analysis
- Whale detection
- Distribution fairness

### Volume Pattern Analysis
```javascript
checkVolumePatterns(token)
```
- Wash trade percentage
- Volume correlation
- Trading authenticity

## Security Results

### Check Result Structure
```javascript
{
  approved: Boolean,
  rejectionCategory: String,
  rejectionReason: String,
  details: Object,
  duration: Number
}
```

### Rejection Categories
1. **Market Cap**
   - `high`: Exceeds maximum cap
   - `low`: Below minimum threshold

2. **Age**
   - `tooNew`: Insufficient age

3. **Price Action**
   - `volatilityTooHigh`: Excessive volatility
   - `pumpTooHigh`: Suspicious price movement

4. **Trading Patterns**
   - `washTrading`: Suspicious trading
   - `manipulation`: Market manipulation

5. **Holders**
   - `concentration`: High holder concentration
   - `whales`: Large holder dominance

6. **Volume**
   - `excessiveWashTrading`: Wash trade detection
   - `lowCorrelation`: Volume anomalies

## Configuration Options

```javascript
{
  SAFETY: {
    MAX_MARKET_CAP_USD: Number,
    MIN_MARKET_CAP_USD: Number,
    MAX_PRICE_VOLATILITY: Number,
    MAX_WASH_TRADE_PERCENTAGE: Number,
    MIN_TOKEN_AGE: Number,
    MAX_HOLDER_CONCENTRATION: Number
  }
}
```

## Integration Points

### Safety Logger
- Check results recording
- Rejection tracking
- Performance monitoring

### Price Manager
- USD conversions
- Value calculations
- Market cap validation

### Token Tracker
- Token state updates
- Safety status tracking
- Trading decisions

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
