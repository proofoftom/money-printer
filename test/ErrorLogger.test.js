const fs = require('fs');
const path = require('path');
const { expect } = require('chai');
const sinon = require('sinon');
const ErrorLogger = require('../src/ErrorLogger');

describe('ErrorLogger', () => {
  let errorLogger;
  let sandbox;
  const mockDate = '2024-12-14';
  const mockLogDir = 'test/logs/errors';
  const mockLogFile = path.join(mockLogDir, `errors_${mockDate}.json`);

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

    errorLogger = new ErrorLogger({ logDir: mockLogDir });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should create log directory if it does not exist', () => {
    expect(fs.mkdirSync.calledWith(mockLogDir, { recursive: true })).to.be.true;
  });

  it('should log error with correct format', () => {
    const mockError = {
      type: 'NetworkError',
      component: 'WebSocketManager',
      message: 'Connection failed',
      critical: true,
      error: new Error('Connection failed')
    };

    errorLogger.logError(mockError);

    expect(fs.appendFileSync.calledOnce).to.be.true;
    const loggedData = JSON.parse(fs.appendFileSync.firstCall.args[1]);
    expect(loggedData).to.include({
      type: 'NetworkError',
      component: 'WebSocketManager',
      message: 'Connection failed',
      critical: true,
      timestamp: mockDate + 'T00:00:00.000Z'
    });
    expect(loggedData.stack).to.include('Error: Connection failed');
  });

  it('should update error metrics correctly', () => {
    const mockError = {
      type: 'NetworkError',
      component: 'WebSocketManager',
      critical: true,
      recovered: true,
      recoveryTime: 1000
    };

    errorLogger.logError(mockError);

    expect(errorLogger.summaryMetrics.totalErrors).to.equal(1);
    expect(errorLogger.summaryMetrics.criticalErrors).to.equal(1);
    expect(errorLogger.summaryMetrics.recoveredErrors).to.equal(1);
    expect(errorLogger.summaryMetrics.errorsByType.NetworkError).to.equal(1);
    expect(errorLogger.summaryMetrics.errorsByComponent.WebSocketManager).to.equal(1);
    expect(errorLogger.summaryMetrics.avgRecoveryTime).to.equal(1000);
  });

  it('should rotate log file when size limit is reached', () => {
    fs.statSync.returns({ size: 600 * 1024 * 1024 }); // Over 500MB limit
    fs.existsSync.withArgs(mockLogFile).returns(true);
    
    errorLogger.logError({ type: 'TestError' });

    expect(fs.renameSync.calledOnce).to.be.true;
    expect(fs.writeFileSync.calledWith(mockLogFile, '')).to.be.true;
  });

  it('should provide error summary with calculated rates', () => {
    const mockError1 = { type: 'NetworkError', critical: true, recovered: true, recoveryTime: 1000 };
    const mockError2 = { type: 'NetworkError', critical: false, recovered: false };
    
    errorLogger.logError(mockError1);
    errorLogger.logError(mockError2);

    const summary = errorLogger.getErrorSummary();
    expect(summary.totalErrors).to.equal(2);
    expect(summary.criticalErrors).to.equal(1);
    expect(summary.recoveredErrors).to.equal(1);
    expect(summary.criticalErrorRate).to.equal(0.5);
    expect(summary.recoveryRate).to.equal(0.5);
  });
});
