const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const Trader = require('./Trader');
const config = require('../../utils/config');

class TraderManager extends EventEmitter {
    constructor() {
        super();
        this.traders = new Map();
        this.stateFile = path.join(process.cwd(), 'data', 'traders.json');
        
        // Ensure data directory exists
        this.ensureDataDirectory();
        
        // Load existing trader data
        this.loadTraders();
        
        // Don't set up intervals in test mode
        if (process.env.NODE_ENV !== 'test') {
            // Set up periodic state persistence
            this.saveInterval = setInterval(() => this.saveTraders(), config.TRADER.SAVE_INTERVAL);
            
            // Inactive trader cleanup
            this.cleanupInterval = setInterval(() => this.cleanupInactiveTraders(), config.TRADER.CLEANUP_INTERVAL);
        }
    }

    async ensureDataDirectory() {
        const dataDir = path.dirname(this.stateFile);
        try {
            await fs.mkdir(dataDir, { recursive: true });
        } catch (error) {
            console.error('Error creating data directory:', error);
        }
    }

    /**
     * Get or create a trader instance
     * @param {string} address Trader's address
     */
    getTrader(address) {
        const normalizedAddress = address.toLowerCase();
        if (!this.traders.has(normalizedAddress)) {
            const trader = new Trader(normalizedAddress);
            
            // Forward suspicious activity events
            trader.on('suspiciousActivity', (data) => {
                this.emit('suspiciousActivity', data);
            });
            
            this.traders.set(normalizedAddress, trader);
        }
        return this.traders.get(normalizedAddress);
    }

    /**
     * Process a trade for a trader
     * @param {Object} trade Trade data
     */
    processTrade(trade) {
        const trader = this.getTrader(trade.trader);
        trader.processTrade(trade);
    }

    /**
     * Save all trader states to disk
     */
    async saveTraders() {
        try {
            const traderStates = {};
            for (const [address, trader] of this.traders) {
                traderStates[address] = trader.getState();
            }
            
            await fs.writeFile(
                this.stateFile,
                JSON.stringify(traderStates, null, 2)
            );
        } catch (error) {
            console.error('Error saving trader states:', error);
            this.emit('error', { type: 'saveFailed', error });
        }
    }

    /**
     * Load trader states from disk
     */
    async loadTraders() {
        try {
            const data = await fs.readFile(this.stateFile, 'utf8');
            const traderStates = JSON.parse(data);
            
            for (const [address, state] of Object.entries(traderStates)) {
                const trader = new Trader(address);
                trader.loadState(state);
                this.traders.set(address.toLowerCase(), trader);
            }
        } catch (error) {
            // If file doesn't exist, that's okay - we'll create it when saving
            if (error.code === 'ENOENT') {
                console.info('No existing trader states found. Starting fresh.');
                return;
            }
            // For other errors, log them but don't crash
            console.error('Error loading trader states:', error);
            throw error; // Re-throw to be caught by global error handler
        }
    }

    /**
     * Save a trader's state to disk
     * @private
     */
    async saveTraderState(trader) {
        const traderState = trader.getState();
        const traderFile = path.join(process.cwd(), 'data', 'traders', `${trader.address}.json`);
        await fs.writeFile(traderFile, JSON.stringify(traderState, null, 2));
    }

    /**
     * Clean up inactive traders
     */
    async cleanupInactiveTraders() {
        const now = Date.now();
        const inactiveThreshold = config.TRADER.INACTIVE_THRESHOLD;
        const inactiveTraders = [];

        for (const [address, trader] of this.traders.entries()) {
            const timeSinceLastActivity = now - trader.lastActivity;
            if (timeSinceLastActivity > inactiveThreshold) {
                try {
                    // Save trader state before removing
                    await this.saveTraderState(trader);
                    
                    // Remove trader
                    this.traders.delete(address);
                    inactiveTraders.push(address);
                    
                    // Clean up trader resources
                    trader.removeAllListeners();
                } catch (error) {
                    console.error('Error cleaning up trader:', error);
                }
            }
        }

        if (inactiveTraders.length > 0) {
            this.emit('cleanup', { removedTraders: inactiveTraders });
        }

        return inactiveTraders;
    }

    /**
     * Get active trader count
     */
    getActiveTraderCount() {
        return this.traders.size;
    }

    /**
     * Clean up resources
     */
    async destroy() {
        if (this.saveInterval) clearInterval(this.saveInterval);
        if (this.cleanupInterval) clearInterval(this.cleanupInterval);
        await this.saveTraders();
    }
}

module.exports = TraderManager;
