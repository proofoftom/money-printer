const blessed = require('blessed');
const contrib = require('blessed-contrib');

class TokenDetailModal {
  constructor(parent, token, traderManager) {
    this.token = token;
    this.traderManager = traderManager;
    
    // Create modal overlay
    this.modal = blessed.box({
      parent: parent,
      top: 'center',
      left: 'center',
      width: '80%',
      height: '80%',
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'white'
        }
      },
      tags: true
    });

    // Create sections
    this.createHeader();
    this.createTraderRankings();
    this.createTimeWindows();
    this.createTraderMetrics();

    // Setup key handlers
    this.setupKeyHandlers();
  }

  createHeader() {
    this.header = blessed.box({
      parent: this.modal,
      top: 0,
      height: 3,
      tags: true,
      content: this.formatHeader()
    });
  }

  createTraderRankings() {
    this.rankings = contrib.table({
      parent: this.modal,
      top: 4,
      height: '30%',
      columnSpacing: 3,
      columnWidth: [15, 10, 10, 15],
      fg: 'white',
      selectedFg: 'white',
      selectedBg: 'blue'
    });

    this.updateRankings();
  }

  createTimeWindows() {
    this.timeWindows = contrib.line({
      parent: this.modal,
      top: '40%',
      height: '30%',
      xLabelPadding: 3,
      showLegend: true,
      legend: { width: 20 }
    });

    this.updateTimeWindows();
  }

  createTraderMetrics() {
    this.metrics = blessed.box({
      parent: this.modal,
      top: '75%',
      height: '20%',
      tags: true,
      content: this.formatTraderMetrics()
    });
  }

  formatHeader() {
    return `{center}${this.token.symbol} Details{/center}
Market Cap: $${this.formatNumber(this.token.marketCap)} | Price: $${this.token.price} | Age: ${this.formatAge(this.token.createdAt)}`;
  }

  updateRankings() {
    const { byWinRate, byVolume } = this.traderManager.topRecoveryTraders;
    const data = [
      ['Trader', 'Win Rate', 'Volume', 'Hold Time']
    ];

    // Combine and sort traders
    const traders = new Set([...byWinRate, ...byVolume].map(t => t.trader));
    
    traders.forEach(trader => {
      const rep = trader.reputation;
      data.push([
        trader.publicKey.slice(0, 8),
        `${(rep.profitableTrades / rep.totalTrades * 100).toFixed(1)}%`,
        this.formatNumber(trader.totalVolume),
        this.formatDuration(rep.averageHoldTime)
      ]);
    });

    this.rankings.setData({
      headers: ['Trader', 'Win Rate', 'Volume', 'Hold Time'],
      data: data.slice(1)
    });
  }

  updateTimeWindows() {
    const trades = this.token.tradeHistory;
    const timeWindows = ['1m', '5m', '30m'];
    const series = timeWindows.map(window => ({
      title: window,
      x: trades[window].map(t => new Date(t.timestamp).toLocaleTimeString()),
      y: trades[window].map(t => t.price),
      style: { line: window === '1m' ? 'red' : window === '5m' ? 'yellow' : 'green' }
    }));

    this.timeWindows.setData(series);
  }

  formatTraderMetrics() {
    const rep = this.token.reputation || {};
    return `
Profitable Trades: ${rep.profitableTrades}/${rep.totalTrades} (${((rep.profitableTrades/rep.totalTrades)*100).toFixed(1)}%)
Average Hold Time: ${this.formatDuration(rep.averageHoldTime)}
Trading Frequency: ${rep.tradeFrequency?.toFixed(2)} trades/min
    `;
  }

  formatNumber(num) {
    if (num >= 1000000) return `${(num/1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num/1000).toFixed(1)}k`;
    return num.toFixed(2);
  }

  formatAge(timestamp) {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  }

  formatDuration(ms) {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  }

  setupKeyHandlers() {
    this.modal.key(['escape', 'enter'], () => {
      this.hide();
    });
  }

  show() {
    this.modal.show();
    this.modal.setFront();
    this.modal.screen.render();
  }

  hide() {
    this.modal.hide();
    this.modal.screen.render();
  }

  destroy() {
    this.modal.destroy();
  }
}

module.exports = TokenDetailModal;
