const Trader = require('../../src/core/trader/Trader');
const config = require('../../utils/config');

describe('Trader', () => {
    let trader;
    const address = '0x1234567890123456789012345678901234567890';
    const mockTrade = {
        trader: address,
        tokenIn: '0xTokenIn',
        tokenOut: '0xTokenOut',
        amountIn: '1000000000000000000',
        amountOut: '500000000',
        timestamp: Date.now()
    };

    beforeEach(() => {
        trader = new Trader(address);
    });

    describe('constructor', () => {
        it('should initialize with correct address', () => {
            expect(trader.address).toBe(address.toLowerCase());
        });

        it('should initialize empty balances and trade history', () => {
            expect(trader.balances.size).toBe(0);
            expect(trader.trades.length).toBe(0);
        });
    });

    describe('processTrade', () => {
        it('should update balances correctly', () => {
            const trade = {
                tokenIn: '0x1234',
                tokenOut: '0x5678',
                amountIn: '1000',
                amountOut: '900',
                timestamp: Date.now()
            };
            
            trader.processTrade(trade);
            
            expect(trader.balances.get('0x1234').toString()).toBe('-1000');
            expect(trader.balances.get('0x5678').toString()).toBe('900');
        });

        it('should maintain trade history', () => {
            const trade = {
                tokenIn: '0x1234',
                tokenOut: '0x5678',
                amountIn: '1000',
                amountOut: '900',
                timestamp: Date.now()
            };
            
            trader.processTrade(trade);
            expect(trader.trades.length).toBe(1);
            expect(trader.trades.peek()).toEqual(trade);
        });

        it('should update lastActivity timestamp', () => {
            const beforeTime = Date.now();
            const trade = {
                tokenIn: '0x1234',
                tokenOut: '0x5678',
                amountIn: '1000',
                amountOut: '900',
                timestamp: Date.now()
            };
            
            trader.processTrade(trade);
            expect(trader.lastActivity).toBeGreaterThanOrEqual(beforeTime);
        });
    });

    describe('suspicious activity detection', () => {
        it('should detect wash trading patterns', (done) => {
            trader.on('suspiciousActivity', (data) => {
                expect(data.type).toBe('washTrading');
                expect(data.trader).toBe(address.toLowerCase());
                done();
            });

            // Make two quick trades with the same token
            const trade = {
                tokenIn: '0x1234',
                tokenOut: '0x5678',
                amountIn: '1000',
                amountOut: '900',
                timestamp: Date.now()
            };
            
            trader.processTrade(trade);
            trader.processTrade({
                ...trade,
                tokenIn: '0x5678',
                tokenOut: '0x1234'
            });
        });
    });

    describe('balance tracking', () => {
        it('should track balance history', () => {
            const token = '0x1234';
            const amount = BigInt('1000');
            
            trader.updateBalance(token, amount);
            
            const history = trader.balanceHistory.get(token);
            expect(history.length).toBe(1);
            expect(history.peek().balance.toString()).toBe('1000');
            expect(history.peek().change.toString()).toBe('1000');
        });
    });

    describe('state management', () => {
        it('should correctly save and load state', () => {
            trader.processTrade(mockTrade);
            const state = trader.getState();
            
            const newTrader = new Trader(address);
            newTrader.loadState(state);
            
            expect(newTrader.balances.get(mockTrade.tokenIn.toLowerCase()))
                .toEqual(trader.balances.get(mockTrade.tokenIn.toLowerCase()));
            expect(newTrader.trades.length).toBe(trader.trades.length);
        });
    });

    describe('activity tracking', () => {
        it('should correctly identify inactive traders', () => {
            trader.lastActivity = Date.now() - (config.TRADER.INACTIVE_THRESHOLD + 1000);
            expect(trader.isInactive()).toBe(true);
        });

        it('should identify active traders', () => {
            trader.processTrade(mockTrade);
            expect(trader.isInactive()).toBe(false);
        });
    });
});
