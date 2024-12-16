const blessed = require('blessed');
const contrib = require('blessed-contrib');
const EventEmitter = require('events');

class LayoutManager extends EventEmitter {
  constructor(screen) {
    super();
    this.screen = screen;
    this.components = new Map();
    this.activeSection = null;
    
    // Initialize the base layout
    this.initializeLayout();
    
    // Set up keyboard handlers
    this.setupKeyboardHandlers();
  }

  initializeLayout() {
    // Create the main layout grid
    this.mainGrid = new contrib.grid({
      rows: 12,
      cols: 12,
      screen: this.screen
    });

    // Status bar at the very top (row 0)
    this.statusBar = this.mainGrid.set(0, 0, 1, 12, blessed.box, {
      label: ' System Status ',
      tags: true,
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        label: { bold: true }
      }
    });

    // Main content area (rows 1-10)
    // Left side - Token Lists
    this.leftPane = this.mainGrid.set(1, 0, 10, 4, blessed.box, {
      label: ' Token Lists ',
      border: { type: 'line' },
      style: {
        border: { fg: 'blue' },
        label: { bold: true }
      }
    });

    // Right side - Details View
    this.rightPane = this.mainGrid.set(1, 4, 10, 8, blessed.box, {
      label: ' Details ',
      border: { type: 'line' },
      style: {
        border: { fg: 'blue' },
        label: { bold: true }
      }
    });

    // System log at the bottom (row 11)
    this.logBox = this.mainGrid.set(11, 0, 1, 12, blessed.log, {
      label: ' System Log ',
      tags: true,
      border: { type: 'line' },
      style: {
        border: { fg: 'red' },
        label: { bold: true }
      },
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: ' ',
        inverse: true
      }
    });

    // Store references to all major components
    this.components.set('statusBar', this.statusBar);
    this.components.set('leftPane', this.leftPane);
    this.components.set('rightPane', this.rightPane);
    this.components.set('logBox', this.logBox);

    // Initialize the collapsible state
    this.logBoxExpanded = false;
    this.logBoxHeight = 1;
  }

  setupKeyboardHandlers() {
    // Global navigation
    this.screen.key(['tab'], () => {
      this.cycleActiveSection();
    });

    // Log box expansion
    this.screen.key(['l'], () => {
      this.toggleLogBox();
    });

    // Quit handler
    this.screen.key(['q', 'C-c'], () => {
      this.emit('quit');
    });
  }

  cycleActiveSection() {
    const sections = ['leftPane', 'rightPane', 'logBox'];
    const currentIndex = sections.indexOf(this.activeSection);
    this.activeSection = sections[(currentIndex + 1) % sections.length];
    this.emit('sectionChanged', this.activeSection);
    this.screen.render();
  }

  toggleLogBox() {
    this.logBoxExpanded = !this.logBoxExpanded;
    
    if (this.logBoxExpanded) {
      // Expand log box to 3 rows
      this.mainGrid.set(9, 0, 3, 12, this.logBox);
    } else {
      // Collapse log box to 1 row
      this.mainGrid.set(11, 0, 1, 12, this.logBox);
    }

    this.screen.render();
  }

  getComponent(name) {
    return this.components.get(name);
  }

  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const colorMap = {
      info: '{white-fg}',
      warning: '{yellow-fg}',
      error: '{red-fg}',
      success: '{green-fg}'
    };
    
    const color = colorMap[type] || colorMap.info;
    this.logBox.log(`${color}[${timestamp}] ${message}{/}`);
  }

  updateStatusBar(metrics) {
    const { balance, pnl, activePositions, systemHealth } = metrics;
    const content = [
      `{white-fg}Balance:{/} ${balance.toFixed(4)} SOL`,
      `{${pnl >= 0 ? 'green' : 'red'}-fg}P/L:{/} ${pnl.toFixed(4)} SOL`,
      `{cyan-fg}Active Positions:{/} ${activePositions}`,
      `{${systemHealth === 'healthy' ? 'green' : 'red'}-fg}System: ${systemHealth}{/}`
    ].join(' | ');

    this.statusBar.setContent(content);
    this.screen.render();
  }

  render() {
    this.screen.render();
  }
}

module.exports = LayoutManager;
