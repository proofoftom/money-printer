const blessed = require('blessed');

class StatusBar {
  constructor(grid, config, options = {}) {
    this.config = config;
    
    this.box = grid.set(
      options.row || 10,
      options.col || 0,
      options.rowSpan || 2,
      options.colSpan || 12,
      blessed.box,
      {
        label: 'Status',
        padding: 1,
        style: {
          fg: config.DASHBOARD.COLORS.INFO
        }
      }
    );

    this.state = {
      connected: false,
      currentToken: null,
      totalPnL: 0,
      alerts: []
    };

    // Start time updater
    this.startTimeUpdater();
  }

  update(newState) {
    this.state = { ...this.state, ...newState };
    this.render();
  }

  addAlert(alert) {
    this.state.alerts.push(alert);
    if (this.state.alerts.length > 3) {
      this.state.alerts.shift();
    }
    this.render();
  }

  startTimeUpdater() {
    setInterval(() => this.render(), 1000);
  }

  render() {
    const time = new Date().toLocaleTimeString();
    const connection = this.state.connected ? 
      '{green-fg}Connected{/}' : 
      '{red-fg}Disconnected{/}';
    
    const token = this.state.currentToken ?
      `Token: ${this.state.currentToken}` :
      'No Token Selected';
    
    const pnl = this.formatPnL(this.state.totalPnL);
    const alerts = this.state.alerts.length > 0 ?
      `| Alerts: ${this.state.alerts.join(', ')}` :
      '';

    this.box.setContent(
      `${connection} | ${token} | P&L: ${pnl} | ${time} ${alerts}`
    );
  }

  formatPnL(pnl) {
    const formatted = pnl.toFixed(4);
    return pnl >= 0 ?
      `{green-fg}+${formatted}{/}` :
      `{red-fg}${formatted}{/}`;
  }

  flash(duration = 500) {
    const original = this.box.style.bg;
    this.box.style.bg = this.config.DASHBOARD.COLORS.ALERT;
    
    setTimeout(() => {
      this.box.style.bg = original;
    }, duration);
  }
}

module.exports = StatusBar;
