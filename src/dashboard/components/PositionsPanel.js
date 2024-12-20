const contrib = require('blessed-contrib');

class PositionsPanel {
  constructor(grid, config, options = {}) {
    this.config = config;
    
    this.table = grid.set(
      options.row || 2,
      options.col || 6,
      options.rowSpan || 2,
      options.colSpan || 6,
      contrib.table,
      {
        keys: true,
        fg: config.DASHBOARD.COLORS.INFO,
        label: 'Active Positions',
        columnSpacing: 2,
        columnWidth: [10, 8, 8, 8, 8, 8]
      }
    );

    // Initialize with empty data
    this.positions = [];
    this.updateTable();
  }

  updatePositions(positions) {
    this.positions = positions;
    this.updateTable();
  }

  updateTable() {
    const data = this.positions.map(position => [
      position.token.symbol,
      position.isLong ? 'LONG' : 'SHORT',
      position.size.toFixed(4),
      position.entryPrice.toFixed(this.config.DASHBOARD.CHART.PRICE_DECIMALS),
      position.currentPrice.toFixed(this.config.DASHBOARD.CHART.PRICE_DECIMALS),
      this.formatPnL(position.realizedPnLWithFeesSol)
    ]);

    this.table.setData({
      headers: ['Token', 'Side', 'Size', 'Entry', 'Current', 'P&L'],
      data
    });
  }

  formatPnL(pnl) {
    const formatted = pnl.toFixed(4);
    const color = pnl >= 0 ? 
      this.config.DASHBOARD.COLORS.PRICE_UP :
      this.config.DASHBOARD.COLORS.PRICE_DOWN;
    return `{${color}-fg}${formatted}{/}`;
  }

  focus() {
    this.table.focus();
  }

  get selectedPosition() {
    if (this.positions.length === 0) return null;
    return this.positions[this.table.rows.selected];
  }
}

module.exports = PositionsPanel;
