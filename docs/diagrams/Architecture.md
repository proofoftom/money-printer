# System Architecture

```mermaid
graph TD
    PP[PumpPortal WebSocket] -->|Trade Data| WC[WebSocket Client]
    WC -->|Updates| TT[TokenTracker]
    TT -->|State Changes| BS[Broadcast Server]
    BS -->|Updates| D1[Dashboard Client 1]
    BS -->|Updates| D2[Dashboard Client 2]
    BS -->|Updates| D3[Dashboard Client n]

    subgraph TokenTracker Components
        TT --> TS[TokenState]
        TT --> PM[PositionManager]
        TT --> SC[SafetyChecker]
        TT --> WS[WebSockets]
    end
```

# Token Lifecycle

````mermaid
stateDiagram-v2
    [*] --> New: Token Created || Overbought
    New --> HeatingUp: Market Cap > HeatingUp Threshold
    New --> Dead: After [Dead Timeout]
    HeatingUp --> FirstPump: Market Cap > First Pump Threshold
    HeatingUp --> Dead: After [Dead Timeout]
    FirstPump --> Drawdown: Price Drop > Drawdown Min
    FirstPump --> Dead: After [Dead Timeout]
    Drawdown --> Pumping: Price Rise > Recovery Threshold
    Drawdown --> Dead: Market Cap < Dead Threshold
    Pumping --> InPosition: If position opened
    Pumping --> Drawdown: Price Drop > Drawdown Min
    Pumping --> Dead: Market Cap < Dead Threshold
    Pumping --> Dead: After [Dead Timeout]
    Drawdown --> Dead: After [Dead Timeout]
    Dead --> [*]

# Architecture Overview

## Component Communication Flow

```mermaid
graph TD
    A[TokenTracker] -->|Manages State| B[TokenState]
    A -->|Validates Safety| C[SafetyChecker]
    A -->|Manages Positions| D[PositionManager]
    A -->|Broadcasts Events| E[WebSocket]

    D -->|Returns Results| A
    B -->|Provides State| A
    C -->|Returns Validation| A
````

## Position Management Flow

```mermaid
sequenceDiagram
    participant TT as TokenTracker
    participant PM as PositionManager
    participant WS as WebSocket

    TT->>PM: openPosition(mint, marketCap)
    PM-->>TT: position object
    TT->>WS: broadcast("positionOpened")

    TT->>PM: closePosition(mint, position, exitPrice)
    PM-->>TT: result object
    TT->>WS: broadcast("positionClosed")
```

## Event Broadcasting

All events are centralized through TokenTracker:

- Position Events (opened, closed, loss)
- State Changes (heating up, pumping, drawdown)
- Safety Alerts (concentration, creator selling)

## Configuration Management

```mermaid
graph LR
    A[config.js] -->|Trading Params| B[TokenTracker]
    A -->|Position Params| C[PositionManager]
    A -->|Safety Thresholds| D[SafetyChecker]
```

## Error Handling

```mermaid
graph TD
    A[Error Occurs] -->|Caught By| B[Component]
    B -->|Logged| C[Console]
    B -->|Broadcasted| D[WebSocket]
    B -->|State Updated| E[TokenState]
```

# WebSocket Communication

```mermaid
sequenceDiagram
    participant PP as PumpPortal
    participant Bot as Trading Bot
    participant DB as Dashboard

    Bot->>PP: Subscribe to New Tokens
    PP-->>Bot: Token Creation Event
    Bot->>PP: Subscribe to Token Trades

    loop Trade Monitoring
        PP-->>Bot: Trade Update
        Bot->>Bot: Process State Changes
        Bot->>DB: Broadcast Updates
    end

    alt Token Dies
        Bot->>PP: Unsubscribe from Token
        Bot->>DB: Broadcast Token Death
    end
```

# Error Handling

```mermaid
sequenceDiagram
    participant WS as WebSocket
    participant TT as TokenTracker
    participant PM as PositionManager

    WS->>TT: Connection Lost
    TT->>TT: Queue Updates
    TT->>WS: Attempt Reconnect

    alt Reconnection Success
        WS-->>TT: Connection Restored
        TT->>TT: Process Queued Updates
    else Reconnection Failure
        TT->>PM: Mark Positions as Loss
        TT->>TT: Clean Up State
    end
```
