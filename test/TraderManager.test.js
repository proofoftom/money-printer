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
});
