const Table = require('cli-table3');
const chalk = require('chalk');
const asciichart = require('asciichart');
const keypress = require('keypress');
const notifier = require('node-notifier');
const EventEmitter = require('events');

class CLIManager extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.isRunning = false;
    this.autoScroll = true;
    this.showCharts = true;
    this.currentView = 'dashboard';
    this.balanceHistory = [];
    this.activePositions = new Map();
    this.tradeHistory = [];
    this.tokenList = new Map();
    
    // Initialize tables
    this.initializeTables();
    
    // Setup keyboard controls
    this.setupKeyboardControls();
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
        chalk.cyan('Volume'),
        chalk.cyan('Safety')
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

  toggleTrading() {
    this.isRunning = !this.isRunning;
    this.notify(`Trading ${this.isRunning ? 'resumed' : 'paused'}`);
    this.emit('tradingStateChange', this.isRunning);
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

  renderBalanceChart() {
    if (!this.showCharts || this.balanceHistory.length < 2) return '';
    
    const config = {
      height: 10,
      colors: [asciichart.blue],
      format: x => x.toFixed(3)
    };
    
    return '\nBalance History:\n' + asciichart.plot(this.balanceHistory, config);
  }

  renderPerformanceMetrics() {
    this.performanceTable.length = 0;
    
    const totalTrades = this.tradeHistory.length;
    const winningTrades = this.tradeHistory.filter(t => t.pnl > 0).length;
    const winRate = totalTrades ? (winningTrades / totalTrades * 100).toFixed(1) : '0.0';
    
    const totalPnL = this.tradeHistory.reduce((sum, t) => sum + t.pnl, 0);
    const avgPnL = totalTrades ? (totalPnL / totalTrades).toFixed(3) : '0.000';
    
    this.performanceTable.push(
      ['Total Trades', totalTrades],
      ['Win Rate', `${winRate}%`],
      ['Average PnL', `${avgPnL} SOL`],
      ['Total PnL', `${totalPnL.toFixed(3)} SOL`],
      ['Active Positions', this.activePositions.size]
    );
    
    return this.performanceTable.toString();
  }

  renderPositions() {
    this.positionsTable.length = 0;
    
    for (const [token, position] of this.activePositions) {
      const pnlColor = position.pnl >= 0 ? chalk.green : chalk.red;
      
      this.positionsTable.push([
        position.symbol,
        position.entryPrice.toFixed(6),
        position.currentPrice.toFixed(6),
        position.size.toFixed(3),
        pnlColor(`${position.pnl.toFixed(3)} (${position.pnlPercent.toFixed(1)}%)`),
        position.holdTime
      ]);
    }
    
    return this.positionsTable.toString();
  }

  renderTradeHistory() {
    this.tradeHistoryTable.length = 0;
    
    for (const trade of this.tradeHistory.slice(0, 10)) {
      const pnlColor = trade.pnl >= 0 ? chalk.green : chalk.red;
      
      this.tradeHistoryTable.push([
        trade.timestamp,
        trade.symbol,
        trade.type === 'buy' ? chalk.green('BUY') : chalk.red('SELL'),
        trade.price.toFixed(6),
        trade.size.toFixed(3),
        pnlColor(`${trade.pnl.toFixed(3)}`)
      ]);
    }
    
    return this.tradeHistoryTable.toString();
  }

  renderTokenList() {
    this.tokenListTable.length = 0;
    
    for (const token of this.tokenList.values()) {
      const safetyColor = token.isSafe ? chalk.green : chalk.red;
      
      this.tokenListTable.push([
        token.symbol,
        token.age,
        token.marketCap.toFixed(3),
        token.volume.toFixed(3),
        safetyColor(token.isSafe ? 'SAFE' : 'UNSAFE')
      ]);
    }
    
    return this.tokenListTable.toString();
  }

  render() {
    console.clear();
    
    // Header
    console.log(chalk.blue.bold('\n🖨️  Money Printer Dashboard'));
    console.log(chalk.gray('Press ? for help, Ctrl+C to exit\n'));
    
    // Status
    console.log(chalk.yellow(`Status: ${this.isRunning ? chalk.green('RUNNING') : chalk.red('PAUSED')}`));
    console.log(chalk.yellow(`Risk per trade: ${(this.config.RISK_PER_TRADE * 100).toFixed(1)}%\n`));
    
    // Balance chart
    if (this.showCharts) {
      console.log(this.renderBalanceChart());
    }
    
    // View-specific content
    switch (this.currentView) {
      case 'dashboard':
        console.log(chalk.cyan.bold('\nPerformance Metrics:'));
        console.log(this.renderPerformanceMetrics());
        console.log(chalk.cyan.bold('\nActive Positions:'));
        console.log(this.renderPositions());
        break;
        
      case 'trades':
        console.log(chalk.cyan.bold('\nRecent Trades:'));
        console.log(this.renderTradeHistory());
        break;
        
      case 'positions':
        console.log(chalk.cyan.bold('\nActive Positions:'));
        console.log(this.renderPositions());
        break;
        
      case 'performance':
        console.log(chalk.cyan.bold('\nPerformance Metrics:'));
        console.log(this.renderPerformanceMetrics());
        break;
        
      case 'tokens':
        console.log(chalk.cyan.bold('\nToken List:'));
        console.log(this.renderTokenList());
        break;
    }
    
    // Footer
    console.log(chalk.gray('\nAuto-scroll:', this.autoScroll ? 'ON' : 'OFF'));
    console.log(chalk.gray('Charts:', this.showCharts ? 'ON' : 'OFF'));
  }
}

module.exports = CLIManager;
