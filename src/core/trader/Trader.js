const EventEmitter = require('events');
const CircularBuffer = require('../../utils/CircularBuffer');
const config = require('../../../utils/config');

class Trader extends EventEmitter {
    constructor(address) {
        super();
        this.address = address.toLowerCase();
        this.trades = new CircularBuffer(1000); // Store last 1000 trades
        this.balances = new Map(); // token address -> balance
        this.balanceHistory = new Map(); // token address -> CircularBuffer of balance changes
        this.lastActivity = Date.now();
        this.suspiciousActivityCount = 0;
        this.tradeVolume24h = 0;
        this.lastTradeTimestamps = new Map(); // token address -> last trade timestamp
    }

    /**
     * Process a new trade for this trader
     * @param {Object} trade The trade object
     * @param {string} trade.tokenIn Input token address
     * @param {string} trade.tokenOut Output token address
     * @param {string} trade.amountIn Input amount in base units
     * @param {string} trade.amountOut Output amount in base units
     * @param {number} trade.timestamp Trade timestamp
     */
    processTrade(trade) {
        // Update last activity timestamp first
        this.lastActivity = Date.now();

        // Update balances
        const tokenIn = trade.tokenIn.toLowerCase();
        const tokenOut = trade.tokenOut.toLowerCase();
        const amountIn = BigInt(trade.amountIn);
        const amountOut = BigInt(trade.amountOut);

        // Deduct input token
        this.updateBalance(tokenIn, -amountIn);
        
        // Add output token
        this.updateBalance(tokenOut, amountOut);

        // Add to trade history
        this.trades.push(trade);

        // Update trade volume and check for suspicious activity
        this.updateTradeVolume(trade);
        this.detectSuspiciousActivity(trade);
    }

    /**
     * Update token balance and history
     * @param {string} token Token address
     * @param {BigInt} change Balance change amount
     */
    updateBalance(token, change) {
        const tokenAddress = token.toLowerCase();
        const currentBalance = this.balances.get(tokenAddress) || BigInt(0);
        const newBalance = currentBalance + change;
        
        // Update current balance
        this.balances.set(tokenAddress, newBalance);
        
        // Update balance history
        if (!this.balanceHistory.has(tokenAddress)) {
            this.balanceHistory.set(tokenAddress, new CircularBuffer(100));
        }
        
        this.balanceHistory.get(tokenAddress).push({
            timestamp: Date.now(),
            balance: newBalance,
            change: change
        });
    }

    /**
     * Update 24h trading volume
     */
    updateTradeVolume(trade) {
        const now = Date.now();
        const oneDayAgo = now - 24 * 60 * 60 * 1000;
        
        // Remove old trades from volume calculation
        while (this.trades.length > 0 && this.trades.peek().timestamp < oneDayAgo) {
            const oldTrade = this.trades.shift();
            this.tradeVolume24h -= Number(oldTrade.amountIn);
        }
        
        // Add new trade to volume
        this.tradeVolume24h += Number(trade.amountIn);
    }

    /**
     * Detect suspicious trading patterns
     */
    detectSuspiciousActivity(trade) {
        const tokenIn = trade.tokenIn.toLowerCase();
        const tokenOut = trade.tokenOut.toLowerCase();
        const now = Date.now();
        
        // Check for wash trading (rapid back-and-forth trades)
        if (this.lastTradeTimestamps.has(tokenIn)) {
            const timeSinceLastTrade = now - this.lastTradeTimestamps.get(tokenIn);
            if (timeSinceLastTrade < config.TRADER.SUSPICIOUS_TRADE_INTERVAL) {
                this.suspiciousActivityCount++;
                this.emit('suspiciousActivity', {
                    trader: this.address,
                    type: 'washTrading',
                    trade: trade
                });
            }
        }
        
        // Store last trade timestamp for each token
        this.lastTradeTimestamps.set(tokenIn, now);
        this.lastTradeTimestamps.set(tokenOut, now);
        
        // Reset suspicious activity count periodically
        if (now - this.lastActivity > config.TRADER.SUSPICIOUS_ACTIVITY_RESET_INTERVAL) {
            this.suspiciousActivityCount = 0;
        }
    }

    /**
     * Get trader's current state for persistence
     */
    getState() {
        const balanceEntries = Array.from(this.balances.entries()).map(([token, balance]) => [
            token,
            balance.toString() // Convert BigInt to string
        ]);

        const balanceHistoryEntries = Array.from(this.balanceHistory.entries()).map(([token, history]) => [
            token,
            history.toArray().map(entry => ({
                ...entry,
                balance: entry.balance.toString(),
                change: entry.change.toString()
            }))
        ]);

        return {
            address: this.address,
            trades: this.trades.toArray(),
            balances: Object.fromEntries(balanceEntries),
            balanceHistory: Object.fromEntries(balanceHistoryEntries),
            lastActivity: this.lastActivity,
            suspiciousActivityCount: this.suspiciousActivityCount,
            tradeVolume24h: this.tradeVolume24h,
            lastTradeTimestamps: Object.fromEntries(this.lastTradeTimestamps)
        };
    }

    /**
     * Load trader state from persistence
     */
    loadState(state) {
        this.address = state.address;
        this.trades = new CircularBuffer(1000, state.trades);
        
        // Convert balance strings back to BigInt
        this.balances = new Map(
            Object.entries(state.balances).map(([token, balance]) => [
                token,
                BigInt(balance)
            ])
        );
        
        // Reconstruct balance history with BigInt values
        this.balanceHistory = new Map();
        for (const [token, history] of Object.entries(state.balanceHistory)) {
            this.balanceHistory.set(
                token,
                new CircularBuffer(
                    100,
                    history.map(entry => ({
                        ...entry,
                        balance: BigInt(entry.balance),
                        change: BigInt(entry.change)
                    }))
                )
            );
        }
        
        this.lastActivity = state.lastActivity;
        this.suspiciousActivityCount = state.suspiciousActivityCount;
        this.tradeVolume24h = state.tradeVolume24h;
        this.lastTradeTimestamps = new Map(Object.entries(state.lastTradeTimestamps));
    }

    /**
     * Check if trader is inactive
     */
    isInactive(thresholdMs = config.TRADER.INACTIVE_THRESHOLD) {
        return Date.now() - this.lastActivity > thresholdMs;
    }
}

module.exports = Trader;
