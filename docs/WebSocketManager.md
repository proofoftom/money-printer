# WebSocket Manager Documentation

## Overview

The WebSocket Manager is responsible for maintaining real-time connections with the PumpPortal data feed, handling token subscriptions, and processing trade events. It extends EventEmitter to provide event-based communication throughout the system.

## Core Features

### Connection Management
- Automatic connection establishment
- Reconnection handling
- Graceful shutdown
- Connection state tracking

### Subscription Handling
```javascript
{
  subscriptions: Set(),  // Active token subscriptions
  isConnected: Boolean,  // Connection state
  ws: WebSocket         // Active connection
}
```

### Message Processing
- New token notifications
- Trade updates
- Market data processing
- Error handling

## Key Methods

### Connection Management
```javascript
connect()
close()
reconnect()
```
- Establishes WebSocket connections
- Handles connection lifecycle
- Manages reconnection attempts

### Subscription Management
```javascript
subscribeToNewTokens()
subscribeToToken(mint)
unsubscribeFromToken(mint)
resubscribeToTokens()
```
- Manages token subscriptions
- Maintains subscription state
- Handles resubscription on reconnect

### Message Handling
```javascript
handleMessage(data)
handleTradeMessage(message)
handleTokenMessage(message)
```
- Processes incoming messages
- Routes updates to appropriate handlers
- Validates message data

## Event System

### Emitted Events
- `connected`: WebSocket connection established
- `disconnected`: Connection lost
- `error`: Connection or processing error
- `message`: Raw message received

### Handled Events
- `open`: Connection opened
- `close`: Connection closed
- `error`: WebSocket error
- `message`: Incoming message

## Integration Points

### TokenTracker
- Receives token updates
- Processes trade data
- Manages token lifecycle

### PriceManager
- Price data updates
- Market value calculations
- Currency conversions

### ErrorLogger
- Connection errors
- Message processing errors
- Subscription failures

## Message Formats

### New Token Message
```javascript
{
  type: "token",
  data: {
    mint: String,
    name: String,
    symbol: String,
    uri: String,
    // ... other token data
  }
}
```

### Trade Message
```javascript
{
  type: "trade",
  data: {
    mint: String,
    amount: Number,
    price: Number,
    timestamp: Number
  }
}
```

## Error Handling

### Connection Errors
1. **Initial Connection**
   - Retry with backoff
   - Log connection attempts
   - Notify system components

2. **Connection Loss**
   - Automatic reconnection
   - State recovery
   - Subscription restoration

3. **Message Processing**
   - Validation errors
   - Data type mismatches
   - Missing fields

## Configuration

```javascript
{
  WEBSOCKET: {
    URL: "wss://pump-portal.example.com",
    RECONNECT_INTERVAL: 5000,
    MAX_RECONNECT_ATTEMPTS: 5
  }
}
```

## Best Practices

### Connection Management
1. **Initialization**
   - Proper event listener setup
   - Error handler registration
   - Resource cleanup

2. **Maintenance**
   - Keep-alive monitoring
   - Connection health checks
   - Subscription validation

3. **Shutdown**
   - Graceful connection closure
   - Resource cleanup
   - Event listener removal

### Message Processing
1. **Validation**
   - Message format checking
   - Data type verification
   - Required field validation

2. **Performance**
   - Efficient message routing
   - Subscription optimization
   - Memory management

3. **Error Recovery**
   - Message retry logic
   - State reconciliation
   - Error notification

## Security Considerations

1. **Connection Security**
   - WSS protocol usage
   - Certificate validation
   - Origin verification

2. **Data Validation**
   - Input sanitization
   - Message authentication
   - Rate limiting

3. **Error Exposure**
   - Safe error reporting
   - Log sanitization
   - Security event tracking

## Testing Considerations

1. **Test Mode**
   - Disabled auto-connect
   - Mock message support
   - State verification

2. **Connection Testing**
   - Reconnection scenarios
   - Error conditions
   - State transitions

3. **Message Testing**
   - Format validation
   - Error handling
   - Event emission
