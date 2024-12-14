# SafetyChecker Component Documentation

## Overview

The SafetyChecker component ensures token safety by validating holder metrics, creator behavior, and market conditions.

## Core Safety Checks

### Token Safety Validation

```javascript
isTokenSafe(holders, creatorBalance);
```

Performs comprehensive safety checks:

1. Holder concentration analysis
2. Creator selling detection
3. Unique holder count validation

## Detailed Checks

### 1. Holder Concentration

```javascript
checkHolderConcentration(holders);
```

Validates token distribution:

- Calculates total supply
- Analyzes top 10 holders
- Checks concentration percentage
- Enforces maximum threshold

#### Algorithm

```javascript
const totalSupply = Array.from(holders.values()).reduce((a, b) => a + b, 0);
const topHolders = Array.from(holders.values())
  .sort((a, b) => b - a)
  .slice(0, 10);

const topHoldersPercentage =
  (topHolders.reduce((a, b) => a + b, 0) / totalSupply) * 100;

return topHoldersPercentage <= config.safety.maxHolderConcentration;
```

### 2. Creator Selling Detection

```javascript
hasCreatorSoldAll(creator, creatorBalance);
```

Monitors creator behavior:

- Tracks creator balance
- Detects complete selling
- Optional check based on config

### 3. Unique Holder Analysis

```javascript
hasEnoughUniqueHolders(holders);
```

Validates holder diversity:

- Counts unique holders
- Enforces minimum threshold
- Prevents manipulation

## Configuration Options

### Safety Thresholds

```javascript
{
  maxHolderConcentration: 30,  // Maximum % for top holders
  checkCreatorSoldAll: true,   // Enable creator checks
  minHolders: 30               // Minimum unique holders
}
```

## Usage Patterns

### Basic Safety Check

```javascript
const isSafe = safetyChecker.isTokenSafe(holders);
```

### Holder Analysis

```javascript
const hasGoodDistribution = safetyChecker.checkHolderConcentration(holders);
const hasEnoughHolders = safetyChecker.hasEnoughUniqueHolders(holders);
```

### Creator Monitoring

```javascript
const creatorSold = safetyChecker.hasCreatorSoldAll(creator, balance);
```

## Best Practices

### 1. Data Validation

- Verify holder data completeness
- Validate balance calculations
- Check for data consistency

### 2. Performance Optimization

- Cache holder calculations
- Optimize sorting operations
- Minimize redundant checks

## Implementation Tips

### 1. Holder Analysis

- Sort holders efficiently
- Use appropriate data structures
- Consider memory usage

### 2. Creator Tracking

- Monitor balance changes
- Track selling patterns
- Consider time factors

### 3. Configuration

- Make thresholds configurable
- Allow feature toggles
- Document all settings

## Common Use Cases

### 1. Trading Decisions

```javascript
// Verify before position
const isSafe = safetyChecker.isTokenSafe(holders);

if (isSafe) {
  // Open position
}
```

## Error Prevention

### Edge Cases

- Consider zero balances
- Handle edge cases like creator selling
- Ensure data integrity
