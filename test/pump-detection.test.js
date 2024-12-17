const { expect } = require('chai');
const Token = require('../src/core/token/Token');
const SafetyChecker = require('../src/services/safety/SafetyChecker');
const config = require('../src/utils/config');

describe('Pump Fun Token Strategy Tests', function() {
    let token;
    let safetyChecker;
    let realSafetyChecker;

    beforeEach(function() {
        process.env.NODE_ENV = 'test';
        // Create mock token with initial state
        token = new Token({
            mint: "mockMint123",
            name: "Mock Token",
            symbol: "MOCK",
            minted: Date.now() - 3600000, // 1 hour old
            traderPublicKey: "mockTrader123",
            vTokensInBondingCurve: 1000000,
            vSolInBondingCurve: 10,
            marketCapSol: 7500
        });

        // Create both mock and real safety checkers
        safetyChecker = {
            runSecurityChecks: async () => true,
            getFailureReason: () => ({ reason: 'No failure', value: null })
        };
        
        realSafetyChecker = new SafetyChecker(config);
    });

    afterEach(function() {
        process.env.NODE_ENV = undefined;
        if (token) {
            token.cleanup();
        }
        if (realSafetyChecker) {
            realSafetyChecker.cleanup && realSafetyChecker.cleanup();
        }
    });

    describe('Token State Transitions', () => {
        it('should follow correct state sequence', async function() {
            this.timeout(10000); // Increase timeout for state transitions
            const states = [];
            token.on('stateChanged', ({ from, to }) => states.push(to));

            // Start heating up
            await simulatePriceMovement(token, 7500, 9000, 15);
            token.setState("heatingUp");
            expect(token.state).to.equal("heatingUp");
            
            // Move to first pump
            await simulatePriceMovement(token, 9000, 12000, 15);
            token.setState("firstPump");
            expect(token.state).to.equal("firstPump");
            
            // Enter drawdown
            await simulatePriceMovement(token, 12000, 9000, 15);
            token.setState("drawdown");
            expect(token.state).to.equal("drawdown");
            
            // Verify state sequence
            expect(states).to.deep.equal(["heatingUp", "firstPump", "drawdown"]);
        });

        it('should reject invalid state transitions', function() {
            // Can't go directly from new to drawdown
            expect(() => token.setState("drawdown")).to.throw("Invalid state transition");
            
            // Can't go from heatingUp to drawdown
            token.setState("heatingUp");
            expect(() => token.setState("drawdown")).to.throw("Invalid state transition");
            
            // Can't go back to new state
            expect(() => token.setState("new")).to.throw("Invalid state transition");
        });
    });

    describe('Safety Checks', () => {
        it('should fail safety check with high holder concentration', async function() {
            // Setup token with high holder concentration
            for(let i = 0; i < 3; i++) {
                token.traderManager.getOrCreateTrader(`whale${i}`, {
                    tokens: {
                        [token.mint]: {
                            balance: 100000, // Large balance for top holders
                            initialBalance: 100000,
                            firstSeen: Date.now() - 1800000,
                            lastActive: Date.now() - 300000
                        }
                    }
                });
            }

            // Add some smaller holders to make distribution more realistic
            for(let i = 0; i < 7; i++) {
                token.traderManager.getOrCreateTrader(`retail${i}`, {
                    tokens: {
                        [token.mint]: {
                            balance: 1000,
                            initialBalance: 1000,
                            firstSeen: Date.now() - 1800000,
                            lastActive: Date.now() - 300000
                        }
                    }
                });
            }

            // Mock the getTopHolderConcentration method
            token.getTopHolderConcentration = () => 50; // 50% concentration

            const result = await realSafetyChecker.runSecurityChecks(token);
            expect(result).to.be.false;
            const failureReason = realSafetyChecker.getFailureReason();
            expect(failureReason.reason).to.include("concentration");
        });

        it('should fail safety check with insufficient liquidity', async function() {
            token.vSolInBondingCurve = 0.05; // Below MIN_LIQUIDITY_SOL
            const result = await realSafetyChecker.runSecurityChecks(token);
            expect(result).to.be.false;
            const failureReason = realSafetyChecker.getFailureReason();
            expect(failureReason.reason).to.include("liquidity");
        });
    });

    describe('Recovery Mechanics', () => {
        it('should enter position during valid recovery', async function() {
            this.timeout(10000);
            // Setup initial conditions
            await simulatePriceMovement(token, 7500, 9000, 15);
            token.setState("heatingUp");
            
            await simulatePriceMovement(token, 9000, 12000, 15);
            token.setState("firstPump");
            
            await simulatePriceMovement(token, 12000, 9000, 15);
            token.setState("drawdown");
            
            // Set metrics for recovery evaluation
            token.highestMarketCap = 12000;
            token.drawdownLow = 9000;
            token.marketCapSol = 10350; // 15% up from drawdown (above min RECOVERY of 12%, below max of 20%)
            
            // Mock the recovery calculation methods
            token.getRecoveryPercentage = () => 15; // 15% recovery
            token.getGainPercentage = () => 15; // 15% gain
            
            let positionReady = false;
            token.on('readyForPosition', () => {
                positionReady = true;
            });

            await token.evaluateRecovery(safetyChecker);
            expect(positionReady).to.be.true;
            expect(token.getRecoveryPercentage()).to.be.above(12); // config.THRESHOLDS.RECOVERY
            expect(token.getGainPercentage()).to.be.below(20); // config.THRESHOLDS.SAFE_RECOVERY_GAIN
        });

        it('should reject recovery if gain too high', async function() {
            this.timeout(10000);
            // Setup initial conditions
            await simulatePriceMovement(token, 7500, 9000, 15);
            token.setState("heatingUp");
            
            await simulatePriceMovement(token, 9000, 12000, 15);
            token.setState("firstPump");
            
            await simulatePriceMovement(token, 12000, 9000, 15);
            token.setState("drawdown");
            token.setState("unsafeRecovery");
            
            // Set metrics for recovery evaluation
            token.highestMarketCap = 12000;
            token.drawdownLow = 9000;
            token.marketCapSol = 11250; // 25% up from drawdown (above max SAFE_RECOVERY_GAIN of 20%)
            
            // Mock the recovery calculation methods
            token.getRecoveryPercentage = () => 25; // 25% recovery
            token.getGainPercentage = () => 25; // 25% gain
            
            let recoveryTooHigh = false;
            token.on('recoveryGainTooHigh', () => {
                recoveryTooHigh = true;
            });

            await token.evaluateRecovery(safetyChecker);
            expect(recoveryTooHigh).to.be.true;
            expect(token.getGainPercentage()).to.be.above(20); // config.THRESHOLDS.SAFE_RECOVERY_GAIN
        });

        it('should update drawdownLow during continued drawdown', async function() {
            // Setup initial token state
            token.setState("heatingUp");
            token.setState("firstPump");
            token.marketCapSol = 9000;
            token.setState("drawdown"); // This will set drawdownLow to 9000
            
            // Verify initial drawdownLow
            expect(token.drawdownLow).to.equal(9000);

            // Further drawdown should update to new low
            token.marketCapSol = 8000;
            await token.evaluateRecovery(safetyChecker);
            expect(token.drawdownLow).to.equal(8000);
            expect(token.state).to.equal("drawdown");

            // Higher marketCap but still in drawdown should not update drawdownLow
            token.marketCapSol = 8500;
            await token.evaluateRecovery(safetyChecker);
            expect(token.drawdownLow).to.equal(8000);
            expect(token.state).to.equal("drawdown");
        });

        it('should transition between drawdown and unsafeRecovery states', async function() {
            // Setup initial token state
            token.setState("heatingUp");
            token.setState("firstPump");
            token.marketCapSol = 9000;
            token.setState("drawdown"); // This will set drawdownLow to 9000
            
            // Mock unsafe conditions
            safetyChecker.runSecurityChecks = async () => false;
            safetyChecker.getFailureReason = () => ({ 
                reason: 'High holder concentration', 
                value: 50 
            });

            // Simulate recovery with unsafe conditions
            token.marketCapSol = 10350; // 15% recovery
            token.getRecoveryPercentage = () => 15;
            token.getGainPercentage = () => 15;

            await token.evaluateRecovery(safetyChecker);
            expect(token.state).to.equal("unsafeRecovery");
            expect(token.unsafeReason.reason).to.equal('High holder concentration');

            // Now simulate safe conditions but with gain too high
            safetyChecker.runSecurityChecks = async () => true;
            token.getGainPercentage = () => 25; // Above SAFE_RECOVERY_GAIN threshold
            
            let gainTooHighEvent = false;
            token.on('recoveryGainTooHigh', () => {
                gainTooHighEvent = true;
            });

            await token.evaluateRecovery(safetyChecker);
            expect(token.state).to.equal("drawdown");
            expect(gainTooHighEvent).to.be.true;
            expect(token.unsafeReason).to.be.null;
        });

        it('should handle multiple safety check failures during recovery', async function() {
            // Setup initial state
            token.setState("heatingUp");
            token.setState("firstPump");
            token.marketCapSol = 9000;
            token.setState("drawdown");

            // Mock multiple safety failures
            let failureCount = 0;
            const failures = [
                { reason: 'High holder concentration', value: 50 },
                { reason: 'Insufficient liquidity', value: 0.05 },
                { reason: 'High holder concentration', value: 60 } // Same reason, different value
            ];
            
            safetyChecker.runSecurityChecks = async () => false;
            safetyChecker.getFailureReason = () => failures[failureCount++ % failures.length];

            // Track safety updates
            let safetyUpdates = [];
            token.on('unsafeRecoveryUpdate', (update) => {
                safetyUpdates.push(update);
            });

            // Simulate recovery attempts
            token.getRecoveryPercentage = () => 15;
            token.getGainPercentage = () => 15;

            // First failure
            await token.evaluateRecovery(safetyChecker);
            expect(token.state).to.equal("unsafeRecovery");
            expect(token.unsafeReason.reason).to.equal('High holder concentration');
            expect(token.unsafeReason.value).to.equal(50);

            // Second failure - different reason
            await token.evaluateRecovery(safetyChecker);
            expect(safetyUpdates.length).to.equal(1);
            expect(safetyUpdates[0].reason).to.equal('Insufficient liquidity');

            // Third failure - same reason, different value
            await token.evaluateRecovery(safetyChecker);
            expect(safetyUpdates.length).to.equal(2);
            expect(safetyUpdates[1].value).to.equal(60);
        });

        it('should maintain drawdownLow across state transitions', async function() {
            // Setup initial state
            token.setState("heatingUp");
            token.setState("firstPump");
            token.marketCapSol = 9000;
            token.setState("drawdown");
            
            // Set initial drawdownLow
            expect(token.drawdownLow).to.equal(9000);

            // Go lower and transition to unsafeRecovery
            token.marketCapSol = 8000;
            await token.evaluateRecovery(safetyChecker);
            expect(token.drawdownLow).to.equal(8000);

            safetyChecker.runSecurityChecks = async () => false;
            token.marketCapSol = 9200; // Recovery attempt
            token.getRecoveryPercentage = () => 15;
            token.getGainPercentage = () => 15;
            await token.evaluateRecovery(safetyChecker);
            expect(token.state).to.equal("unsafeRecovery");
            expect(token.drawdownLow).to.equal(8000); // Should maintain lowest point

            // New low in unsafeRecovery
            token.marketCapSol = 7500;
            await token.evaluateRecovery(safetyChecker);
            expect(token.drawdownLow).to.equal(7500);
            expect(token.state).to.equal("drawdown"); // Should go back to drawdown
        });

        it('should handle recovery evaluation with missing safetyChecker', async function() {
            token.setState("heatingUp");
            token.setState("firstPump");
            token.setState("drawdown");

            let errorLogged = false;
            token.on('recoveryError', () => {
                errorLogged = true;
            });

            await token.evaluateRecovery(null);
            expect(errorLogged).to.be.true;
            expect(token.state).to.equal("drawdown"); // State should not change
        });
    });
});

// Helper function to simulate price movements
async function simulatePriceMovement(token, startPrice, endPrice, steps) {
    const priceStep = (endPrice - startPrice) / steps;
    for(let i = 0; i < steps; i++) {
        token.marketCapSol = startPrice + (priceStep * i);
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    token.marketCapSol = endPrice;
}
