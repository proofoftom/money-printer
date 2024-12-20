const PositionManager = require('../PositionManager');
const Position = require('../Position'); // Import the Position class

describe('PositionManager', () => {
  let positionManager;
  let mockWallet;
  let mockPriceManager;
  let mockToken;
  let mockConfig;

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

    mockConfig = {
      RISK_PER_TRADE: 0.1,
      MAX_MCAP_POSITION: 0.01,
      TAKE_PROFIT_PERCENT: 50,
      STOP_LOSS_PERCENT: 20
    };

    positionManager = new PositionManager(mockWallet, mockPriceManager, mockConfig);
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
      const mockToken = {
        mint: 'mock-token',
        symbol: 'MOCK',
        getCurrentPrice: () => 1.5,
        getDrawdownPercentage: () => 25, // Above stop loss threshold
        marketCapSol: 1000,
        marketCapUSD: 100000
      };

      // Create a mock position with a close method
      const mockPosition = {
        close: jest.fn(),
        token: mockToken,
        state: 'OPEN'
      };

      // Mock the Position constructor to return our mock position
      jest.spyOn(Position.prototype, 'close').mockImplementation(mockPosition.close);
      
      const position = positionManager.openPosition(mockToken);
      expect(position).toBeDefined();

      // Update position with high drawdown to trigger stop loss
      positionManager.updatePosition(mockToken);

      expect(Position.prototype.close).toHaveBeenCalled();
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
        mockWallet.getBalance() * mockConfig.RISK_PER_TRADE,
        mockToken.marketCapSol * mockConfig.MAX_MCAP_POSITION
      );
      expect(size).toBe(expectedSize);
    });
  });
});
