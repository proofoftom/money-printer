# Trading Scenarios

This document outlines the various trading scenarios handled by the system.

## Initial Pump Detection

```mermaid
stateDiagram-v2
    [*] --> HeatingUp || Overbought if intial market cap > `config.thresholds.heatingUp`
    HeatingUp --> FirstPump: Volume/Price Increase
    FirstPump --> Drawdown: Price Drops
    Drawdown --> Recovery: Price Increases || UnsafeRecovery: Price Increases but Not Safe || TokenDeath: Price Drops Below `config.thresholds.dead`
    Recovery -> EnterPosition: Safety Check Passes || TokenDeath
    UnsafeRecovery -> EnterPosition: Safety Check Passes || TokenDeath
    EnterPosition --> InPosition: Position Opened
    InPosition --> TakeProfit: Hits Target || StopLoss || TrailingTakeProfit || TrailingStopLoss
    TakeProfit --> Closed: Exit Position
    TrailingTakeProfit --> Closed: Exit Position
    TrailingStopLoss --> Closed: Exit Position
    StopLoss --> Closed: Exit Position
    TokenDeath --> Closed: Exit Position
```

It should be noted that the system uses either trailing take profit OR fixed take profit exclusively, based on the `trailingTakeProfit` configuration. Both mechanisms cannot be active simultaneously.

## Take Profit Scenarios

### Standard Take Profit

```mermaid
stateDiagram-v2
    [*] --> InPosition
    InPosition --> TakeProfit: Hits Target
    TakeProfit --> Closed: Exit Position
```

### Trailing Take Profit

```mermaid
stateDiagram-v2
    [*] --> TrackingPumpPeak
    TrackingPumpPeak --> OpenPosition: Entry Conditions Met
    OpenPosition --> TrackingTrailingPeak: Take Profit Hit
    TrackingTrailingPeak --> UpdateTrailingPeak: New High
    UpdateTrailingPeak --> TrackingTrailingPeak
    TrackingTrailingPeak --> ClosePosition: Trail Triggered
```

## Stop Loss Scenarios

### Standard Stop Loss

```mermaid
stateDiagram-v2
    [*] --> InPosition
    InPosition --> StopLoss: Price Drops Below `config.thresholds.stopLoss`
    StopLoss --> Closed: Exit Position
```

### Trailing Stop Loss

```mermaid
stateDiagram-v2
    [*] --> TrackingPumpPeak
    TrackingPumpPeak --> OpenPosition: Entry Conditions Met
    OpenPosition --> TrackingTrailingPeak: Take Profit Hit
    TrackingTrailingPeak --> UpdateTrailingPeak: New High
    UpdateTrailingPeak --> TrackingTrailingPeak
    TrackingTrailingPeak --> ClosePosition: Trail Triggered
```

### Trailing Stop Loss and Take Profit

```mermaid
stateDiagram-v2
    [*] --> TrackingPumpPeak
    TrackingPumpPeak --> OpenPosition: Entry Conditions Met
    OpenPosition --> TrackingTrailingPeak: Take Profit Hit
    TrackingTrailingPeak --> UpdateTrailingPeak: New High
    UpdateTrailingPeak --> TrackingTrailingPeak
    TrackingTrailingPeak --> ClosePosition: Trail Triggered
```

## Position Opening Types

```mermaid
graph TD
    A[Recovery Detected] --> B{Safety Check}
    B -->|Pass| C[Open Position]
    B -->|Fail| D[Skip Token]
```

The PositionManager handles both trailing stop loss and take profit scenarios, ensuring that positions are managed according to the configured strategies.
