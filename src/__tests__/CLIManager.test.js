const CLIManager = require('../CLIManager');
const config = require('../config');
const notifier = require('node-notifier');

import { jest } from '@jest/globals';

describe('CLIManager', () => {
  let cli;
  let mockEmit;

  beforeEach(() => {
    cli = new CLIManager(config);
    mockEmit = jest.spyOn(cli, 'emit');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Trading Controls', () => {
    it('should toggle trading state', () => {
      expect(cli.isRunning).toBe(false);
      
      cli.toggleTrading();
      expect(cli.isRunning).toBe(true);
      expect(mockEmit).toHaveBeenCalledWith('tradingStateChange', true);
      
      cli.toggleTrading();
      expect(cli.isRunning).toBe(false);
      expect(mockEmit).toHaveBeenCalledWith('tradingStateChange', false);
    });

    it('should trigger emergency stop', async () => {
      cli.confirmAction = jest.fn().mockResolvedValue(true);
      
      await cli.emergencyStop();
      
      expect(cli.isRunning).toBe(false);
      expect(mockEmit).toHaveBeenCalledWith('emergencyStop');
      expect(notifier.notify).toHaveBeenCalled();
    });

    it('should adjust risk within bounds', () => {
      cli.adjustRisk(0.01);
      expect(cli.config.RISK_PER_TRADE).toBe(0.11);
      
      cli.adjustRisk(-0.02);
      expect(cli.config.RISK_PER_TRADE).toBe(0.09);
      
      // Test lower bound
      cli.adjustRisk(-1);
      expect(cli.config.RISK_PER_TRADE).toBe(0.01);
      
      // Test upper bound
      cli.adjustRisk(1);
      expect(cli.config.RISK_PER_TRADE).toBe(0.5);
    });
  });

  describe('View Management', () => {
    it('should switch between views', () => {
      cli.setView('trades');
      expect(cli.currentView).toBe('trades');
      
      cli.setView('positions');
      expect(cli.currentView).toBe('positions');
      
      cli.setView('performance');
      expect(cli.currentView).toBe('performance');
      
      cli.setView('tokens');
      expect(cli.currentView).toBe('tokens');
      
      cli.setView('dashboard');
      expect(cli.currentView).toBe('dashboard');
    });
  });

  describe('Data Updates', () => {
    it('should update balance history', () => {
      cli.updateBalanceHistory(1.0);
      cli.updateBalanceHistory(1.1);
      cli.updateBalanceHistory(1.2);
      
      expect(cli.balanceHistory).toHaveLength(3);
      expect(cli.balanceHistory).toEqual([1.0, 1.1, 1.2]);
    });

    it('should maintain maximum balance history length', () => {
      for (let i = 0; i < 60; i++) {
        cli.updateBalanceHistory(i);
      }
      
      expect(cli.balanceHistory).toHaveLength(50);
      expect(cli.balanceHistory[0]).toBe(10);
      expect(cli.balanceHistory[49]).toBe(59);
    });

    it('should update positions', () => {
      const position = {
        token: 'TEST',
        symbol: 'TEST',
        entryPrice: 1.0,
        currentPrice: 1.1,
        size: 1.0,
        pnl: 0.1,
        pnlPercent: 10
      };
      
      cli.updatePosition('TEST', position);
      expect(cli.activePositions.get('TEST')).toEqual(position);
    });

    it('should add trades with limit', () => {
      for (let i = 0; i < 120; i++) {
        cli.addTrade({
          timestamp: new Date().toISOString(),
          symbol: 'TEST',
          type: 'buy',
          price: 1.0,
          size: 1.0,
          pnl: 0.1
        });
      }
      
      expect(cli.tradeHistory).toHaveLength(100);
    });

    it('should update token information', () => {
      const token = {
        mint: 'TEST',
        symbol: 'TEST',
        age: 300,
        marketCap: 1000,
        volume: 100,
        isSafe: true
      };
      
      cli.updateToken(token);
      expect(cli.tokenList.get('TEST')).toEqual(token);
    });
  });

  describe('Notifications', () => {
    it('should send notifications with sound', () => {
      cli.notify('Test message', { sound: true });
      
      expect(notifier.notify).toHaveBeenCalledWith({
        title: 'Money Printer',
        message: 'Test message',
        sound: true
      });
    });

    it('should send notifications without sound', () => {
      cli.notify('Test message', { sound: false });
      
      expect(notifier.notify).toHaveBeenCalledWith({
        title: 'Money Printer',
        message: 'Test message',
        sound: false
      });
    });
  });

  describe('Rendering', () => {
    it('should render performance metrics', () => {
      // Add some test trades
      cli.addTrade({ pnl: 0.1 });
      cli.addTrade({ pnl: -0.05 });
      cli.addTrade({ pnl: 0.2 });
      
      const metrics = cli.renderPerformanceMetrics();
      expect(metrics).toContain('Total Trades');
      expect(metrics).toContain('Win Rate');
      expect(metrics).toContain('Average PnL');
    });

    it('should render positions table', () => {
      cli.updatePosition('TEST1', {
        symbol: 'TEST1',
        entryPrice: 1.0,
        currentPrice: 1.1,
        size: 1.0,
        pnl: 0.1,
        pnlPercent: 10,
        holdTime: '1h'
      });
      
      const positions = cli.renderPositions();
      expect(positions).toContain('TEST1');
      expect(positions).toContain('1.000000');
      expect(positions).toContain('0.100');
    });

    it('should render trade history', () => {
      cli.addTrade({
        timestamp: '10:00:00',
        symbol: 'TEST',
        type: 'buy',
        price: 1.0,
        size: 1.0,
        pnl: 0.1
      });
      
      const history = cli.renderTradeHistory();
      expect(history).toContain('TEST');
      expect(history).toContain('BUY');
      expect(history).toContain('1.000000');
    });

    it('should render token list', () => {
      cli.updateToken({
        mint: 'TEST',
        symbol: 'TEST',
        age: '5m',
        marketCap: 1000,
        volume: 100,
        isSafe: true
      });
      
      const tokens = cli.renderTokenList();
      expect(tokens).toContain('TEST');
      expect(tokens).toContain('1000.000');
      expect(tokens).toContain('SAFE');
    });
  });
});
