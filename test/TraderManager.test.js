const { expect } = require('chai');
const sinon = require('sinon');
const TraderManager = require('../src/TraderManager');

describe('TraderManager', () => {
  let traderManager;
  let clock;

  beforeEach(() => {
    clock = sinon.useFakeTimers(Date.now());
    traderManager = new TraderManager();
  });

  afterEach(() => {
    clock.restore();
  });

  describe('getOrCreateTrader', () => {
    it('should create new trader with firstSeen time', () => {
      const now = Date.now();
      const trader = traderManager.getOrCreateTrader('testKey', false);
      
      expect(trader.publicKey).to.equal('testKey');
      expect(trader.firstSeen).to.equal(now);
    });

    it('should emit newTrader and subscribeTrader events for new traders', () => {
      const newTraderSpy = sinon.spy();
      const subscribeSpy = sinon.spy();
      
      traderManager.on('newTrader', newTraderSpy);
      traderManager.on('subscribeTrader', subscribeSpy);
      
      const trader = traderManager.getOrCreateTrader('testKey', false);
      
      expect(newTraderSpy.calledOnce).to.be.true;
      expect(subscribeSpy.calledOnce).to.be.true;
      expect(subscribeSpy.firstCall.args[0]).to.deep.equal({ publicKey: 'testKey' });
    });

    it('should not emit events for existing traders', () => {
      // First call to create trader
      traderManager.getOrCreateTrader('testKey', false);
      
      const newTraderSpy = sinon.spy();
      const subscribeSpy = sinon.spy();
      
      traderManager.on('newTrader', newTraderSpy);
      traderManager.on('subscribeTrader', subscribeSpy);
      
      // Second call should return existing trader
      const trader = traderManager.getOrCreateTrader('testKey', false);
      
      expect(newTraderSpy.called).to.be.false;
      expect(subscribeSpy.called).to.be.false;
    });
  });

  describe('trader event handling', () => {
    it('should forward trader events', () => {
      const trader = traderManager.getOrCreateTrader('testKey', false);
      const spy = sinon.spy();
      
      traderManager.on('trade', spy);
      
      const tradeData = { amount: 100, price: 1.5 };
      trader.emit('trade', tradeData);
      
      expect(spy.calledOnce).to.be.true;
      expect(spy.firstCall.args[0]).to.equal(tradeData);
    });
  });

  describe('getRepeatPumpParticipants', () => {
    it('should identify traders who participated in multiple pumps', () => {
      const now = Date.now();
      const pumpTimes = [
        now - 1000000, // 16.7 minutes ago
        now - 500000,  // 8.3 minutes ago
        now           // now
      ];
      
      // Create traders with different participation patterns
      const trader1 = traderManager.getOrCreateTrader('trader1');
      const trader2 = traderManager.getOrCreateTrader('trader2');
      const trader3 = traderManager.getOrCreateTrader('trader3');
      
      // Trader 1 participates in all pumps
      trader1.trades = [
        { timestamp: pumpTimes[0] - 60000 },
        { timestamp: pumpTimes[1] + 60000 },
        { timestamp: pumpTimes[2] }
      ];
      
      // Trader 2 participates in two pumps
      trader2.trades = [
        { timestamp: pumpTimes[0] + 60000 },
        { timestamp: pumpTimes[2] - 60000 }
      ];
      
      // Trader 3 participates in only one pump
      trader3.trades = [
        { timestamp: pumpTimes[1] }
      ];
      
      const repeatParticipants = traderManager.getRepeatPumpParticipants(pumpTimes);
      
      expect(repeatParticipants).to.have.lengthOf(2);
      expect(repeatParticipants).to.include('trader1');
      expect(repeatParticipants).to.include('trader2');
      expect(repeatParticipants).to.not.include('trader3');
    });

    it('should respect minParticipation parameter', () => {
      const now = Date.now();
      const pumpTimes = [
        now - 1000000,
        now - 500000,
        now
      ];
      
      // Create trader who participates in two pumps
      const trader = traderManager.getOrCreateTrader('trader1');
      trader.trades = [
        { timestamp: pumpTimes[0] },
        { timestamp: pumpTimes[1] }
      ];
      
      // With default minParticipation (2)
      let repeatParticipants = traderManager.getRepeatPumpParticipants(pumpTimes);
      expect(repeatParticipants).to.include('trader1');
      
      // With higher minParticipation (3)
      repeatParticipants = traderManager.getRepeatPumpParticipants(pumpTimes, 3);
      expect(repeatParticipants).to.not.include('trader1');
    });

    it('should consider trades within time window of pump', () => {
      const now = Date.now();
      const pumpTime = now - 500000;
      
      const trader = traderManager.getOrCreateTrader('trader1');
      
      // Trade just within 5-minute window
      trader.trades = [
        { timestamp: pumpTime - (4.9 * 60 * 1000) },
        { timestamp: pumpTime + (4.9 * 60 * 1000) }
      ];
      
      let repeatParticipants = traderManager.getRepeatPumpParticipants([pumpTime], 2);
      expect(repeatParticipants).to.include('trader1');
      
      // Trade just outside 5-minute window
      trader.trades = [
        { timestamp: pumpTime - (5.1 * 60 * 1000) },
        { timestamp: pumpTime + (5.1 * 60 * 1000) }
      ];
      
      repeatParticipants = traderManager.getRepeatPumpParticipants([pumpTime], 2);
      expect(repeatParticipants).to.not.include('trader1');
    });
  });
});
