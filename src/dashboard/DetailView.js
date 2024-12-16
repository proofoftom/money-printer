const blessed = require('blessed');
const contrib = require('blessed-contrib');

class DetailView {
  constructor(container) {
    this.container = container;
    this.currentToken = null;
    this.charts = new Map();
    
    this.initializeLayout();
  }

  initializeLayout() {
    // Create a grid for the detail view
    this.grid = new contrib.grid({
      rows: 12,
      cols: 12,
      screen: this.container
    });

    // Price chart (top)
    this.priceChart = this.grid.set(0, 0, 6, 12, contrib.line, {
      label: ' Price Action ',
      showLegend: true,
      legend: { width: 20 },
      style: {
        line: 'yellow',
        text: 'white',
        baseline: 'black'
      }
    });

    // Volume chart (middle-left)
    this.volumeChart = this.grid.set(6, 0, 3, 6, contrib.bar, {
      label: ' Volume Profile ',
      barWidth: 4,
      barSpacing: 1,
      xOffset: 0,
      maxHeight: 9
    });

    // Trader metrics (middle-right)
    this.traderMetrics = this.grid.set(6, 6, 3, 6, contrib.table, {
      keys: true,
      fg: 'white',
      selectedFg: 'white',
      selectedBg: 'blue',
      interactive: true,
      label: ' Trader Activity ',
      width: '50%',
      height: '50%',
      border: { type: 'line', fg: 'cyan' },
      columnSpacing: 3,
      columnWidth: [12, 12]
    });

    // Position details (bottom)
    this.positionDetails = this.grid.set(9, 0, 3, 12, blessed.box, {
      label: ' Position Details ',
      tags: true,
      border: { type: 'line' },
      style: {
        border: { fg: 'yellow' }
      },
      content: ' No active position'
    });

    this.charts.set('price', this.priceChart);
    this.charts.set('volume', this.volumeChart);
    this.charts.set('traders', this.traderMetrics);
    this.charts.set('position', this.positionDetails);
  }

  updateToken(token) {
    this.currentToken = token;
    
    if (!token) {
      this.clearView();
      return;
    }

    this.updatePriceChart(token);
    this.updateVolumeProfile(token);
    this.updateTraderMetrics(token);
    this.updatePositionDetails(token);
    
    this.container.screen.render();
  }

  updatePriceChart(token) {
    const data = {
      title: 'Price',
      x: token.priceHistory.map((p, i) => i.toString()),
      y: token.priceHistory
    };

    this.priceChart.setData([data]);
  }

  updateVolumeProfile(token) {
    // Aggregate volume data into time buckets
    const volumeData = {
      titles: ['1m', '5m', '15m', '30m', '1h'],
      data: [
        token.volumeHistory.slice(-1)[0] || 0,
        token.volumeHistory.slice(-5).reduce((a, b) => a + b, 0),
        token.volumeHistory.slice(-15).reduce((a, b) => a + b, 0),
        token.volumeHistory.slice(-30).reduce((a, b) => a + b, 0),
        token.volumeHistory.slice(-60).reduce((a, b) => a + b, 0)
      ]
    };

    this.volumeChart.setData(volumeData);
  }

  updateTraderMetrics(token) {
    const data = [
      ['Metric', 'Value'],
      ['Active Traders', token.traderActivity.activeTraders.size],
      ['Whales', token.traderActivity.whales.size],
      ['Recent Exits', token.traderActivity.exitedTraders.size],
      ['24h Volume', token.volume24h.toFixed(2)]
    ];

    this.traderMetrics.setData(data);
  }

  updatePositionDetails(token) {
    if (!token.inPosition) {
      this.positionDetails.setContent(' No active position');
      return;
    }

    const position = token.currentPosition;
    const content = [
      `{white-fg}Entry Price:{/} ${position.entryPrice.toFixed(6)}`,
      `{white-fg}Current Price:{/} ${token.currentPrice.toFixed(6)}`,
      `{white-fg}Size:{/} ${position.size.toFixed(2)}`,
      `{${position.pnl >= 0 ? 'green' : 'red'}-fg}P/L:{/} ${position.pnl.toFixed(4)} SOL`,
      `{white-fg}Max Drawdown:{/} ${position.maxDrawdown.toFixed(2)}%`
    ].join(' | ');

    this.positionDetails.setContent(content);
  }

  clearView() {
    this.priceChart.setData([{ x: [], y: [] }]);
    this.volumeChart.setData({ titles: [], data: [] });
    this.traderMetrics.setData([['Metric', 'Value']]);
    this.positionDetails.setContent(' No token selected');
    this.container.screen.render();
  }
}

module.exports = DetailView;
