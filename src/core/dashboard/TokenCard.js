const blessed = require('blessed');
const contrib = require('blessed-contrib');

class TokenCard {
  constructor(parent, token, traderManager) {
    this.token = token;
    this.traderManager = traderManager;
    this.metrics = {
      marketCap: 0,
      holders: 0,
      top10Concentration: 0,
      devHoldings: 0,
      volume: {
        '1m': 0,
        '5m': 0,
        '30m': 0
      },
      transactions: 0
    };

    // Create the card box
    this.box = blessed.box({
      parent: parent,
      tags: true,
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'white'
        }
      }
    });

    // Initialize metrics display
    this.metricsBox = blessed.box({
      parent: this.box,
      tags: true,
      content: this.formatMetrics()
    });

    // Set up event listeners
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Listen for token updates
    this.token.on('trade', this.handleTrade.bind(this));
    this.token.on('metricsUpdated', this.handleMetricsUpdate.bind(this));
    
    // Listen for trader group updates
    this.traderManager.on('highConcentration', ({ mint, concentration }) => {
      if (mint === this.token.mint) {
        this.updateConcentrationStyle(concentration);
      }
    });
  }

  handleTrade(tradeData) {
    // Update volume metrics
    const now = Date.now();
    const trade = tradeData.trade;
    
    // Update volumes
    this.updateVolume(trade);
    
    // Update transaction count
    this.metrics.transactions++;
    
    // Refresh display
    this.refresh();
  }

  handleMetricsUpdate(metrics) {
    // Update token metrics
    this.metrics.marketCap = metrics.marketCap;
    this.metrics.holders = metrics.holders;
    this.metrics.devHoldings = metrics.devHoldings;
    
    // Refresh display
    this.refresh();
  }

  updateVolume(trade) {
    const now = Date.now();
    const volume = trade.amount * trade.price;
    
    // Update time-windowed volumes
    if (now - trade.timestamp <= 60 * 1000) { // 1m
      this.metrics.volume['1m'] += volume;
    }
    if (now - trade.timestamp <= 5 * 60 * 1000) { // 5m
      this.metrics.volume['5m'] += volume;
    }
    if (now - trade.timestamp <= 30 * 60 * 1000) { // 30m
      this.metrics.volume['30m'] += volume;
    }
  }

  updateConcentrationStyle(concentration) {
    // Calculate background color based on concentration
    const intensity = Math.min(Math.floor(concentration * 255), 255);
    const bg = `#${intensity.toString(16).padStart(2, '0')}0000`; // Red gradient
    
    this.box.style.bg = bg;
    this.refresh();
  }

  formatMetrics() {
    const formatNumber = (num) => {
      if (num >= 1000000) return `${(num/1000000).toFixed(1)}M`;
      if (num >= 1000) return `${(num/1000).toFixed(1)}k`;
      return num.toFixed(2);
    };

    const formatTrend = (current, previous) => {
      if (!previous) return '';
      const change = ((current - previous) / previous) * 100;
      if (change > 0) return '{green-fg}↑{/}';
      if (change < 0) return '{red-fg}↓{/}';
      return '';
    };

    return `${this.token.symbol}  MC: $${formatNumber(this.metrics.marketCap)} | H: ${formatNumber(this.metrics.holders)} | T10: ${this.metrics.top10Concentration.toFixed(1)}% | D: ${this.metrics.devHoldings.toFixed(2)}%
AGE      V: ${formatNumber(this.metrics.volume['1m'])} | 5m ${formatNumber(this.metrics.volume['5m'])} | 30m ${formatNumber(this.metrics.volume['30m'])} | Txs: ${this.metrics.transactions}`;
  }

  refresh() {
    this.metricsBox.setContent(this.formatMetrics());
    this.box.screen.render();
  }

  setPosition(top, left, width, height) {
    this.box.position.top = top;
    this.box.position.left = left;
    this.box.width = width;
    this.box.height = height;
  }

  focus() {
    this.box.style.border.fg = 'yellow';
    this.refresh();
  }

  blur() {
    this.box.style.border.fg = 'white';
    this.refresh();
  }

  destroy() {
    this.box.destroy();
  }

  cleanup() {
    try {
      // Remove all event listeners
      this.token.removeListener('trade', this.handleTrade);
      this.token.removeListener('metricsUpdated', this.handleMetricsUpdate);
      
      // Remove the box from its parent
      if (this.box && this.box.parent) {
        this.box.parent.remove(this.box);
      }
      
      // Clear references
      this.box = null;
      this.metricsBox = null;
      this.token = null;
      this.traderManager = null;
      this.metrics = null;
    } catch (error) {
      console.error('Error cleaning up TokenCard:', error);
    }
  }
}

module.exports = TokenCard;
