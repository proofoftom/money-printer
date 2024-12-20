const Dashboard = require('../dashboard/Dashboard');
const config = require('../config');

// Mock blessed and blessed-contrib
jest.mock('blessed', () => ({
  screen: jest.fn().mockReturnValue({
    key: jest.fn(),
    render: jest.fn(),
    destroy: jest.fn()
  }),
  box: jest.fn().mockReturnValue({
    setContent: jest.fn(),
    toggle: jest.fn(),
    style: { bg: null }
  })
}));

jest.mock('blessed-contrib', () => ({
  grid: jest.fn().mockReturnValue({
    set: jest.fn().mockReturnValue({
      setData: jest.fn(),
      setContent: jest.fn(),
      log: jest.fn(),
      setPercent: jest.fn(),
      focus: jest.fn(),
      style: { border: { fg: null } }
    })
  }),
  line: jest.fn(),
  gauge: jest.fn(),
  table: jest.fn(),
  log: jest.fn()
}));

describe('Dashboard', () => {
  let dashboard;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };
    dashboard = new Dashboard(config, mockLogger);
    dashboard.initialize();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Event Handling', () => {
    it('should update chart on price update', () => {
      const mockPriceData = {
        prices: [
          { time: '10:00:00', price: 1.0 },
          { time: '10:00:05', price: 1.1 }
        ],
        volumes: [100, 200]
      };

      dashboard.emit('priceUpdate', mockPriceData);
      expect(dashboard.components.chart.setData).toHaveBeenCalled();
    });

    it('should update positions table on position update', () => {
      const mockPositions = [{
        token: { symbol: 'TEST' },
        size: 1.0,
        entryPrice: 1.0,
        currentPrice: 1.1,
        realizedPnLWithFeesSol: 0.1
      }];

      dashboard.emit('positionUpdate', mockPositions);
      expect(dashboard.components.positions.setData).toHaveBeenCalled();
    });

    it('should update wallet on wallet update', () => {
      const mockWalletData = {
        balance: 10.0,
        initialBalance: 10.0
      };

      dashboard.emit('walletUpdate', mockWalletData);
      expect(dashboard.components.wallet.setPercent).toHaveBeenCalled();
    });

    it('should log messages', () => {
      const testMessage = 'Test log message';
      dashboard.log(testMessage);
      expect(dashboard.components.log.log).toHaveBeenCalled();
    });

    it('should show alerts', () => {
      const testAlert = 'Test alert message';
      dashboard.alert(testAlert);
      expect(dashboard.components.alerts.log).toHaveBeenCalled();
    });
  });

  describe('UI Controls', () => {
    it('should toggle help panel', () => {
      dashboard.toggleHelp();
      expect(dashboard.components.help.toggle).toHaveBeenCalled();
    });

    it('should clear logs', () => {
      dashboard.clearLogs();
      expect(dashboard.components.log.setContent).toHaveBeenCalled();
    });

    it('should focus components', () => {
      dashboard.focusComponent('chart');
      expect(dashboard.activeComponent).toBe('chart');
    });
  });

  describe('Alert Checks', () => {
    it('should trigger price alert when threshold exceeded', () => {
      const mockPriceData = {
        price: 1.2,
        previousPrice: 1.0
      };

      const alertSpy = jest.spyOn(dashboard, 'alert');
      dashboard.checkPriceAlerts(mockPriceData);
      
      expect(alertSpy).toHaveBeenCalled();
    });

    it('should trigger wallet alert when threshold exceeded', () => {
      const mockWalletData = {
        balance: 9.0,
        previousBalance: 10.0
      };

      const alertSpy = jest.spyOn(dashboard, 'alert');
      dashboard.checkWalletAlerts(mockWalletData);
      
      expect(alertSpy).toHaveBeenCalled();
    });
  });
});
