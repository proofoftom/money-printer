const fs = require('fs');
const path = require('path');

class StatsLogger {
  constructor(options = {}) {
    this.maxFileSize = options.maxFileSize || 500 * 1024 * 1024; // 500 MB default
    this.logDir = options.logDir || 'logs/trading';
    this.currentLogFile = null;
    this.summaryMetrics = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalProfit: 0,
      totalLoss: 0,
      largestWin: 0,
      largestLoss: 0,
      averageHoldTime: 0,
      totalHoldTime: 0,
      averageWinHoldTime: 0,
      averageLossHoldTime: 0,
      winHoldTimes: [],
      lossHoldTimes: [],
      profitFactor: 0,
      winRate: 0,
      riskRewardRatio: 0,
      exitStats: {
        stopLoss: { count: 0, totalPnL: 0, avgHoldTime: 0 },
        trailingStop: { count: 0, totalPnL: 0, avgHoldTime: 0 },
        takeProfit: {
          tier1: { count: 0, totalPnL: 0, avgHoldTime: 0 },
          tier2: { count: 0, totalPnL: 0, avgHoldTime: 0 },
          tier3: { count: 0, totalPnL: 0, avgHoldTime: 0 }
        },
        volumeExit: { count: 0, totalPnL: 0, avgHoldTime: 0 },
        timeExit: { count: 0, totalPnL: 0, avgHoldTime: 0 }
      },
      volumeMetrics: {
        avgExitVolume: 0,
        avgPeakVolume: 0,
        avgVolumeDropPercent: 0,
        totalVolumeSamples: 0
      },
      priceMetrics: {
        avgMaxUpside: 0,
        avgDrawdown: 0,
        avgRecoveryTime: 0,
        totalPriceSamples: 0
      }
    };

