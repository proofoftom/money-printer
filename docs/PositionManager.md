# PositionManager Component Documentation

## Overview

The PositionManager handles all aspects of trading positions, including opening, closing, and profit/loss calculations. It focuses solely on position management and wallet balance calculations, while event broadcasting is handled by the TokenTracker.

## Core Functionality

### Position Opening

```javascript
openPosition(mint, marketCap);
```

Creates a new trading position:

- Allocates position size from account balance
- Records entry price and timestamp
- Deducts transaction fees
- Returns position object for TokenTracker to manage

### Position Closing

```javascript
closePosition(mint, position, exitPrice, reason);
```

Handles position closure:

- Calculates profit/loss
- Updates account balance
- Records trade statistics
- Returns trade result object containing:
  - Entry/Exit prices
  - PnL
  - Updated wallet balance
  - Win/Loss statistics

### Position Loss Handling

```javascript
closePosition(mint, position, 0, "total_loss");
```

Special case for total loss if position value is less than transaction fees:

- Records position as a loss
- Updates statistics
- Returns loss result without deducting additional fees

## Wallet Balance Management

### Balance Calculations

1. **Initial Balance**

   - Tracks starting balance for reference
   - Used for calculating overall P&L

2. **Position Deductions**

   - Position size deducted on open
   - Transaction fees applied
   - All calculations rounded to 2 decimal places

3. **Profit/Loss Handling**
   - Profits added to balance
   - Losses deducted from balance
   - Transaction fees applied to all trades

## Integration with TokenTracker

### Event Flow

1. TokenTracker calls PositionManager methods
2. PositionManager performs calculations and updates
3. TokenTracker handles all event broadcasting

### Responsibility Separation

- PositionManager: Position and balance calculations
- TokenTracker: State management and event broadcasting

## Configuration

### Trading Parameters

- Position size
- Transaction fees
- Stop loss thresholds
- Take profit targets

### Trailing Stops

- Trailing stop loss
- Trailing take profit
- Configurable thresholds

## Error Handling

- Insufficient balance

## Suggestions for Improvement

- Ensure clear separation of concerns between position management and event broadcasting.
- Add more detailed error handling for edge cases like insufficient balance.
