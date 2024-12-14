# WebSocket Integration

## Overview

The trading bot uses a dual WebSocket setup:

1. Client connection to pumpportal.fun for receiving real-time trade data
2. Broadcast server for dashboard updates

## PumpPortal Connection

### Connection Details

- URL: `wss://pumpportal.fun/data-api/real-time`
- Auto-reconnection on disconnect
- Subscribes to new token events on connection

### Message Types

#### New Token Creation

```javascript
{
  "txType": "create",
  "signature": "...",
  "mint": "5yQxNHfrjLk5rP2xXh2a5ALqDvefDeHuBF4wnvtppump",
  "traderPublicKey": "5UuNgYpE41pa7jKJbKvmqjKj4ipHaRHZTYjmDbKUzhyA",
  "initialBuy": 60735849.056603,
  "bondingCurveKey": "...",
  "vTokensInBondingCurve": 1012264150.943397,
  "vSolInBondingCurve": 31.799999999999976,
  "marketCapSol": 31.414725069897433,
  "name": "Token Name",
  "symbol": "SYMBOL",
  "uri": "..."
}
```

#### Buy/Sell Events

```javascript
{
  "txType": "buy|sell",
  "signature": "...",
  "mint": "5yQxNHfrjLk5rP2xXh2a5ALqDvefDeHuBF4wnvtppump",
  "traderPublicKey": "...",
  "tokenAmount": 94541651,
  "newTokenBalance": 94541651,
  "bondingCurveKey": "...",
  "vTokensInBondingCurve": 897446022.342982,
  "vSolInBondingCurve": 35.86845247356589,
  "marketCapSol": 39.96725327270751
}
```

### Subscription Methods

#### Subscribe to New Tokens

```javascript
{
  "method": "subscribeNewToken"
}
```

#### Subscribe to Token Trades

```javascript
{
  "method": "subscribeTokenTrade",
  "keys": ["mint1", "mint2", ...]
}
```

#### Unsubscribe from Token Trades

```javascript
{
  "method": "unsubscribeTokenTrade",
  "keys": ["mint1", "mint2", ...]
}
```

## Dashboard Broadcast Server

### Connection Details

- Port: 8080
- WebSocket server for dashboard clients
- Broadcasts token state changes and position updates

### Message Types

#### Token Updates

```javascript
{
  "type": "tokenUpdate",
  "data": {
    "mint": "...",
    "state": "new|heatingUp|pumping|drawdown|dead",
    "marketCap": 1000,
    "position": {
      "entryPrice": 900,
      "size": 20,
      "timestamp": "..."
    }
  }
}
```

#### Position Updates

```javascript
{
  "type": "positionUpdate",
  "data": {
    "mint": "...",
    "position": {
      "entryPrice": 900,
      "exitPrice": 1200,
      "pnl": 6.67,
      "isWin": true
    },
    "accountBalance": 120,
    "wins": 1,
    "losses": 0
  }
}
```

## Error Handling

- Automatic reconnection to pumpportal.fun on disconnect
- Graceful shutdown on SIGINT
- Detailed error logging for message parsing issues

## Suggestions for Improvement

- Implement robust error handling and reconnection strategies to ensure reliability.
- Consider adding authentication mechanisms if sensitive data is being transmitted.
