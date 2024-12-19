const WebSocket = require('ws');
const WebSocketManager = require('../WebSocketManager');
const config = require('../config');

jest.mock('ws');

describe('WebSocketManager', () => {
  let wsManager;
  let mockWs;
  let mockEmit;

  beforeEach(() => {
    jest.useFakeTimers('modern');
    
    mockWs = {
      on: jest.fn(),
      removeAllListeners: jest.fn(),
      close: jest.fn()
    };
    WebSocket.mockImplementation(() => mockWs);
    
    wsManager = new WebSocketManager();
    mockEmit = jest.spyOn(wsManager, 'emit');
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Connection Management', () => {
    it('should establish WebSocket connection', async () => {
      await wsManager.connect();
      
      expect(WebSocket).toHaveBeenCalledWith(config.WS_URL);
      expect(mockWs.on).toHaveBeenCalledWith('open', expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should handle connection success', async () => {
      await wsManager.connect();
      
      // Simulate connection success
      const openHandler = mockWs.on.mock.calls.find(call => call[0] === 'open')[1];
      openHandler();
      
      expect(wsManager.isConnected).toBe(true);
      expect(wsManager.reconnectAttempts).toBe(0);
      expect(mockEmit).toHaveBeenCalledWith('connected');
    });

    it('should handle connection failure', async () => {
      const error = new Error('Connection failed');
      WebSocket.mockImplementationOnce(() => {
        throw error;
      });
      
      await wsManager.connect();
      
      expect(console.error).toHaveBeenCalledWith('Failed to connect to WebSocket:', error);
      expect(wsManager.isConnected).toBe(false);
    }, 10000);

    it('should handle reconnection attempts', async () => {
      await wsManager.connect();
      
      // Simulate connection close
      const closeHandler = mockWs.on.mock.calls.find(call => call[0] === 'close')[1];
      closeHandler();
      
      expect(wsManager.isConnected).toBe(false);
      
      // Fast-forward timers and verify reconnection attempt
      jest.advanceTimersByTime(config.RECONNECT_INTERVAL);
      expect(WebSocket).toHaveBeenCalledTimes(2);
    }, 10000);

    it('should stop reconnecting after max attempts', async () => {
      // Simulate max reconnection attempts
      for (let i = 0; i < wsManager.maxReconnectAttempts + 1; i++) {
        WebSocket.mockImplementationOnce(() => {
          throw new Error('Connection failed');
        });
        
        await wsManager.connect();
        jest.advanceTimersByTime(config.RECONNECT_INTERVAL);
      }
      
      expect(console.error).toHaveBeenCalledWith('Max reconnection attempts reached');
      expect(wsManager.reconnectAttempts).toBe(wsManager.maxReconnectAttempts);
    }, 10000);
  });

  describe('Message Handling', () => {
    it('should handle token data messages', async () => {
      await wsManager.connect();
      
      const messageHandler = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];
      const mockTokenData = {
        type: 'token',
        mint: 'TEST',
        name: 'Test Token'
      };
      
      messageHandler(JSON.stringify(mockTokenData));
      
      expect(mockEmit).toHaveBeenCalledWith('tokenData', mockTokenData);
    });

    it('should handle invalid message data', async () => {
      await wsManager.connect();
      
      const messageHandler = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];
      const invalidData = 'invalid json';
      
      messageHandler(invalidData);
      
      expect(console.error).toHaveBeenCalledWith('Failed to parse WebSocket message:', expect.any(Error));
    });
  });

  describe('Cleanup', () => {
    it('should close WebSocket connection', () => {
      wsManager.ws = mockWs;
      wsManager.isConnected = true;
      
      wsManager.close();
      
      expect(mockWs.removeAllListeners).toHaveBeenCalled();
      expect(mockWs.close).toHaveBeenCalled();
      expect(wsManager.ws).toBeNull();
      expect(wsManager.isConnected).toBe(false);
    });

    it('should handle SIGINT', () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});
      wsManager.ws = mockWs;
      
      process.emit('SIGINT');
      
      expect(mockWs.removeAllListeners).toHaveBeenCalled();
      expect(mockWs.close).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
      
      mockExit.mockRestore();
    });
  });
});
