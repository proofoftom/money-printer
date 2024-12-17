const fs = require('fs');
const path = require('path');
const { expect } = require('chai');
const sinon = require('sinon');
const SafetyLogger = require('../src/monitoring/SafetyLogger');

describe('SafetyLogger', () => {
  let safetyLogger;
  let sandbox;
  const mockDate = '2024-12-14';
  const mockLogDir = 'test/logs/safety';
  const mockLogFile = path.join(mockLogDir, `safety_checks_${mockDate}.json`);

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

    safetyLogger = new SafetyLogger({ logDir: mockLogDir });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should create log directory if it does not exist', () => {
    expect(fs.mkdirSync.calledWith(mockLogDir, { recursive: true })).to.be.true;
  });

  it('should update metrics correctly for approved check', () => {
    const mockCheckData = {
      token: 'TEST123',
      approved: true,
      duration: 100
    };

    safetyLogger.logSafetyCheck(mockCheckData);

    expect(safetyLogger.summaryMetrics.totalChecks).to.equal(1);
    expect(safetyLogger.summaryMetrics.approvedChecks).to.equal(1);
    expect(safetyLogger.summaryMetrics.rejectedChecks).to.equal(0);
    expect(safetyLogger.summaryMetrics.avgCheckDuration).to.equal(100);
  });

  it('should update metrics correctly for rejected check', () => {
    const mockCheckData = {
      token: 'TEST123',
      approved: false,
      rejectionCategory: 'marketCap',
      rejectionReason: 'high',
      duration: 150
    };

    safetyLogger.logSafetyCheck(mockCheckData);

    expect(safetyLogger.summaryMetrics.totalChecks).to.equal(1);
    expect(safetyLogger.summaryMetrics.approvedChecks).to.equal(0);
    expect(safetyLogger.summaryMetrics.rejectedChecks).to.equal(1);
    expect(safetyLogger.summaryMetrics.rejectionsByCategory.marketCap).to.equal(1);
    expect(safetyLogger.summaryMetrics.avgCheckDuration).to.equal(150);
  });

  it('should rotate log file when size limit is reached', () => {
    fs.statSync.returns({ size: 600 * 1024 * 1024 }); // Over 500MB limit
    fs.existsSync.withArgs(mockLogFile).returns(true);

    safetyLogger.rotateLogFileIfNeeded();

    expect(fs.renameSync.called).to.be.true;
    expect(fs.writeFileSync.called).to.be.true;
  });

  it('should cleanup old logs when total size exceeds limit', () => {
    const mockFiles = [
      'safety_checks_2024-12-13.json',
      'safety_checks_2024-12-12.json'
    ];
    fs.readdirSync.returns(mockFiles);
    fs.statSync.returns({ size: 300 * 1024 * 1024, mtime: new Date() });

    safetyLogger.cleanupOldLogs();

    expect(fs.unlinkSync.called).to.be.true;
  });

  it('should return formatted metrics', () => {
    const mockCheckData = {
      token: 'TEST123',
      approved: false,
      rejectionCategory: 'marketCap',
      rejectionReason: 'high',
      duration: 150
    };

    safetyLogger.logSafetyCheck(mockCheckData);
    const metrics = safetyLogger.getSummaryMetrics();

    expect(metrics).to.have.property('totalChecks');
    expect(metrics).to.have.property('approvedChecks');
    expect(metrics).to.have.property('rejectedChecks');
    expect(metrics).to.have.property('rejectionsByCategory');
    expect(metrics).to.have.property('avgCheckDuration');
    expect(metrics.avgCheckDuration).to.equal(150);
  });
});
