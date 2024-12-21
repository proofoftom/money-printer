const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');

class Analytics extends EventEmitter {
  constructor(config, logger) {
    super();
    this.config = config;
    this.logger = logger;
    this.metrics = {
      trades: {
        total: 0,
        profitable: 0,
        unprofitable: 0,
        totalProfitSol: 0,
        totalProfitUsd: 0,
        largestProfitSol: 0,
        largestLossSol: 0,
        avgTimeInPosition: 0,
        totalTimeInPosition: 0
      },
      performance: {
        pumpDetectionLatency: [], // ms between pump start and detection
        tradeExecutionLatency: [], // ms between decision and execution
        websocketLatency: [], // ms between server timestamp and local receipt
      },
      errors: {
        websocket: 0,
        trading: 0,
        system: 0
      },
      safety: {
        checksTriggered: 0,
        tradesBlocked: 0
      }
    };

    // Initialize analytics storage
    const appDir = process.cwd();
    this.analyticsDir = path.join(appDir, 'analytics');
    if (!fs.existsSync(this.analyticsDir)) {
      fs.mkdirSync(this.analyticsDir, { recursive: true });
    }

    // Load previous metrics if they exist
    this.loadMetrics();

    // Auto-save metrics periodically
    setInterval(() => this.saveMetrics(), 5 * 60 * 1000); // Every 5 minutes
  }

  trackTrade(position) {
    const profitSol = position.realizedPnLSol;
    const profitUsd = position.realizedPnLUsd;
    const timeInPosition = position.getTimeInPosition();

    this.metrics.trades.total++;
    if (profitSol > 0) {
      this.metrics.trades.profitable++;
    } else if (profitSol < 0) {
      this.metrics.trades.unprofitable++;
    }

    this.metrics.trades.totalProfitSol += profitSol;
    this.metrics.trades.totalProfitUsd += profitUsd;
    this.metrics.trades.largestProfitSol = Math.max(this.metrics.trades.largestProfitSol, profitSol);
    this.metrics.trades.largestLossSol = Math.min(this.metrics.trades.largestLossSol, profitSol);

    // Update average time in position
    this.metrics.trades.totalTimeInPosition += timeInPosition;
    this.metrics.trades.avgTimeInPosition = this.metrics.trades.totalTimeInPosition / this.metrics.trades.total;

    this.logger.info('Trade analytics updated', {
      profitSol,
      profitUsd,
      timeInPosition,
      totalTrades: this.metrics.trades.total,
      winRate: (this.metrics.trades.profitable / this.metrics.trades.total * 100).toFixed(2) + '%'
    });

    this.emit('tradeAnalytics', this.getTradeMetrics());
  }

  trackLatency(type, latencyMs) {
    switch (type) {
      case 'pumpDetection':
        this.metrics.performance.pumpDetectionLatency.push(latencyMs);
        break;
      case 'tradeExecution':
        this.metrics.performance.tradeExecutionLatency.push(latencyMs);
        break;
      case 'websocket':
        this.metrics.performance.websocketLatency.push(latencyMs);
        break;
    }

    // Keep only last 1000 measurements
    const maxMeasurements = 1000;
    Object.values(this.metrics.performance).forEach(array => {
      if (array.length > maxMeasurements) {
        array.splice(0, array.length - maxMeasurements);
      }
    });
  }

  trackError(type) {
    if (this.metrics.errors[type] !== undefined) {
      this.metrics.errors[type]++;
    } else {
      this.metrics.errors.system++;
    }
  }

  trackSafetyCheck(blocked = false) {
    this.metrics.safety.checksTriggered++;
    if (blocked) {
      this.metrics.safety.tradesBlocked++;
    }
  }

  getTradeMetrics() {
    const { trades } = this.metrics;
    return {
      total: trades.total,
      profitable: trades.profitable,
      unprofitable: trades.unprofitable,
      winRate: trades.total > 0 ? (trades.profitable / trades.total * 100).toFixed(2) + '%' : '0%',
      totalProfitSol: trades.totalProfitSol.toFixed(4),
      totalProfitUsd: trades.totalProfitUsd.toFixed(2),
      avgProfitPerTrade: trades.total > 0 ? (trades.totalProfitSol / trades.total).toFixed(4) : '0',
      largestProfitSol: trades.largestProfitSol.toFixed(4),
      largestLossSol: trades.largestLossSol.toFixed(4),
      avgTimeInPosition: (trades.avgTimeInPosition / 1000).toFixed(2) + 's'
    };
  }

  getPerformanceMetrics() {
    const calcStats = (array) => {
      if (array.length === 0) return { avg: 0, min: 0, max: 0 };
      return {
        avg: (array.reduce((a, b) => a + b, 0) / array.length).toFixed(2),
        min: Math.min(...array).toFixed(2),
        max: Math.max(...array).toFixed(2)
      };
    };

    return {
      pumpDetection: calcStats(this.metrics.performance.pumpDetectionLatency),
      tradeExecution: calcStats(this.metrics.performance.tradeExecutionLatency),
      websocket: calcStats(this.metrics.performance.websocketLatency)
    };
  }

  getErrorMetrics() {
    return { ...this.metrics.errors };
  }

  getSafetyMetrics() {
    return { ...this.metrics.safety };
  }

  getAllMetrics() {
    return {
      trades: this.getTradeMetrics(),
      performance: this.getPerformanceMetrics(),
      errors: this.getErrorMetrics(),
      safety: this.getSafetyMetrics()
    };
  }

  saveMetrics() {
    const metricsPath = path.join(this.analyticsDir, 'metrics.json');
    fs.writeFileSync(metricsPath, JSON.stringify(this.metrics, null, 2));
    this.logger.debug('Analytics metrics saved');
  }

  loadMetrics() {
    const metricsPath = path.join(this.analyticsDir, 'metrics.json');
    try {
      if (fs.existsSync(metricsPath)) {
        const savedMetrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
        this.metrics = { ...this.metrics, ...savedMetrics };
        this.logger.info('Analytics metrics loaded', {
          totalTrades: this.metrics.trades.total,
          totalProfit: this.metrics.trades.totalProfitSol.toFixed(4) + ' SOL'
        });
      }
    } catch (error) {
      this.logger.error('Failed to load analytics metrics:', error);
    }
  }
}

module.exports = Analytics;
