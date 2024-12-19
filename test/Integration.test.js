const Token = require('../src/Token');
const MockPositionManager = require('./__mocks__/PositionManager');
const mockConfig = require('./__mocks__/config');
const WebSocketManager = require('../src/WebSocketManager');
const { scenarios } = require('./__fixtures__/websocket');

jest.mock('../src/config', () => mockConfig);
jest.mock('../src/PositionManager', () => MockPositionManager);

describe('Integration Tests', () => {
  let wsManager;
  let positionManager;
  let config;

  beforeEach(() => {
    config = mockConfig();
    wsManager = new WebSocketManager();
    positionManager = new MockPositionManager();
  });

  describe('End-to-End Token Sniping', () => {
    it('should successfully snipe a pumping token', async () => {
      const messages = scenarios.successfulPump('TEST123');
      const token = wsManager.tokens.get('TEST123');
      
      // Simulate WebSocket messages
      for (const msg of messages) {
        await wsManager.handleMessage({ data: JSON.stringify(msg) });
        
        // Check if we've entered a position
        if (token && token.stateManager.state === 'LAUNCHING') {
          const entered = await positionManager.enterPosition(token);
          expect(entered).toBe(true);
          expect(positionManager.positions.has(token.address)).toBe(true);
        }
      }

      // Verify final state
      expect(token.stateManager.state).toBe('PUMPING');
    });

    it('should protect capital during failed launches', async () => {
      const messages = scenarios.failedLaunch('TEST123');
      
      // Simulate WebSocket messages
      for (const msg of messages) {
        await wsManager.handleMessage({ data: JSON.stringify(msg) });
      }

      const token = wsManager.tokens.get('TEST123');
      const position = await positionManager.getPosition(token.mint);
      
      // Verify we either didn't enter or exited the position
      if (position) {
        expect(position.remainingSize).toBe(0);
      }
    });

    it('should handle multiple tokens simultaneously', async () => {
      const token1Messages = scenarios.successfulPump('TOKEN1');
      const token2Messages = scenarios.failedLaunch('TOKEN2');
      const token3Messages = scenarios.creatorDump('TOKEN3', 'creator');
      
      // Interleave messages from different tokens
      const messageQueues = [token1Messages, token2Messages, token3Messages];
      while (messageQueues.some(q => q.length > 0)) {
        for (let i = 0; i < messageQueues.length; i++) {
          if (messageQueues[i].length > 0) {
            const msg = messageQueues[i].shift();
            await wsManager.handleMessage({ data: JSON.stringify(msg) });
          }
        }
      }

      // Verify each token's final state
      const token1 = wsManager.tokens.get('TOKEN1');
      const token2 = wsManager.tokens.get('TOKEN2');
      const token3 = wsManager.tokens.get('TOKEN3');

      expect(token1.stateManager.state).toBe('PUMPING');
      expect(token2.stateManager.state).toBe('DEAD');
      expect(token3.stateManager.state).toBe('DEAD');
    });

    it('should manage positions across multiple tokens efficiently', async () => {
      const successMessages = scenarios.successfulPump('SUCCESS1');
      const failMessages = scenarios.failedLaunch('FAIL1');
      
      // Start with successful token
      for (const msg of successMessages.slice(0, 5)) {
        await wsManager.handleMessage({ data: JSON.stringify(msg) });
      }

      // Introduce failing token
      for (const msg of failMessages.slice(0, 3)) {
        await wsManager.handleMessage({ data: JSON.stringify(msg) });
      }

      // Continue successful token
      for (const msg of successMessages.slice(5)) {
        await wsManager.handleMessage({ data: JSON.stringify(msg) });
      }

      // Complete failing token
      for (const msg of failMessages.slice(3)) {
        await wsManager.handleMessage({ data: JSON.stringify(msg) });
      }

      const successToken = wsManager.tokens.get('SUCCESS1');
      const failToken = wsManager.tokens.get('FAIL1');

      // Verify position management
      const successPosition = await positionManager.getPosition('SUCCESS1');
      const failPosition = await positionManager.getPosition('FAIL1');

      expect(successPosition?.remainingSize).toBeGreaterThan(0);
      expect(failPosition?.remainingSize || 0).toBe(0);
    });
  });
});
