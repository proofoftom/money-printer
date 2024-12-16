# Price Manager Documentation

## Overview

The Price Manager is responsible for handling all price-related operations in the Money Printer system, primarily focusing on SOL/USD conversions. It maintains current SOL price data and provides conversion utilities for the entire system.

## Core Features

### Price Data Management
- SOL/USD price tracking
- Automatic initialization
- Price conversion utilities

### External Integration
- CoinGecko API integration
- Real-time price updates
- Error handling

## Implementation

### Class Structure
```javascript
class PriceManager {
  constructor() {
    this.solPriceUSD = null;  // Current SOL price in USD
  }
}
```

### Key Methods

#### Initialization
```javascript
async initialize()
```
- Fetches initial SOL price from CoinGecko
- Sets up price tracking
- Validates price data

#### Conversion Utilities
```javascript
solToUSD(solAmount)
usdToSOL(usdAmount)
```
- Bidirectional conversion
- Input validation
- Error handling

## API Integration

### CoinGecko Endpoint
```javascript
'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
```

### Response Format
```javascript
{
  solana: {
    usd: Number  // Current SOL price in USD
  }
}
```

## Usage Examples

### Initialization
```javascript
const priceManager = new PriceManager();
await priceManager.initialize();
```

### Price Conversion
```javascript
// SOL to USD
const usdValue = priceManager.solToUSD(1.5);  // Convert 1.5 SOL to USD

// USD to SOL
const solValue = priceManager.usdToSOL(100);  // Convert $100 to SOL
```

## Integration Points

### Dashboard
- Market cap display
- Volume calculations
- Position value tracking

### TokenTracker
- Token price calculations
- Volume metrics
- Market analysis

### PositionManager
- Position value calculations
- Profit/loss tracking
- Entry/exit decisions

## Error Handling

### Initialization Errors
```javascript
try {
  await priceManager.initialize();
} catch (error) {
  console.error('Failed to fetch SOL price:', error.message);
}
```

### Conversion Errors
```javascript
if (!this.solPriceUSD) {
  throw new Error('PriceManager not initialized');
}
```

## Best Practices

### Price Updates
1. **Initialization**
   - Always initialize before use
   - Handle failed initialization
   - Validate price data

2. **Error Handling**
   - Check for null prices
   - Validate input values
   - Handle API failures

3. **Usage**
   - Use consistent decimal places
   - Handle edge cases
   - Validate conversions

## Configuration Options

```javascript
{
  api: {
    endpoint: 'https://api.coingecko.com/api/v3',
    timeout: 5000,
    retries: 3
  },
  price: {
    updateInterval: 60000,  // 1 minute
    maxAge: 300000         // 5 minutes
  }
}
```

## Future Improvements

1. **Price Updates**
   - Periodic price updates
   - WebSocket price feed
   - Price change notifications

2. **Caching**
   - Local price cache
   - Update throttling
   - Stale price handling

3. **Error Recovery**
   - Automatic retry
   - Fallback data sources
   - Price validation

## Testing Considerations

1. **Unit Tests**
   - Conversion accuracy
   - Error handling
   - Edge cases

2. **Integration Tests**
   - API connectivity
   - Response handling
   - Error scenarios

3. **Mock Testing**
   - API response mocking
   - Price update simulation
   - Error injection
