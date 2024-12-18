const TraderManager = require('../../src/core/trader/TraderManager');
const fs = require('fs').promises;
const path = require('path');
const config = require('../../utils/config');

jest.mock('fs', () => ({
    promises: {
        mkdir: jest.fn().mockResolvedValue(undefined),
        writeFile: jest.fn().mockResolvedValue(undefined),
        readFile: jest.fn().mockRejectedValue({ code: 'ENOENT' }) // Simulate no file initially
    }
}));

describe('TraderManager', () => {
    let manager;
    const mockAddress = '0x1234567890123456789012345678901234567890';
    const mockTrade = {
        trader: mockAddress,
        tokenIn: '0xTokenIn',
        tokenOut: '0xTokenOut',
        amountIn: '1000000000000000000',
        amountOut: '500000000',
        timestamp: Date.now()
    };

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset readFile mock to simulate no file
        fs.readFile.mockRejectedValue({ code: 'ENOENT' });
        manager = new TraderManager();
    });

    afterEach(async () => {
        await manager.destroy();
    });

    describe('initialization', () => {
        it('should create data directory on startup', () => {
            expect(fs.mkdir).toHaveBeenCalled();
        });

        it('should attempt to load existing traders', () => {
            expect(fs.readFile).toHaveBeenCalled();
        });
    });

    describe('trader management', () => {
        it('should create new trader instances', () => {
            const trader = manager.getTrader(mockAddress);
            expect(trader).toBeDefined();
            expect(trader.address).toBe(mockAddress.toLowerCase());
        });

        it('should reuse existing trader instances', () => {
            const trader1 = manager.getTrader(mockAddress);
            const trader2 = manager.getTrader(mockAddress);
            expect(trader1).toBe(trader2);
        });

        it('should process trades for traders', () => {
            const trader = manager.getTrader(mockAddress);
            jest.spyOn(trader, 'processTrade');
            
            manager.processTrade(mockTrade);
            expect(trader.processTrade).toHaveBeenCalledWith(mockTrade);
        });
    });

    describe('event forwarding', () => {
        it('should forward suspicious activity events', (done) => {
            const trader = manager.getTrader(mockAddress);
            
            manager.on('suspiciousActivity', (data) => {
                expect(data.type).toBe('washTrading');
                expect(data.trader).toBe(mockAddress.toLowerCase());
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

    describe('state persistence', () => {
        it('should save trader states', async () => {
            manager.processTrade(mockTrade);
            await manager.saveTraders();
            
            expect(fs.writeFile).toHaveBeenCalled();
            const savedData = JSON.parse(fs.writeFile.mock.calls[0][1]);
            expect(savedData[mockAddress.toLowerCase()]).toBeDefined();
        });

        it('should load trader states', async () => {
            const mockState = {
                [mockAddress.toLowerCase()]: {
                    address: mockAddress.toLowerCase(),
                    trades: [mockTrade],
                    balances: {
                        ['0xTokenIn'.toLowerCase()]: '-1000000000000000000',
                        ['0xTokenOut'.toLowerCase()]: '500000000'
                    },
                    balanceHistory: {
                        ['0xTokenIn'.toLowerCase()]: [{
                            timestamp: Date.now(),
                            balance: '-1000000000000000000',
                            change: '-1000000000000000000'
                        }],
                        ['0xTokenOut'.toLowerCase()]: [{
                            timestamp: Date.now(),
                            balance: '500000000',
                            change: '500000000'
                        }]
                    },
                    lastActivity: Date.now(),
                    suspiciousActivityCount: 0,
                    tradeVolume24h: 0,
                    lastTradeTimestamps: {}
                }
            };

            fs.readFile.mockResolvedValueOnce(JSON.stringify(mockState));
            await manager.loadTraders();
            
            const trader = manager.getTrader(mockAddress);
            expect(trader.trades.length).toBe(1);
            expect(trader.balances.get('0xtokenin')).toBeDefined();
        });
    });

    describe('cleanup', () => {
        beforeEach(() => {
            // Ensure we have a fresh trader instance
            manager.traders.clear();
        });

        it('should remove inactive traders', async () => {
            const trader = manager.getTrader(mockAddress);
            // Set last activity far in the past
            const inactiveTime = config.TRADER.INACTIVE_THRESHOLD + 1000;
            trader.lastActivity = Date.now() - inactiveTime;
            
            const removedTraders = await manager.cleanupInactiveTraders();
            expect(removedTraders).toContain(mockAddress.toLowerCase());
            expect(manager.traders.has(mockAddress.toLowerCase())).toBe(false);
        });

        it('should emit cleanup event', async () => {
            const trader = manager.getTrader(mockAddress);
            // Set last activity far in the past
            const inactiveTime = config.TRADER.INACTIVE_THRESHOLD + 1000;
            trader.lastActivity = Date.now() - inactiveTime;

            const cleanupPromise = new Promise((resolve) => {
                manager.once('cleanup', (data) => {
                    expect(data.removedTraders).toContain(mockAddress.toLowerCase());
                    resolve();
                });
            });

            await manager.cleanupInactiveTraders();
            await cleanupPromise;
        });
    });

    describe('resource management', () => {
        it('should clean up resources on destroy', async () => {
            jest.spyOn(manager, 'saveTraders');
            await manager.destroy();
            expect(manager.saveTraders).toHaveBeenCalled();
        });
    });
});
