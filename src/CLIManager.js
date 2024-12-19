const Table = require('cli-table3');
const chalk = require('chalk');
const asciichart = require('asciichart');
const keypress = require('keypress');
const notifier = require('node-notifier');
const EventEmitter = require('events');
const inquirer = require('inquirer');
const { STATES } = require('./Token');

class CLIManager extends EventEmitter {
  constructor(config, tokenTracker) {
    super();
    this.config = config;
    this.tokenTracker = tokenTracker;
    this.isRunning = true;
    this.autoScroll = true;
    this.showCharts = true;
    this.currentView = 'dashboard';
    this.balanceHistory = [];
    this.activePositions = new Map();
    this.tradeHistory = [];
    this.tokenList = new Map();
    this.performanceMetrics = {
      totalPnLSol: 0,
      totalPnLUsd: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      bestTrade: 0,
      worstTrade: 0,
      avgHoldTime: 0,
      activePositions: 0,
      totalTrades: 0
    };
    this.performanceTimer = null;
    this.renderTimer = null;
    
    // Initialize tables
    this.initializeTables();
    
    // Setup keyboard controls
    this.setupKeyboardControls();

    // Setup event listeners
    this.setupEventListeners();

    // Start performance tracking
    this.startPerformanceTracking();
  }

  initializeTables() {
    // Performance table
    this.performanceTable = new Table({
      head: [
        chalk.cyan('Metric'),
        chalk.cyan('Value')
      ],
      style: { head: [], border: [] }
    });

    // Positions table
    this.positionsTable = new Table({
      head: [
        chalk.cyan('Token'),
        chalk.cyan('Entry'),
        chalk.cyan('Current'),
        chalk.cyan('Size'),
        chalk.cyan('PnL'),
        chalk.cyan('State'),
        chalk.cyan('Time')
      ],
      style: { head: [], border: [] }
    });

    // Trade history table
    this.tradeHistoryTable = new Table({
      head: [
        chalk.cyan('Time'),
        chalk.cyan('Token'),
        chalk.cyan('Type'),
        chalk.cyan('Price'),
        chalk.cyan('Size'),
        chalk.cyan('PnL')
      ],
      style: { head: [], border: [] }
    });

    // Token list table
    this.tokenListTable = new Table({
      head: [
        chalk.cyan('Token'),
        chalk.cyan('Age'),
        chalk.cyan('MCap'),
        chalk.cyan('Price'),
        chalk.cyan('Volume'),
        chalk.cyan('Safety'),
        chalk.cyan('State'),
        chalk.cyan('Draw%')
      ],
      style: { head: [], border: [] }
    });
  }

