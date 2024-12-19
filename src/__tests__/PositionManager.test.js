const PositionManager = require('../PositionManager');
const config = require('../config');

describe('PositionManager', () => {
  let positionManager;
  let mockWallet;
  let mockPriceManager;
  let mockToken;

  beforeEach(() => {
    mockWallet = {
      getBalance: jest.fn(() => 100), // 100 SOL
    };

    mockPriceManager = {
      solToUSD: jest.fn(sol => sol * 100) // 1 SOL = $100 USD
    };

    mockToken = {
      mint: 'test-mint',
      symbol: 'TEST',
      marketCapSol: 1000,
      getCurrentPrice: jest.fn(() => 100)
    };

    positionManager = new PositionManager(mockWallet, mockPriceManager);
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
      
      expect(result).toBe(true);
      expect(openSpy).toHaveBeenCalled();
      
      const position = positionManager.getPosition(mockToken.mint);
      expect(position).toBeTruthy();
      expect(position.mint).toBe(mockToken.mint);
      expect(position.entryPrice).toBe(100);
    });

    test('should not open duplicate positions', () => {
      positionManager.openPosition(mockToken);
      const result = positionManager.openPosition(mockToken);
      expect(result).toBe(false);
    });

    test('should update positions', () => {
      const updateSpy = jest.fn();
      positionManager.on('positionUpdated', updateSpy);

      positionManager.openPosition(mockToken);
      mockToken.getCurrentPrice.mockReturnValue(120);
      positionManager.updatePosition(mockToken);

      expect(updateSpy).toHaveBeenCalled();
      const position = positionManager.getPosition(mockToken.mint);
      expect(position.currentPrice).toBe(120);
    });

    test('should close positions when exit signals are triggered', () => {
      const closeSpy = jest.fn();
      positionManager.on('positionClosed', closeSpy);

      // Open position
      positionManager.openPosition(mockToken);

      // Trigger stop loss (price drops below stop loss level)
      mockToken.getCurrentPrice.mockReturnValue(85); // 15% drop
      positionManager.updatePosition(mockToken);

      expect(closeSpy).toHaveBeenCalled();
      const closedPosition = positionManager.getPosition(mockToken.mint);
      expect(closedPosition).toBeFalsy();
    });

    test('should handle emergency close all', () => {
      const emergencySpy = jest.fn();
      positionManager.on('emergencyStop', emergencySpy);

      // Open multiple positions
      positionManager.openPosition(mockToken);
      positionManager.openPosition({...mockToken, mint: 'test-mint-2'});

      positionManager.emergencyCloseAll();

      expect(emergencySpy).toHaveBeenCalled();
      expect(positionManager.getAllPositions()).toHaveLength(0);
      expect(positionManager.isTradingEnabled()).toBe(false);
    });
  });

  describe('Position Sizing', () => {
    test('should calculate position size based on risk parameters', () => {
      const size = positionManager.calculatePositionSize(mockToken);
      const expectedSize = Math.min(
        mockWallet.getBalance() * config.RISK_PER_TRADE,
        mockToken.marketCapSol * config.MAX_MCAP_POSITION
      );
      expect(size).toBe(expectedSize);
    });
  });
});
