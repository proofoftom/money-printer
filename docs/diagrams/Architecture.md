# Money Printer System Architecture

## System Overview

The Money Printer is an automated trading system designed to identify and trade tokens based on market conditions, volume patterns, and safety metrics. The system comprises several interconnected components that work together to analyze market data, make trading decisions, and manage positions.

```mermaid
graph TD
    PP[PumpPortal WebSocket] -->|Trade Data| WM[WebSocket Manager]
    WM -->|Token Updates| TT[Token Tracker]
    TT -->|Token State| D[Dashboard]
    
    subgraph Core Components
        TT -->|Safety Checks| SC[Safety Checker]
        TT -->|Position Management| PM[PositionManager]
        TT -->|Price Data| PR[Price Manager]
        TT -->|Token Data| T[Token]
    end

    subgraph Logging & Analytics
        TT -->|Errors| EL[Error Logger]
        TT -->|Stats| SL[Stats Logger]
        TT -->|Safety Logs| SL2[Safety Logger]
    end

    subgraph Position Management
        PM -->|Exit Checks| ES[Exit Strategies]
        PM -->|Balance| W[Wallet]
        PM -->|Simulation| TS[Transaction Simulator]
    end
```

## Component Responsibilities

### Core Components
- **WebSocket Manager**: Handles real-time data stream from PumpPortal, processes trade events
- **Token Tracker**: Central coordinator managing token lifecycle and state transitions
- **Token**: Maintains token-specific data including volume history, holder metrics, and price information
- **Position Manager**: Manages trading positions, entry/exit execution, and portfolio balance
- **Safety Checker**: Validates token safety through holder analysis and market conditions
- **Price Manager**: Handles price conversions and maintains current market rates

### Logging & Analytics
- **Error Logger**: Centralized error tracking and reporting
- **Stats Logger**: Records trading statistics and performance metrics
- **Safety Logger**: Tracks safety-related events and violations

### Position Management
- **Exit Strategies**: Implements various exit conditions including take profit, stop loss, and volume-based exits
- **Wallet**: Manages account balance and transaction history
- **Transaction Simulator**: Simulates transaction outcomes for risk assessment

## Token Lifecycle

```mermaid
stateDiagram-v2
    [*] --> New: Token Created
    New --> HeatingUp: Market Cap > Threshold
    HeatingUp --> FirstPump: Volume Increase
    HeatingUp --> Dead: Timeout/Low Activity
    FirstPump --> Drawdown: Price Decrease
    FirstPump --> Dead: Safety Check Fail
    Drawdown --> Pumping: Price Recovery
    Drawdown --> Dead: Extended Drawdown
    Pumping --> InPosition: Position Opened
    Pumping --> Dead: Volume Drop
    InPosition --> Closed: Exit Strategy Triggered
    Closed --> [*]
    Dead --> [*]
```

## Data Flow

1. **Market Data Ingestion**
   - WebSocket Manager receives real-time trade data
   - Data is validated and normalized
   - Token updates are broadcast to Token Tracker

2. **Token Processing**
   - Token Tracker updates token states
   - Safety checks are performed
   - Volume and price metrics are calculated
   - State transitions are evaluated

3. **Trading Operations**
   - Position Manager evaluates entry conditions
   - Exit Strategies monitor active positions
   - Transaction Simulator validates trade feasibility
   - Wallet updates reflect position changes

4. **Monitoring & Feedback**
   - Dashboard displays real-time system state
   - Loggers record system events and metrics
   - Performance statistics are updated
   - Safety violations are tracked and reported

## Configuration

The system is highly configurable through `config.js`, allowing adjustment of:
- Trading parameters
- Safety thresholds
- Volume requirements
- Exit strategy settings
- Network configurations
- Logging preferences
