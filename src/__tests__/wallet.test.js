const Wallet = require('../Wallet');
const Position = require('../Position');
const Token = require('../Token').Token;
const PriceManager = require('../PriceManager');
const winston = require('winston');

// Create test logger
const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/wallet-test.log' })
  ]
});

describe('Wallet Transaction Fee Tests', () => {
  let wallet;
  let priceManager;
  let testToken;

  const config = {
    TRANSACTION_FEES: {
      BUY: 0.02,
      SELL: 0.01
    },
    RISK_PER_TRADE: 0.2, // This will set initial balance to 2.0 SOL (RISK_PER_TRADE * 10)
    INITIAL_BALANCE: 1.0,

    // Safety check configuration
    SAFETY_CHECK_INTERVAL: 2000,
    MAX_TIME_WITHOUT_TRADES: 300000,
    MAX_PRICE_DROP_PERCENT: 0.5,
    MAX_HOLDER_CONCENTRATION: 30,
  };

  beforeEach(() => {
    wallet = new Wallet(config, logger);
    priceManager = new PriceManager();
    testToken = new Token({
      mint: 'test123',
      symbol: 'TEST',
      marketCapSol: 1000
    }, { 
      priceManager,
      safetyChecker: null,
      logger,
      config
    });
    
    // Reset wallet balance to initial test value
    const currentBalance = wallet.getBalance();
    wallet.updateBalance(config.INITIAL_BALANCE - currentBalance);
  });

  afterEach(() => {
    if (testToken) {
      testToken.cleanup();
    }
  });

  test('should reject trades with insufficient funds', () => {
    const largeAmount = 1.0; // Larger than initial balance
    expect(wallet.canAffordTrade(largeAmount, true)).toBe(false);
  });

  test('should track transaction fees correctly', async () => {
    const position = new Position(testToken, priceManager, wallet, config);
    const tradeSize = 0.02; 
    const entryPrice = 1.0;
    const exitPrice = 1.1;

    // Record initial balance
    const initialBalance = wallet.getBalance();
    logger.info('Initial balance:', { balance: initialBalance });

    // Calculate required amount including fees
    const requiredAmount = tradeSize * entryPrice + config.TRANSACTION_FEES.BUY;
    logger.info('Required amount:', { 
      tradeAmount: tradeSize * entryPrice,
      fee: config.TRANSACTION_FEES.BUY,
      total: requiredAmount,
      canAfford: wallet.canAffordTrade(tradeSize * entryPrice, true)
    });

    // Open position
    await position.open(entryPrice, tradeSize);
    
    // Check balance after opening (should deduct position size + buy fee)
    const expectedBalanceAfterOpen = initialBalance - (tradeSize * entryPrice) - config.TRANSACTION_FEES.BUY;
    expect(wallet.getBalance()).toBeCloseTo(expectedBalanceAfterOpen, 6);

    // Close position
    await position.close(exitPrice, 'test');
    
    // Calculate expected final balance
    const profit = tradeSize * (exitPrice - entryPrice);
    const totalFees = config.TRANSACTION_FEES.BUY + config.TRANSACTION_FEES.SELL;
    const expectedFinalBalance = initialBalance + profit - totalFees;
    
    expect(wallet.getBalance()).toBeCloseTo(expectedFinalBalance, 6);
    expect(wallet.getTotalTransactionFees()).toBeCloseTo(totalFees, 6);
  });

  test('should calculate P&L with and without fees correctly', async () => {
    const position = new Position(testToken, priceManager, wallet, config);
    const tradeSize = 0.02; 
    const entryPrice = 1.0;
    const exitPrice = 1.02; // Small profit that should become loss after fees
    
    await position.open(entryPrice, tradeSize);
    await position.close(exitPrice, 'test');

    const expectedPnL = tradeSize * (exitPrice - entryPrice);
    const expectedPnLWithFees = expectedPnL - (config.TRANSACTION_FEES.BUY + config.TRANSACTION_FEES.SELL);

    expect(position.realizedPnLSol).toBeCloseTo(expectedPnL, 6);
    expect(position.realizedPnLWithFeesSol).toBeCloseTo(expectedPnLWithFees, 6);
    
    // Verify that trade is profitable without fees but unprofitable with fees
    expect(position.realizedPnLSol).toBeGreaterThan(0);
    expect(position.realizedPnLWithFeesSol).toBeLessThan(0);
  });

  test('should emit correct events', async () => {
    const balanceUpdates = [];
    const feeDeductions = [];
    const tradeProcessed = [];

    wallet.on('balanceUpdate', (data) => balanceUpdates.push(data));
    wallet.on('feeDeducted', (data) => feeDeductions.push(data));
    wallet.on('tradeProcessed', (data) => tradeProcessed.push(data));

    const position = new Position(testToken, priceManager, wallet, config);
    await position.open(1.0, 0.02);
    await position.close(1.1, 'test');

    expect(tradeProcessed.length).toBe(2); // One for open, one for close
    expect(feeDeductions.length).toBe(2); // One for buy, one for sell
    
    // Verify trade event data
    expect(tradeProcessed[0].type).toBe('buy');
    expect(tradeProcessed[1].type).toBe('sell');
  });
});
