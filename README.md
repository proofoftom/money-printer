# Money Printer Trading Bot

An automated trading bot for monitoring and trading tokens based on market behavior and technical analysis.

## Features

- Real-time token monitoring and analysis
- Automated position management
- Advanced safety checks and risk management
- Customizable trading strategies
- Comprehensive error logging
- Beautiful terminal-based dashboard

## Configuration

The bot's behavior can be configured through environment variables and the `config.js` file. Key configuration options include:

### Testing Mode

For testing purposes, you can clear all saved data (traders, tokens, positions) on startup by setting:

```bash
CLEAR_DATA_ON_START=true
```

This is useful for:
- Running tests with a clean state
- Debugging issues with saved data
- Starting fresh after code changes

### Trading Parameters

Adjust trading parameters in `src/utils/config.js`:
- Market cap thresholds
- Position sizing
- Exit strategies
- Safety checks

## Development

### Prerequisites

- Node.js >= 14
- npm >= 6

### Installation

```bash
npm install
```

### Running

```bash
# Normal mode
npm start

# Testing mode (clears all data)
CLEAR_DATA_ON_START=true npm start
```

## Error Handling

The bot uses a centralized error logging system that saves all errors to JSON files in the `logs/errors` directory. Each error log includes:
- Timestamp
- Error type and message
- Component where the error occurred
- Additional context and metadata

## Data Management

Trading data is stored in JSON files in the `data` directory:
- `positions.json`: Active and historical trading positions
- `traders.json`: Trader information and statistics
- `tokens.json`: Token states and metrics

Use the testing mode to clear this data when needed.
