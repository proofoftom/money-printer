const PositionManager = require('../PositionManager');
const ExitStrategies = require('../ExitStrategies');
const config = require('../config');

jest.mock('../ExitStrategies');

describe('PositionManager', () => {
  let positionManager;
  let mockWallet;
  let mockPriceManager;
  let mockEmit;

  beforeEach(() => {
    // Mock wallet
    mockWallet = {
      getBalance: jest.fn().mockReturnValue(100)
    };

    // Mock price manager
    mockPriceManager = {
      getCurrentPrice: jest.fn()
    };

    positionManager = new PositionManager(mockWallet, mockPriceManager);
    mockEmit = jest.spyOn(positionManager, 'emit');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Trading Controls', () => {
    it('should start with trading enabled', () => {
      expect(positionManager.isTradingEnabled()).toBe(true);
    });

    it('should pause trading', () => {
      positionManager.pauseTrading();
      
      expect(positionManager.isTradingEnabled()).toBe(false);
      expect(mockEmit).toHaveBeenCalledWith('tradingPaused');
    });

    it('should resume trading', () => {
      positionManager.pauseTrading();
      positionManager.resumeTrading();
      
      expect(positionManager.isTradingEnabled()).toBe(true);
      expect(mockEmit).toHaveBeenCalledWith('tradingResumed');
    });

    it('should not open positions while trading is paused', () => {
      const mockToken = {
        mint: 'TEST',
        symbol: 'TEST',
        getCurrentPrice: jest.fn().mockReturnValue(10),
        marketCapSol: 1000
      };

      positionManager.pauseTrading();
      const result = positionManager.openPosition(mockToken);
      
      expect(result).toBe(false);
      expect(positionManager.getPosition('TEST')).toBeUndefined();
    });

    it('should open positions when trading is resumed', () => {
      const mockToken = {
        mint: 'TEST',
        symbol: 'TEST',
        getCurrentPrice: jest.fn().mockReturnValue(10),
        marketCapSol: 1000
      };

      positionManager.pauseTrading();
      positionManager.resumeTrading();
      const result = positionManager.openPosition(mockToken);
      
      expect(result).toBe(true);
      expect(positionManager.getPosition('TEST')).toBeDefined();
    });
  });

  describe('Emergency Controls', () => {
    it('should close all positions and pause trading on emergency', () => {
      // Set up multiple positions
      const positions = [
        {
          mint: 'TEST1',
          symbol: 'TEST1',
          getCurrentPrice: jest.fn().mockReturnValue(10),
          marketCapSol: 1000
        },
        {
          mint: 'TEST2',
          symbol: 'TEST2',
          getCurrentPrice: jest.fn().mockReturnValue(20),
          marketCapSol: 2000
        }
      ];

      // Open positions
      positions.forEach(token => positionManager.openPosition(token));
      
      // Verify positions are open
      expect(positionManager.getPosition('TEST1')).toBeDefined();
      expect(positionManager.getPosition('TEST2')).toBeDefined();

      // Trigger emergency close
      positionManager.emergencyCloseAll();

      // Verify all positions are closed
      expect(positionManager.getPosition('TEST1')).toBeUndefined();
      expect(positionManager.getPosition('TEST2')).toBeUndefined();
      
      // Verify trading is paused
      expect(positionManager.isTradingEnabled()).toBe(false);
      
      // Verify events were emitted
      expect(mockEmit).toHaveBeenCalledWith('positionClosed', expect.any(Object));
      expect(mockEmit).toHaveBeenCalledWith('tradingPaused');
      expect(mockEmit).toHaveBeenCalledWith('emergencyStop');
    });
  });

  describe('Position Management', () => {
    const mockToken = {
      mint: 'TEST',
      symbol: 'TEST',
      getCurrentPrice: jest.fn().mockReturnValue(10),
      marketCapSol: 1000
    };

    it('should calculate position size based on wallet balance and risk', () => {
      const position = positionManager.openPosition(mockToken);
      
      expect(position).toBe(true);
      const openedPosition = positionManager.getPosition('TEST');
      expect(openedPosition.size).toBe(Math.min(
        100 * config.RISK_PER_TRADE,
        1000 * config.MAX_MCAP_POSITION
      ));
    });

    it('should not open duplicate positions', () => {
      const firstResult = positionManager.openPosition(mockToken);
      const secondResult = positionManager.openPosition(mockToken);
      
      expect(firstResult).toBe(true);
      expect(secondResult).toBe(false);
    });

    it('should update position prices', () => {
      positionManager.openPosition(mockToken);
      
      // Update token price
      mockToken.getCurrentPrice.mockReturnValue(20);
      positionManager.updatePosition(mockToken);
      
      const position = positionManager.getPosition('TEST');
      expect(position.currentPrice).toBe(20);
    });

    it('should close positions when exit signals are triggered', () => {
      // Mock exit strategy to return an exit signal
      const mockExitStrategies = {
        checkExitSignals: jest.fn().mockReturnValue({ reason: 'take_profit' })
      };
      positionManager.exitStrategies = mockExitStrategies;

      // Open and verify position
      positionManager.openPosition(mockToken);
      expect(positionManager.getPosition('TEST')).toBeDefined();

      // Update position which should trigger exit
      positionManager.updatePosition(mockToken);
      
      // Verify position is closed
      expect(positionManager.getPosition('TEST')).toBeUndefined();
      expect(mockEmit).toHaveBeenCalledWith('positionClosed', {
        position: expect.objectContaining({
          mint: 'TEST',
          symbol: 'TEST'
        }),
        reason: 'take_profit'
      });
    });
  });
});