    // Ensure log directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    this.rotateLogFileIfNeeded();
  }

  rotateLogFileIfNeeded() {
    const date = new Date().toISOString().split('T')[0];
    const newLogFile = path.join(this.logDir, `trading_stats_${date}.json`);

    // Create initial empty file if it doesn't exist
    if (!fs.existsSync(newLogFile)) {
      fs.mkdirSync(path.dirname(newLogFile), { recursive: true });
      fs.writeFileSync(newLogFile, JSON.stringify({
        trades: [],
        marketConditions: [],
        summary: this.summaryMetrics
      }, null, 2));
    }

    // Check if we need to rotate due to size
    if (this.currentLogFile === newLogFile) {
      const stats = fs.statSync(newLogFile);
      if (stats.size >= this.maxFileSize) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const archiveFile = path.join(this.logDir, `trading_stats_${date}_${timestamp}.json`);
        fs.renameSync(newLogFile, archiveFile);
        fs.writeFileSync(newLogFile, JSON.stringify({
          trades: [],
          marketConditions: [],
          summary: this.summaryMetrics
        }, null, 2));
      }
    }

    // Clean up old log files if total size exceeds limit
    this.cleanupOldLogs();
    this.currentLogFile = newLogFile;
  }

  cleanupOldLogs() {
    const files = fs.readdirSync(this.logDir)
      .filter(file => file.startsWith('trading_stats_'))
      .map(file => ({
        name: file,
        path: path.join(this.logDir, file),
        stats: fs.statSync(path.join(this.logDir, file))
      }))
      .sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime());

    let totalSize = 0;
    for (const file of files) {
      totalSize += file.stats.size;
      if (totalSize > this.maxFileSize) {
        fs.unlinkSync(file.path);
      }
    }
  }

  updateSummaryMetrics(stats) {
    if (stats.type !== 'POSITION_CLOSE') return;

    this.summaryMetrics.totalTrades++;
    
    const profit = stats.profitLoss;
    const holdTime = stats.holdTimeSeconds || 0;
    
    if (profit > 0) {
      this.summaryMetrics.winningTrades++;
      this.summaryMetrics.totalProfit += profit;
      this.summaryMetrics.largestWin = Math.max(this.summaryMetrics.largestWin, profit);
      this.summaryMetrics.winHoldTimes.push(holdTime);
    } else {
      this.summaryMetrics.losingTrades++;
      this.summaryMetrics.totalLoss += Math.abs(profit);
      this.summaryMetrics.largestLoss = Math.min(this.summaryMetrics.largestLoss, profit);
      this.summaryMetrics.lossHoldTimes.push(holdTime);
    }

    this.summaryMetrics.totalHoldTime += holdTime;
    this.summaryMetrics.averageHoldTime = this.summaryMetrics.totalHoldTime / this.summaryMetrics.totalTrades;
    
    if (this.summaryMetrics.winHoldTimes.length > 0) {
      this.summaryMetrics.averageWinHoldTime = this.summaryMetrics.winHoldTimes.reduce((a, b) => a + b, 0) / this.summaryMetrics.winHoldTimes.length;
    }
    
    if (this.summaryMetrics.lossHoldTimes.length > 0) {
      this.summaryMetrics.averageLossHoldTime = this.summaryMetrics.lossHoldTimes.reduce((a, b) => a + b, 0) / this.summaryMetrics.lossHoldTimes.length;
    }

    this.summaryMetrics.winRate = (this.summaryMetrics.winningTrades / this.summaryMetrics.totalTrades) * 100;
    this.summaryMetrics.profitFactor = this.summaryMetrics.totalLoss > 0 ? 
      this.summaryMetrics.totalProfit / this.summaryMetrics.totalLoss : 
      this.summaryMetrics.totalProfit;
    
    this.summaryMetrics.riskRewardRatio = Math.abs(this.summaryMetrics.largestWin / this.summaryMetrics.largestLoss);

    // Update exit stats
    if (stats.exitReason) {
      const [exitType, subType] = stats.exitReason.split('_');
      if (this.summaryMetrics.exitStats[exitType]) {
        if (subType && this.summaryMetrics.exitStats[exitType][subType]) {
          const exitStats = this.summaryMetrics.exitStats[exitType][subType];
          exitStats.count++;
          exitStats.totalPnL += profit;
          exitStats.avgHoldTime = (exitStats.avgHoldTime * (exitStats.count - 1) + holdTime) / exitStats.count;
        } else {
          const exitStats = this.summaryMetrics.exitStats[exitType];
          exitStats.count++;
          exitStats.totalPnL += profit;
          exitStats.avgHoldTime = (exitStats.avgHoldTime * (exitStats.count - 1) + holdTime) / exitStats.count;
        }
      }
    }
  }

  getSummaryMetrics() {
    return {
      totalTrades: this.summaryMetrics.totalTrades,
      winningTrades: this.summaryMetrics.winningTrades,
      losingTrades: this.summaryMetrics.losingTrades,
      totalProfit: this.summaryMetrics.totalProfit,
      totalLoss: this.summaryMetrics.totalLoss,
      largestWin: this.summaryMetrics.largestWin,
      largestLoss: this.summaryMetrics.largestLoss,
      averageHoldTime: this.summaryMetrics.averageHoldTime,
      averageWinHoldTime: this.summaryMetrics.averageWinHoldTime,
      averageLossHoldTime: this.summaryMetrics.averageLossHoldTime,
      winRate: this.summaryMetrics.winRate,
      profitFactor: this.summaryMetrics.profitFactor,
      riskRewardRatio: this.summaryMetrics.riskRewardRatio,
      exitStats: this.summaryMetrics.exitStats,
      volumeMetrics: this.summaryMetrics.volumeMetrics,
      priceMetrics: this.summaryMetrics.priceMetrics
    };
  }

  logStats(stats) {
    try {
      this.rotateLogFileIfNeeded();

      const currentData = JSON.parse(fs.readFileSync(this.currentLogFile, 'utf8'));
      
      const statWithTimestamp = {
        ...stats,
        timestamp: new Date().toISOString()
      };

      if (stats.type === 'POSITION_UPDATE') {
        const marketCondition = {
          timestamp: statWithTimestamp.timestamp,
          mint: stats.mint,
          price: stats.currentPrice,
          volume: stats.volumeData,
          volatility: this.calculateVolatility(stats.candleHistory),
          momentum: this.calculateMomentum(stats.candleHistory),
          marketTrend: this.identifyTrend(stats.candleHistory),
          volumeProfile: this.analyzeVolumeProfile(stats.volumeHistory),
          priceAction: {
            swingHigh: stats.highestPrice,
            swingLow: stats.lowestPrice,
            currentDrawdown: stats.maxDrawdown,
            currentUpside: stats.maxUpside
          }
        };
        currentData.marketConditions.push(marketCondition);
      }

      if (['POSITION_OPEN', 'POSITION_CLOSE', 'PARTIAL_CLOSE'].includes(stats.type)) {
        const tradeMetrics = {
          ...statWithTimestamp,
          riskRewardRatio: stats.type === 'POSITION_OPEN' ? 
            this.calculateInitialRiskReward(stats) : 
            this.calculateActualRiskReward(stats),
          marketConditions: this.getRecentMarketConditions(stats.mint),
          performanceMetrics: {
            returnOnRisk: this.calculateReturnOnRisk(stats),
            sharpeRatio: this.calculateSharpeRatio(stats),
            maxDrawdown: stats.maxDrawdown,
            timeToMaxDrawdown: this.calculateTimeToMaxDrawdown(stats),
            recoveryTime: this.calculateRecoveryTime(stats)
          }
        };
        currentData.trades.push(tradeMetrics);
      }

      // Update exit strategy metrics
      if (stats.type === 'POSITION_CLOSE' || stats.type === 'PARTIAL_CLOSE') {
        const exitType = stats.exitReason || 'unknown';
        const holdTime = stats.holdTimeSeconds;
        const pnl = stats.profitLoss;

        if (this.summaryMetrics.exitStats[exitType]) {
          const exitStats = this.summaryMetrics.exitStats[exitType];
          exitStats.count++;
          exitStats.totalPnL += pnl;
          exitStats.avgHoldTime = (exitStats.avgHoldTime * (exitStats.count - 1) + holdTime) / exitStats.count;
        }

        // Update volume metrics if available
        if (stats.volumeHistory && stats.volumeHistory.length > 0) {
          const volumeMetrics = this.summaryMetrics.volumeMetrics;
          const peakVolume = Math.max(...stats.volumeHistory.map(v => v.volume));
          const exitVolume = stats.volumeHistory[stats.volumeHistory.length - 1].volume;
          const volumeDropPercent = ((peakVolume - exitVolume) / peakVolume) * 100;

          volumeMetrics.totalVolumeSamples++;
          volumeMetrics.avgExitVolume = (volumeMetrics.avgExitVolume * (volumeMetrics.totalVolumeSamples - 1) + exitVolume) / volumeMetrics.totalVolumeSamples;
          volumeMetrics.avgPeakVolume = (volumeMetrics.avgPeakVolume * (volumeMetrics.totalVolumeSamples - 1) + peakVolume) / volumeMetrics.totalVolumeSamples;
          volumeMetrics.avgVolumeDropPercent = (volumeMetrics.avgVolumeDropPercent * (volumeMetrics.totalVolumeSamples - 1) + volumeDropPercent) / volumeMetrics.totalVolumeSamples;
        }

        // Update price metrics
        if (stats.maxUpside !== undefined && stats.maxDrawdown !== undefined) {
          const priceMetrics = this.summaryMetrics.priceMetrics;
          priceMetrics.totalPriceSamples++;
          priceMetrics.avgMaxUpside = (priceMetrics.avgMaxUpside * (priceMetrics.totalPriceSamples - 1) + stats.maxUpside) / priceMetrics.totalPriceSamples;
          priceMetrics.avgDrawdown = (priceMetrics.avgDrawdown * (priceMetrics.totalPriceSamples - 1) + stats.maxDrawdown) / priceMetrics.totalPriceSamples;
        }
      }

      this.updateSummaryMetrics(stats);
      currentData.summary = this.summaryMetrics;

      fs.writeFileSync(this.currentLogFile, JSON.stringify(currentData, null, 2));
      return true;
    } catch (error) {
      console.error('Error logging stats:', error);
      return false;
    }
  }

  calculateVolatility(candleHistory) {
    if (!candleHistory || candleHistory.length < 2) return 0;
    const returns = [];
    for (let i = 1; i < candleHistory.length; i++) {
      const returnVal = (candleHistory[i].close - candleHistory[i-1].close) / candleHistory[i-1].close;
      returns.push(returnVal);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }

  calculateMomentum(candleHistory) {
    if (!candleHistory || candleHistory.length < 2) return 0;
    const prices = candleHistory.map(candle => candle.close);
    const momentum = prices[prices.length - 1] - prices[0];
    return momentum;
  }

  identifyTrend(candleHistory) {
    if (!candleHistory || candleHistory.length < 10) return 'NEUTRAL';
    const prices = candleHistory.map(candle => candle.close);
    const sma5 = this.calculateSMA(prices, 5);
    const sma10 = this.calculateSMA(prices, 10);
    if (sma5 > sma10) return 'UPTREND';
    if (sma5 < sma10) return 'DOWNTREND';
    return 'NEUTRAL';
  }

  calculateSMA(prices, period) {
    if (prices.length < period) return null;
    const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
  }

  analyzeVolumeProfile(volumeHistory) {
    if (!volumeHistory || volumeHistory.length === 0) return null;
    const volumes = volumeHistory.map(v => v.volume);
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const maxVolume = Math.max(...volumes);
    const minVolume = Math.min(...volumes);
    return {
      average: avgVolume,
      max: maxVolume,
      min: minVolume,
      trend: volumes[volumes.length - 1] > avgVolume ? 'INCREASING' : 'DECREASING'
    };
  }

  calculateInitialRiskReward(stats) {
    return null;
  }

  calculateActualRiskReward(stats) {
    if (!stats.profitLoss || !stats.maxDrawdown) return null;
    return Math.abs(stats.profitLoss / (stats.maxDrawdown * stats.size));
  }

  calculateReturnOnRisk(stats) {
    if (!stats.profitLoss || !stats.maxDrawdown || !stats.size) return null;
    return (stats.profitLoss / (stats.maxDrawdown * stats.size)) * 100;
  }

  calculateSharpeRatio(stats) {
    return null;
  }

  calculateTimeToMaxDrawdown(stats) {
    return null;
  }

  calculateRecoveryTime(stats) {
    return null;
  }

  getRecentMarketConditions(mint, lookback = 10) {
    try {
      const currentData = JSON.parse(fs.readFileSync(this.currentLogFile, 'utf8'));
      return currentData.marketConditions
        .filter(condition => condition.mint === mint)
        .slice(-lookback);
    } catch (error) {
      return [];
    }
  }

  getStats(options = {}) {
    try {
      const { startDate, endDate, mint, metrics = ['trades', 'summary'] } = options;
      const currentData = JSON.parse(fs.readFileSync(this.currentLogFile, 'utf8'));
      
      const filteredData = {};
      
      if (metrics.includes('trades')) {
        filteredData.trades = currentData.trades.filter(trade => {
          let include = true;
          if (startDate) {
            include = include && new Date(trade.timestamp) >= new Date(startDate);
          }
          if (endDate) {
            include = include && new Date(trade.timestamp) <= new Date(endDate);
          }
          if (mint) {
            include = include && trade.mint === mint;
          }
          return include;
        });
      }

      if (metrics.includes('marketConditions')) {
        filteredData.marketConditions = currentData.marketConditions.filter(condition => {
          let include = true;
          if (startDate) {
            include = include && new Date(condition.timestamp) >= new Date(startDate);
          }
          if (endDate) {
            include = include && new Date(condition.timestamp) <= new Date(endDate);
          }
          if (mint) {
            include = include && condition.mint === mint;
          }
          return include;
        });
      }

      if (metrics.includes('summary')) {
        filteredData.summary = currentData.summary;
      }

      return filteredData;
    } catch (error) {
      console.error('Error reading stats:', error);
      return {};
    }
  }

  generateStrategyReport(options = {}) {
    const stats = this.getStats(options);
    return {
      performance: {
        winRate: this.summaryMetrics.winRate,
        profitFactor: this.summaryMetrics.profitFactor,
        averageHoldTime: this.summaryMetrics.averageHoldTime,
        riskRewardRatio: this.summaryMetrics.riskRewardRatio
      },
      timing: {
        averageWinHoldTime: this.summaryMetrics.averageWinHoldTime,
        averageLossHoldTime: this.summaryMetrics.averageLossHoldTime,
        bestTradingPeriods: this.analyzeTradingPeriods(stats.trades)
      },
      patterns: {
        successfulSetups: this.analyzeSuccessfulSetups(stats.trades),
        failedSetups: this.analyzeFailedSetups(stats.trades),
        marketConditionCorrelation: this.analyzeMarketConditionCorrelation(stats)
      },
      riskManagement: {
        maxDrawdown: Math.max(...stats.trades.map(t => t.maxDrawdown || 0)),
        averageRiskRewardRatio: this.calculateAverageRiskReward(stats.trades),
        positionSizing: this.analyzePositionSizing(stats.trades)
      }
    };
  }

  analyzeTradingPeriods(trades) {
    return null;
  }

  analyzeSuccessfulSetups(trades) {
    return null;
  }

  analyzeFailedSetups(trades) {
    return null;
  }

  analyzeMarketConditionCorrelation(stats) {
    return null;
  }

  calculateAverageRiskReward(trades) {
    const validRatios = trades
      .map(t => this.calculateActualRiskReward(t))
      .filter(r => r !== null);
    if (validRatios.length === 0) return null;
    return validRatios.reduce((a, b) => a + b, 0) / validRatios.length;
  }

  analyzePositionSizing(trades) {
    return null;
  }
}

module.exports = StatsLogger;
