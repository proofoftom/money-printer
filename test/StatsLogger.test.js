const fs = require('fs');
const path = require('path');
const { expect } = require('chai');
const sinon = require('sinon');
const StatsLogger = require('../src/monitoring/StatsLogger');

describe('StatsLogger', () => {
  let statsLogger;
  let sandbox;
  const mockDate = '2024-12-14';
  const mockLogDir = 'test/logs/trading';
  const mockLogFile = path.join(mockLogDir, `trading_stats_${mockDate}.json`);

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    
    // Mock fs methods
    sandbox.stub(fs, 'existsSync').returns(false);
    sandbox.stub(fs, 'mkdirSync');
    sandbox.stub(fs, 'statSync').returns({ size: 100 });
    sandbox.stub(fs, 'appendFileSync');
    sandbox.stub(fs, 'readdirSync').returns([]);
    sandbox.stub(fs, 'renameSync');
    sandbox.stub(fs, 'unlinkSync');
    sandbox.stub(fs, 'writeFileSync');

    // Mock path.join
    sandbox.stub(path, 'join').callsFake((...args) => args.join('/'));
    sandbox.stub(path, 'dirname').callsFake((p) => p.split('/').slice(0, -1).join('/'));

    // Mock Date
    sandbox.stub(Date.prototype, 'toISOString').returns(`${mockDate}T00:00:00.000Z`);

    // Setup fs.existsSync for specific paths
    fs.existsSync.withArgs(mockLogDir).returns(false);
    fs.existsSync.withArgs(mockLogFile).returns(false);

    statsLogger = new StatsLogger({ logDir: mockLogDir });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should create log directory if it does not exist', () => {
    expect(fs.mkdirSync.calledWith(mockLogDir, { recursive: true })).to.be.true;
  });

  it('should rotate log file when size limit is reached', () => {
    fs.statSync.returns({ size: 600 * 1024 * 1024 }); // Over 500MB limit
    fs.existsSync.withArgs(mockLogFile).returns(true);

    statsLogger.rotateLogFileIfNeeded();

    expect(fs.renameSync.called).to.be.true;
    expect(fs.writeFileSync.called).to.be.true;
  });

  it('should cleanup old logs when total size exceeds limit', () => {
    const mockFiles = [
      'trading_stats_2024-12-13.json',
      'trading_stats_2024-12-12.json'
    ];
    fs.readdirSync.returns(mockFiles);
    fs.statSync.returns({ size: 300 * 1024 * 1024, mtime: new Date() });

    statsLogger.cleanupOldLogs();

    expect(fs.unlinkSync.called).to.be.true;
  });

  it('should update metrics correctly for position close', () => {
    const mockStats = {
      type: 'POSITION_CLOSE',
      exitReason: 'takeProfit_tier1',
      profitLoss: 100,
      holdTimeSeconds: 3600,
      exitVolume: 1000
    };

    statsLogger.updateSummaryMetrics(mockStats);

    expect(statsLogger.summaryMetrics.totalTrades).to.equal(1);
    expect(statsLogger.summaryMetrics.totalProfit).to.equal(100);
    expect(statsLogger.summaryMetrics.exitStats.takeProfit.tier1.count).to.equal(1);
  });

  it('should return formatted metrics', () => {
    const mockStats = {
      type: 'POSITION_CLOSE',
      exitReason: 'takeProfit_tier1',
      profitLoss: 100,
      holdTimeSeconds: 3600,
      exitVolume: 1000
    };

    statsLogger.updateSummaryMetrics(mockStats);
    const metrics = statsLogger.getSummaryMetrics();

    expect(metrics).to.have.property('totalTrades');
    expect(metrics).to.have.property('totalProfit');
    expect(metrics).to.have.property('exitStats');
    expect(metrics.exitStats.takeProfit.tier1.count).to.equal(1);
  });
});
