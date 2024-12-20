const contrib = require('blessed-contrib');

class ChartPanel {
  constructor(grid, config, options = {}) {
    this.config = config;
    this.candles = [];
    this.volumes = [];
    
    // Create the chart
    this.chart = grid.set(
      options.row || 0,
      options.col || 0,
      options.rowSpan || 6,
      options.colSpan || 6,
      contrib.line,
      {
        style: {
          line: config.DASHBOARD.COLORS.PRICE_UP,
          text: config.DASHBOARD.COLORS.INFO,
          baseline: config.DASHBOARD.COLORS.GRID
        },
        xLabelPadding: 3,
        xPadding: 5,
        label: 'Price Chart',
        showLegend: true,
        legend: { width: 20 }
      }
    );

    // Initialize data series
    this.series = {
      price: {
        title: 'Price',
        x: [],
        y: [],
        style: { line: config.DASHBOARD.COLORS.PRICE_UP }
      },
      volume: {
        title: 'Volume',
        x: [],
        y: [],
        style: { line: config.DASHBOARD.COLORS.INFO }
      }
    };
  }

  addCandle(candle) {
    // Add new candle data
    this.candles.push(candle);
    
    // Keep only MAX_CANDLES
    if (this.candles.length > this.config.DASHBOARD.CHART.MAX_CANDLES) {
      this.candles.shift();
    }

    // Update series data
    this.series.price.x = this.candles.map(c => this.formatTime(c.timestamp));
    this.series.price.y = this.candles.map(c => c.close);
    
    // Update color based on price movement
    const lastTwo = this.candles.slice(-2);
    if (lastTwo.length === 2) {
      this.series.price.style.line = 
        lastTwo[1].close >= lastTwo[0].close ?
          this.config.DASHBOARD.COLORS.PRICE_UP :
          this.config.DASHBOARD.COLORS.PRICE_DOWN;
    }

    // Update volume data
    this.series.volume.x = this.series.price.x;
    this.series.volume.y = this.candles.map(c => c.volume);
  }

  formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  addPosition(position) {
    // Add position marker to chart
    const marker = {
      title: position.isLong ? '📈 Long' : '📉 Short',
      x: [this.formatTime(position.timestamp)],
      y: [position.entryPrice],
      style: {
        line: position.isLong ? 
          this.config.DASHBOARD.COLORS.PRICE_UP :
          this.config.DASHBOARD.COLORS.PRICE_DOWN
      }
    };

    this.chart.setData([
      this.series.price,
      this.series.volume,
      marker
    ]);
  }

  update() {
    this.chart.setData([
      this.series.price,
      this.series.volume
    ]);
  }

  focus() {
    this.chart.focus();
  }
}

module.exports = ChartPanel;
