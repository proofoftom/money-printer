const contrib = require('blessed-contrib');

class LogPanel {
  constructor(grid, config, options = {}) {
    this.config = config;
    
    this.log = grid.set(
      options.row || 6,
      options.col || 0,
      options.rowSpan || 4,
      options.colSpan || 6,
      contrib.log,
      {
        fg: config.DASHBOARD.COLORS.INFO,
        label: options.label || 'Events & Logs',
        bufferLength: options.isAlert ? 50 : config.DASHBOARD.LOG_BUFFER
      }
    );

    this.isAlert = options.isAlert || false;
  }

  addEntry(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    let formattedMessage = `[${timestamp}] `;

    switch(type) {
      case 'error':
        formattedMessage += `{${this.config.DASHBOARD.COLORS.PRICE_DOWN}-fg}${message}{/}`;
        break;
      case 'warning':
        formattedMessage += `{${this.config.DASHBOARD.COLORS.WARNING}-fg}${message}{/}`;
        break;
      case 'success':
        formattedMessage += `{${this.config.DASHBOARD.COLORS.PRICE_UP}-fg}${message}{/}`;
        break;
      default:
        formattedMessage += message;
    }

    this.log.log(formattedMessage);

    // Play sound for alerts if enabled
    if (this.isAlert && this.config.ALERTS.SOUNDS.WARNING) {
      process.stdout.write('\x07'); // Terminal bell
    }
  }

  clear() {
    this.log.setContent('');
  }

  focus() {
    this.log.focus();
  }
}

module.exports = LogPanel;
