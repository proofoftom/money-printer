# Trading Scenarios

This document outlines the various trading scenarios and state transitions handled by the system.

## Token Lifecycle Overview

```mermaid
stateDiagram-v2
    [*] --> New: Token Discovery
    New --> HeatingUp: Market Cap > threshold
    New --> Dead: Timeout || Invalid
    HeatingUp --> FirstPump: Volume/Price Surge
    HeatingUp --> Dead: Timeout || Price Drop
    FirstPump --> Drawdown: Price Decline
    FirstPump --> Dead: Severe Drop
    Drawdown --> Recovery: Price Recovery + Safe
    Drawdown --> UnsafeRecovery: Price Recovery + Unsafe
    Drawdown --> Dead: Extended Decline
    Recovery --> InPosition: Entry Conditions Met
    UnsafeRecovery --> Recovery: Safety Checks Pass
    UnsafeRecovery --> Dead: Safety Checks Fail
    InPosition --> ExitEvaluation: Exit Conditions
    ExitEvaluation --> Closed: Position Closed
    Dead --> [*]
    Closed --> [*]
```

## Position Entry Scenarios

### Standard Entry
```mermaid
stateDiagram-v2
    [*] --> Recovery
    Recovery --> SafetyCheck: Price Recovery
    SafetyCheck --> MarketAnalysis: Checks Pass
    MarketAnalysis --> PositionSizing: Analysis Complete
    PositionSizing --> InPosition: Position Opened
    SafetyCheck --> Rejected: Checks Fail
    MarketAnalysis --> Rejected: Poor Conditions
    Rejected --> [*]
```

### Dynamic Entry with Volume Analysis
```mermaid
stateDiagram-v2
    [*] --> VolumeAnalysis
    VolumeAnalysis --> HighVolume: Volume > Threshold
    VolumeAnalysis --> LowVolume: Volume < Threshold
    HighVolume --> StandardEntry: Use Standard Size
    LowVolume --> ReducedEntry: Reduce Position Size
    StandardEntry --> InPosition
    ReducedEntry --> InPosition
```

## Exit Strategies

### Multi-Condition Exit
```mermaid
stateDiagram-v2
    [*] --> InPosition
    InPosition --> MonitoringState
    MonitoringState --> TakeProfit: Price >= Target
    MonitoringState --> StopLoss: Price <= Stop
    MonitoringState --> VolumeExit: Volume Decline
    MonitoringState --> TimeExit: Time Threshold
    TakeProfit --> Closed
    StopLoss --> Closed
    VolumeExit --> Closed
    TimeExit --> Closed
```

### Trailing Take Profit
```mermaid
stateDiagram-v2
    [*] --> InPosition
    InPosition --> TrackingPeak: Position Opened
    TrackingPeak --> UpdatePeak: New High
    UpdatePeak --> TrackingPeak
    TrackingPeak --> EvaluateExit: Drawdown > Trail
    EvaluateExit --> Closed: Exit Confirmed
    EvaluateExit --> TrackingPeak: Continue Tracking
```

### Dynamic Stop Loss
```mermaid
stateDiagram-v2
    [*] --> InPosition
    InPosition --> InitialStop: Set Initial Stop
    InitialStop --> MonitorVolume
    MonitorVolume --> AdjustStop: Volume Change
    AdjustStop --> MonitorVolume
    MonitorVolume --> StopTriggered: Price <= Stop
    StopTriggered --> Closed
```

## Risk Management Scenarios

### Position Sizing
```mermaid
graph TD
    A[Market Analysis] --> B{Market Cap Check}
    B -->|Large Cap| C[Standard Size]
    B -->|Medium Cap| D[Reduced Size]
    B -->|Small Cap| E[Minimum Size]
    C --> F[Apply Volatility Multiplier]
    D --> F
    E --> F
    F --> G[Final Position Size]
```

### Safety Validation
```mermaid
graph TD
    A[Token Analysis] --> B{Holder Distribution}
    B -->|Concentrated| C[Reject Token]
    B -->|Distributed| D{Liquidity Check}
    D -->|Insufficient| C
    D -->|Sufficient| E{Volume Pattern}
    E -->|Suspicious| C
    E -->|Normal| F[Accept Token]
```

## Event Processing

### Trade Update Flow
```mermaid
sequenceDiagram
    WebSocket->>TokenTracker: Trade Event
    TokenTracker->>PriceManager: Update Price
    PriceManager->>TokenTracker: Price Updated
    TokenTracker->>PositionManager: Evaluate Position
    PositionManager->>SafetyChecker: Validate State
    SafetyChecker->>PositionManager: Validation Result
    PositionManager->>TokenTracker: Position Decision
    TokenTracker->>Dashboard: Update Display
```

## Configuration Notes

1. **Position Management**
   - `trailingTakeProfit`: Enables trailing take profit mechanism
   - `dynamicPositionSizing`: Adjusts position size based on market conditions
   - `multiExitStrategy`: Combines multiple exit conditions

2. **Risk Parameters**
   - `maxPositionSize`: Upper limit for position size
   - `minPositionSize`: Lower limit for position size
   - `riskMultiplier`: Adjusts position size based on volatility

3. **Timing Controls**
   - `entryTimeout`: Maximum time to wait for entry conditions
   - `exitTimeout`: Maximum time to hold position
   - `stateTimeout`: Maximum time in each state

The system uses event-driven architecture to handle state transitions and position management, ensuring responsive and accurate trading execution while maintaining risk management parameters.
