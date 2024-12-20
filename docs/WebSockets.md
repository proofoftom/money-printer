# WebSocket Integration

## Overview

The trading bot uses a WebSocket setup:

1. Client connection to wss://pumpportal.fun/api/data for receiving real-time trade data
2. Subscription to new token events
3. Subscription to token trade events

## PumpPortal Connection

### Connection Details

- URL: `wss://pumpportal.fun/api/data`
- Auto-reconnection on disconnect
- Subscribes to new token events on connection

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

## Error Handling

- Automatic reconnection to wss://pumpportal.fun/api/data on disconnect
- Graceful shutdown on SIGINT
- Detailed error logging for message parsing issues

## Suggestions for Improvement

- Implement robust error handling and reconnection strategies to ensure reliability.

## Implementation

WARNING: PLEASE ONLY USE ONE WEBSOCKET CONNECTION AT A TIME:
You should NOT open a new Websocket connection for every token or account you subscribe to. Instead, you should send any new subscribe messages to the same connection. Clients that repeatedly attempt to open many websocket connections at once may be blacklisted.

```javascript
import WebSocket from "ws";

const ws = new WebSocket("wss://pumpportal.fun/api/data");

ws.on("open", function open() {
  // Subscribing to token creation events
  let payload = {
    method: "subscribeNewToken",
  };
  ws.send(JSON.stringify(payload));

  // New token creation:
  // {
  //   "txType": "create",
  //   "signature": "...",
  //   "mint": "5yQxNHfrjLk5rP2xXh2a5ALqDvefDeHuBF4wnvtppump",
  //   "traderPublicKey": "5UuNgYpE41pa7jKJbKvmqjKj4ipHaRHZTYjmDbKUzhyA",
  //   "initialBuy": 60735849.056603,
  //   "bondingCurveKey": "...",
  //   "vTokensInBondingCurve": 1012264150.943397,
  //   "vSolInBondingCurve": 31.799999999999976,
  //   "marketCapSol": 31.414725069897433,
  //   "name": "Token Name",
  //   "symbol": "SYMBOL",
  //   "uri": "..."
  // }

  // Subscribing to trades on tokens
  payload = {
    method: "subscribeTokenTrade",
    keys: [mint], // array of token CAs to watch
  };
  ws.send(JSON.stringify(payload));
});

ws.on("message", function message(data) {
  console.log(JSON.parse(data));
});
// Buy/Sell Events
// {
//   "txType": "buy|sell",
//   "signature": "...",
//   "mint": "5yQxNHfrjLk5rP2xXh2a5ALqDvefDeHuBF4wnvtppump",
//   "traderPublicKey": "...",
//   "tokenAmount": 94541651,
//   "newTokenBalance": 94541651,
//   "bondingCurveKey": "...",
//   "vTokensInBondingCurve": 897446022.342982,
//   "vSolInBondingCurve": 35.86845247356589,
//   "marketCapSol": 39.96725327270751
// }
```
