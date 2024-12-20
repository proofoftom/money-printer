const PositionManager = require('../PositionManager');
const Position = require('../Position');

describe('PositionManager', () => {
  let positionManager;
  let mockToken;
  let mockPriceManager;
  let mockWallet;

  beforeEach(() => {
    mockToken = {
      mint: 'token123',
      symbol: 'TEST',
      getCurrentPrice: jest.fn().mockReturnValue(100),
      marketCapSol: 1000,
      getHighestPrice: jest.fn().mockReturnValue(120),
      getHighestPriceTime: jest.fn().mockReturnValue(Date.now()),
      getVolumeSinceCreation: jest.fn().mockReturnValue(5000),
      getTradeCount: jest.fn().mockReturnValue(100),
      score: { pump: 0.8 },
      ohlcvData: {
        secondly: [{
          open: 100,
          high: 120,
          low: 90,
          close: 110,
          volume: 1000,
          timestamp: Date.now()
        }]
      }
    };

    mockPriceManager = {
      subscribeToPrice: jest.fn(),
      unsubscribeFromPrice: jest.fn(),
      solToUSD: jest.fn().mockImplementation(sol => sol * 100) // 1 SOL = $100 USD
    };

    mockWallet = {
      getBalance: jest.fn().mockReturnValue(1000),
      canAffordTrade: jest.fn().mockReturnValue(true),
      processTrade: jest.fn().mockResolvedValue(true)
    };

    positionManager = new PositionManager(mockPriceManager, mockWallet);
  });

  describe('Trading State', () => {
    test('should start with trading enabled', () => {
      expect(positionManager.isTradingEnabled()).toBe(true);
    });

    test('should handle pause/resume trading', () => {
      const pauseSpy = jest.fn();
      const resumeSpy = jest.fn();
      positionManager.on('tradingPaused', pauseSpy);
      positionManager.on('tradingResumed', resumeSpy);

      positionManager.pauseTrading();
      expect(positionManager.isTradingEnabled()).toBe(false);
      expect(pauseSpy).toHaveBeenCalled();

      positionManager.resumeTrading();
      expect(positionManager.isTradingEnabled()).toBe(true);
      expect(resumeSpy).toHaveBeenCalled();
    });
  });

  describe('Position Management', () => {
    test('should open new positions', async () => {
      const openSpy = jest.fn();
      positionManager.on('positionOpened', openSpy);

      const position = await positionManager.openPosition(mockToken, 1);
      expect(position).toBeTruthy();
      expect(openSpy).toHaveBeenCalled();
      expect(positionManager.positions.has(mockToken.mint)).toBe(true);
    });

    test('should not open duplicate positions', async () => {
      await positionManager.openPosition(mockToken, 1);
      await expect(positionManager.openPosition(mockToken, 1)).rejects.toThrow('Position already exists for this token');
    });

    test('should update positions', async () => {
      const updateSpy = jest.fn();
      positionManager.on('positionUpdated', updateSpy);

      const position = await positionManager.openPosition(mockToken, 1);
      expect(position).toBeTruthy();

      mockToken.getCurrentPrice.mockReturnValue(120);
      await positionManager.updatePosition(mockToken);

      expect(updateSpy).toHaveBeenCalled();
      const updatedPosition = positionManager.getPosition(mockToken.mint);
      expect(updatedPosition.currentPrice).toBe(120);
    });

    test('should handle emergency close all', async () => {
      const emergencySpy = jest.fn();
      positionManager.on('emergencyStop', emergencySpy);

      await positionManager.openPosition(mockToken, 1);
      await positionManager.openPosition({...mockToken, mint: 'test-mint-2'}, 1);

      await positionManager.emergencyCloseAll();

      expect(emergencySpy).toHaveBeenCalled();
      expect(positionManager.getAllPositions()).toHaveLength(0);
    });
  });

  describe('Position Sizing', () => {
    test('should calculate position size based on risk parameters', () => {
      const size = positionManager.calculatePositionSize(mockToken);
      
      const expectedSize = Math.min(
        mockWallet.getBalance() * positionManager.config.RISK_PER_TRADE,
        mockToken.marketCapSol * positionManager.config.MAX_MCAP_POSITION
      );

      expect(size).toBe(expectedSize);
    });

    test('should respect wallet balance when opening positions', async () => {
      mockWallet.canAffordTrade.mockReturnValueOnce(false);
      const position = await positionManager.openPosition(mockToken, 1);
      expect(position).toBeNull();
    });
  });

  describe('Position Updates', () => {
    test('should update all positions', async () => {
      await positionManager.openPosition(mockToken, 1);
      await positionManager.openPosition({...mockToken, mint: 'test-mint-2'}, 1);

      mockToken.getCurrentPrice.mockReturnValue(120);
      await positionManager.updatePositions();

      const positions = positionManager.getAllPositions();
      positions.forEach(position => {
        expect(position.currentPrice).toBe(120);
      });
    });

    test('should handle errors during position updates', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await positionManager.openPosition(mockToken, 1);
      
      mockToken.getCurrentPrice.mockImplementation(() => {
        throw new Error('Price update failed');
      });

      await positionManager.updatePositions();
      expect(errorSpy).toHaveBeenCalled();

      errorSpy.mockRestore();
    });
  });
});