  setupKeyboardControls() {
    keypress(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    process.stdin.on('keypress', (ch, key) => {
      if (!key) return;

      // Handle keyboard shortcuts from config
      const shortcuts = this.config.KEYBOARD_SHORTCUTS;
      
      // Trading controls
      if (key.name === shortcuts.TRADING.PAUSE_RESUME.key) {
        this.toggleTrading();
      }
      if (key.name === shortcuts.TRADING.EMERGENCY_STOP.key) {
        this.emergencyStop();
      }

      // Display controls
      if (key.ctrl && key.name === shortcuts.DISPLAY.CLEAR_SCREEN.key) {
        console.clear();
        this.render();
      }
      if (key.ctrl && key.name === shortcuts.DISPLAY.TOGGLE_AUTOSCROLL.key) {
        this.autoScroll = !this.autoScroll;
        this.notify('Auto-scroll ' + (this.autoScroll ? 'enabled' : 'disabled'));
      }
      if (key.ctrl && key.name === shortcuts.DISPLAY.TOGGLE_CHARTS.key) {
        this.showCharts = !this.showCharts;
        this.render();
      }

      // View switching
      if (key.name === '1') this.setView('trades');
      if (key.name === '2') this.setView('positions');
      if (key.name === '3') this.setView('performance');
      if (key.name === '4') this.setView('tokens');
      if (key.name === '5') this.setView('dashboard');

      // Risk adjustment
      if (key.name === '+') this.adjustRisk(0.01);
      if (key.name === '-') this.adjustRisk(-0.01);

      // Exit
      if (key.ctrl && key.name === 'c') {
        this.emit('shutdown');
        process.exit();
      }
    });
  }

  setupEventListeners() {
    // Position events
    this.tokenTracker.on('positionOpened', ({ position }) => {
      this.activePositions.set(position.mint, position);
      this.render();
      
      notifier.notify({
        title: 'Position Opened',
        message: `Opened ${position.size.toFixed(2)} ${position.symbol} @ ${position.entryPrice.toFixed(4)}`
      });
    });

    this.tokenTracker.on('positionClosed', ({ position }) => {
      this.activePositions.delete(position.mint);
      this.tradeHistory.unshift({
        timestamp: new Date().toLocaleTimeString(),
        symbol: position.symbol,
        type: 'CLOSE',
        price: position.currentPrice,
        size: position.size,
        pnl: position.realizedPnLSol
      });
      this.render();
      
      notifier.notify({
        title: 'Position Closed',
        message: `Closed ${position.symbol} with PnL: ${position.realizedPnLSol.toFixed(2)} SOL`
      });
    });

    // Token events
    this.tokenTracker.on('tokenAdded', (token) => {
      if (!token || !token.mint) {
        console.error('Invalid token data received in tokenAdded event');
        return;
      }
      this.tokenList.set(token.mint, token);
      this.render();
    });

    this.tokenTracker.on('tokenUpdated', (token) => {
      if (!token || !token.mint) {
        console.error('Invalid token data received in tokenUpdated event');
        return;
      }
      this.tokenList.set(token.mint, token);
      this.render();
    });

    this.tokenTracker.on('tokenStateChanged', ({ token, from, to }) => {
      if (!token || !token.mint || !token.symbol) {
        console.error('Invalid token data received in tokenStateChanged event');
        return;
      }
      if (to === STATES.DEAD) {
        notifier.notify({
          title: 'Token Dead',
          message: `${token.symbol} marked as DEAD (${token.getDrawdownPercentage().toFixed(1)}% drawdown)`
        });
      }
      this.render();
    });
  }

  startPerformanceTracking() {
    if (this.performanceTimer) {
      clearInterval(this.performanceTimer);
    }
    this.performanceTimer = setInterval(() => {
      this.updatePerformanceMetrics();
    }, 5000); // Update every 5 seconds
  }

  stopPerformanceTracking() {
    if (this.performanceTimer) {
      clearInterval(this.performanceTimer);
      this.performanceTimer = null;
    }
  }

  updatePerformanceMetrics() {
    const metrics = this.performanceMetrics;
    
    // Calculate total P&L
    metrics.totalPnLSol = Array.from(this.activePositions.values())
      .reduce((total, pos) => total + pos.unrealizedPnLSol, 0);
    metrics.totalPnLUsd = this.tokenTracker.priceManager.solToUSD(metrics.totalPnLSol);

    // Calculate trade statistics
    const trades = this.tradeHistory;
    const winningTrades = trades.filter(t => t.pnl > 0);
    
    metrics.totalTrades = trades.length;
    metrics.winRate = trades.length ? (winningTrades.length / trades.length) * 100 : 0;
    metrics.avgWin = winningTrades.length ? 
      winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length : 0;
    
    const losingTrades = trades.filter(t => t.pnl <= 0);
    metrics.avgLoss = losingTrades.length ? 
      losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length : 0;
    
    metrics.bestTrade = trades.length ? Math.max(...trades.map(t => t.pnl)) : 0;
    metrics.worstTrade = trades.length ? Math.min(...trades.map(t => t.pnl)) : 0;
    
    // Calculate position metrics
    metrics.activePositions = this.activePositions.size;
    metrics.avgHoldTime = Array.from(this.activePositions.values())
      .reduce((sum, pos) => sum + pos.getTimeInPosition(), 0) / Math.max(1, this.activePositions.size);

    this.render();
  }

  updatePerformanceTable() {
    this.performanceTable.length = 0;
    const m = this.performanceMetrics;
    const pnlColor = m.totalPnLSol >= 0 ? chalk.green : chalk.red;
    
    this.performanceTable.push(
      ['Total P&L (SOL)', pnlColor(m.totalPnLSol.toFixed(3))],
      ['Total P&L (USD)', pnlColor(`$${m.totalPnLUsd.toFixed(2)}`)],
      ['Win Rate', chalk.white(`${m.winRate.toFixed(1)}%`)],
      ['Avg Win', chalk.green(m.avgWin.toFixed(3))],
      ['Avg Loss', chalk.red(m.avgLoss.toFixed(3))],
      ['Best Trade', chalk.green(m.bestTrade.toFixed(3))],
      ['Worst Trade', chalk.red(m.worstTrade.toFixed(3))],
      ['Active Positions', chalk.white(m.activePositions.toString())],
      ['Total Trades', chalk.white(m.totalTrades.toString())],
      ['Avg Hold Time', chalk.white(this.formatTime(m.avgHoldTime))]
    );
  }

  formatTime(ms) {
    if (!ms || ms < 0) return '0s';
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
  }

  formatNumber(num) {
    if (!num && num !== 0) return '0';
    if (isNaN(num)) return '0';
    
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
    return num.toFixed(2);
  }

  toggleTrading() {
    this.isRunning = !this.isRunning;
    this.notify(`Trading ${this.isRunning ? 'resumed' : 'paused'}`);
    this.emit('tradingStateChange', this.isRunning);
    this.render();
  }

  async emergencyStop() {
    if (this.config.KEYBOARD_SHORTCUTS.TRADING.EMERGENCY_STOP.requiresConfirmation) {
      const confirmed = await this.confirmAction('⚠️ Emergency Stop: Close all positions?');
      if (!confirmed) return;
    }
    
    this.isRunning = false;
    this.notify('🚨 EMERGENCY STOP - Closing all positions', { sound: true });
    this.emit('emergencyStop');
  }

  adjustRisk(change) {
    const newRisk = Math.max(0.01, Math.min(0.5, this.config.RISK_PER_TRADE + change));
    this.config.RISK_PER_TRADE = newRisk;
    this.notify(`Risk adjusted to ${(newRisk * 100).toFixed(1)}%`);
    this.emit('riskAdjusted', newRisk);
  }

  setView(view) {
    this.currentView = view;
    this.render();
  }

  notify(message, options = {}) {
    console.log(chalk.yellow(message));
    
    if (options.notification !== false) {
      notifier.notify({
        title: 'Money Printer',
        message,
        sound: options.sound || false
      });
    }
  }

  async confirmAction(message) {
    const answer = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirmed',
      message: chalk.yellow(message),
      default: false
    }]);
    return answer.confirmed;
  }

  updateBalanceHistory(balance) {
    this.balanceHistory.push(balance);
    if (this.balanceHistory.length > 50) {
      this.balanceHistory.shift();
    }
  }

  updatePosition(token, position) {
    this.activePositions.set(token, position);
    if (this.currentView === 'positions' || this.currentView === 'dashboard') {
      this.render();
    }
  }

  addTrade(trade) {
    this.tradeHistory.unshift(trade);
    if (this.tradeHistory.length > 100) {
      this.tradeHistory.pop();
    }
    if (this.currentView === 'trades' || this.currentView === 'dashboard') {
      this.render();
    }
  }

  updateToken(token) {
    this.tokenList.set(token.mint, token);
    if (this.currentView === 'tokens' || this.currentView === 'dashboard') {
      this.render();
    }
  }

  removeToken(token) {
    this.tokenList.delete(token.mint);
    if (this.currentView === 'tokens' || this.currentView === 'dashboard') {
      this.render();
    }
  }

  updatePositionsTable() {
    this.positionsTable.length = 0;
    
    for (const [mint, position] of this.activePositions) {
      const timeSinceOpen = position.getTimeInPosition();
      const timeString = this.formatTime(timeSinceOpen);
      const roi = position.roiPercentage;
      const roiColor = roi >= 0 ? chalk.green : chalk.red;
      
      this.positionsTable.push([
        chalk.yellow(position.symbol),
        chalk.white(position.getAverageEntryPrice()?.toFixed(4) || 'N/A'),
        chalk.white(position.currentPrice?.toFixed(4) || 'N/A'),
        chalk.white(position.size?.toFixed(4) || 'N/A'),
        roiColor(`${position.unrealizedPnLSol.toFixed(3)} (${roi.toFixed(1)}%)`),
        this.formatPositionState(position.state),
        chalk.white(timeString)
      ]);
    }
  }

  formatPositionState(state) {
    switch (state) {
      case 'PENDING':
        return chalk.yellow(state);
      case 'OPEN':
        return chalk.green(state);
      case 'CLOSED':
        return chalk.red(state);
      default:
        return chalk.white(state);
    }
  }

  updateTokenListTable() {
    this.tokenListTable.length = 0;
    
    const sortedTokens = Array.from(this.tokenList.entries())
      .sort(([, a], [, b]) => b.marketCapSol - a.marketCapSol);
    
    for (const [mint, token] of sortedTokens) {
      const age = Date.now() - token.minted;
      const ageString = this.formatTime(age);
      const safetyScore = token.safetyChecker.getScore();
      const drawdown = token.getDrawdownPercentage();
      const drawdownColor = drawdown >= 15 ? chalk.red : 
                          drawdown >= 10 ? chalk.yellow : 
                          chalk.green;
      
      // Get detailed safety info
      const safetyInfo = this.getTokenSafetyInfo(token);
      const safetyIndicator = this.formatSafetyIndicators(safetyInfo);
      
      this.tokenListTable.push([
        chalk.yellow(token.symbol),
        chalk.white(ageString),
        chalk.white(this.formatNumber(token.marketCapSol)),
        chalk.white(token.currentPrice?.toFixed(4) || 'N/A'),
        chalk.white(this.formatNumber(token.vSolInBondingCurve)),
        safetyIndicator,
        this.formatTokenState(token.stateManager.getCurrentState()),
        drawdownColor(`${drawdown.toFixed(1)}%`)
      ]);
    }
  }

  formatTokenState(state) {
    switch (state) {
      case STATES.NEW:
        return chalk.yellow('NEW');
      case STATES.READY:
        return chalk.green('READY');
      case STATES.DEAD:
        return chalk.red('DEAD');
      default:
        return chalk.gray('UNKNOWN');
    }
  }

  getTokenSafetyInfo(token) {
    const safety = token.safetyChecker;
    return {
      score: safety.getScore(),
      liquidityOk: safety.checkLiquidity(token),
      ageOk: safety.checkAge(token),
      volumeOk: safety.checkVolume(token),
      marketCapOk: safety.checkMarketCap(token),
      drawdownOk: token.getDrawdownPercentage() < 15
    };
  }

  formatSafetyIndicators(safety) {
    const indicators = [];
    if (safety.liquidityOk) indicators.push('L');
    if (safety.ageOk) indicators.push('A');
    if (safety.volumeOk) indicators.push('V');
    if (safety.marketCapOk) indicators.push('M');
    if (safety.drawdownOk) indicators.push('D');

    const color = safety.score >= 80 ? chalk.green :
                 safety.score >= 60 ? chalk.yellow :
                 chalk.red;
    
    return color(`${safety.score}% [${indicators.join('')}]`);
  }

  renderBalanceChart() {
    if (!this.showCharts || this.balanceHistory.length < 2) return '';

    const config = {
      height: 10,
      colors: [asciichart.green],
      format: x => x.toFixed(3)
    };

    return '\nBalance History (SOL):\n' +
           asciichart.plot(this.balanceHistory.slice(-50), config);
  }

  render() {
    console.clear();
    
    // Header
    console.log(chalk.cyan.bold('🖨️  Money Printer v1.0.0'));
    console.log(chalk.gray(`Status: ${this.isRunning ? chalk.green('Running') : chalk.yellow('Paused')}`));
    
    switch (this.currentView) {
      case 'dashboard':
        console.log(chalk.cyan.bold('\nPerformance Metrics:'));
        this.updatePerformanceTable();
        console.log(this.performanceTable.toString());
        
        if (this.showCharts) {
          console.log(this.renderBalanceChart());
        }
        
        console.log(chalk.cyan.bold('\nActive Positions:'));
        this.updatePositionsTable();
        console.log(this.positionsTable.toString());
        break;
      case 'trades':
        console.log(chalk.cyan.bold('\nRecent Trades:'));
        console.log(this.renderTradeHistory());
        break;
      case 'positions':
        console.log(chalk.cyan.bold('\nActive Positions:'));
        this.updatePositionsTable();
        console.log(this.positionsTable.toString());
        break;
      case 'performance':
        console.log(chalk.cyan.bold('\nPerformance Metrics:'));
        this.updatePerformanceTable();
        console.log(this.performanceTable.toString());
        break;
      case 'tokens':
        console.log(chalk.cyan.bold('\nToken List:'));
        this.updateTokenListTable();
        console.log(this.tokenListTable.toString());
        break;
    }
    
    // Footer
    console.log(chalk.gray('\nAuto-scroll:', this.autoScroll ? 'ON' : 'OFF'));
    console.log(chalk.gray('Charts:', this.showCharts ? 'ON' : 'OFF'));
  }

  cleanup() {
    // Stop performance tracking
    this.stopPerformanceTracking();
    
    // Clear all event listeners
    this.removeAllListeners();
    
    // Stop any active intervals
    if (this.renderTimer) {
      clearInterval(this.renderTimer);
      this.renderTimer = null;
    }
    
    // Clear data
    this.activePositions.clear();
    this.tokenList.clear();
    this.tradeHistory = [];
    this.balanceHistory = [];
    
    // Reset state
    this.isRunning = false;
  }
}

module.exports = CLIManager;
