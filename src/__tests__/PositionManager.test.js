const PositionManager = require('../PositionManager');
const Position = require('../Position');

describe('PositionManager', () => {
  let positionManager;
  let mockWallet;
  let mockPriceManager;
  let mockToken;
  let mockConfig;
  let mockLogger;

  beforeEach(() => {
    mockWallet = {
      getBalance: jest.fn(() => 100), // 100 SOL
      canAffordTrade: jest.fn(() => true)
    };

    mockPriceManager = {
      solToUSD: jest.fn(sol => sol * 100) // 1 SOL = $100 USD
    };

    mockToken = {
      mint: 'test-mint',
      symbol: 'TEST',
      marketCapSol: 1000,
      getCurrentPrice: jest.fn(() => 100),
      currentPrice: 100
    };

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    mockConfig = {
      RISK_PER_TRADE: 0.1,
      MAX_MCAP_POSITION: 0.01,
      TAKE_PROFIT_PERCENT: 50,
      STOP_LOSS_PERCENT: 20
    };

    positionManager = new PositionManager({
      wallet: mockWallet,
      priceManager: mockPriceManager,
      logger: mockLogger,
      config: mockConfig
    });
  });

  describe('Trading State', () => {
    test('should start with trading enabled', () => {
      expect(positionManager.isTradingEnabled()).toBe(true);
    });

    test('should handle pause/resume trading', () => {
      positionManager.pauseTrading();
      expect(positionManager.isTradingEnabled()).toBe(false);

      positionManager.resumeTrading();
      expect(positionManager.isTradingEnabled()).toBe(true);
    });
  });

  describe('Position Management', () => {
    test('should open new positions', () => {
      const openSpy = jest.fn();
      positionManager.on('positionOpened', openSpy);

      const result = positionManager.openPosition(mockToken);
      
      expect(result).toBeTruthy();
      expect(openSpy).toHaveBeenCalled();
      expect(result instanceof Position).toBe(true);
      expect(result.mint).toBe(mockToken.mint);
    });

    test('should not open duplicate positions', () => {
      positionManager.openPosition(mockToken);
      const result = positionManager.openPosition(mockToken);
      expect(result).toBeNull();
    });

    test('should update positions', () => {
      const position = positionManager.openPosition(mockToken);
      mockToken.currentPrice = 120;
      
      positionManager.updatePositions();
      expect(position.state).toBe(Position.STATES.OPEN);
    });

    test('should close positions when requested', () => {
      const position = positionManager.openPosition(mockToken);
      const result = positionManager.closePosition('test');
      
      expect(result).toBe(true);
      expect(position.state).toBe(Position.STATES.CLOSED);
    });

    test('should handle emergency close all', () => {
      const position = positionManager.openPosition(mockToken);
      const result = positionManager.closeAllPositions('emergency');
      
      expect(result).toBe(true);
      expect(position.state).toBe(Position.STATES.CLOSED);
    });
  });

  describe('Position Sizing', () => {
    test('should calculate position size based on risk parameters', () => {
      const size = positionManager.calculatePositionSize(mockToken);
      const expectedSize = Math.min(
        mockWallet.getBalance() * mockConfig.RISK_PER_TRADE,
        mockToken.marketCapSol * mockConfig.MAX_MCAP_POSITION
      );
      expect(size).toBe(expectedSize);
    });
  });
});
