// Increase max listeners to prevent warnings
require('events').EventEmitter.defaultMaxListeners = 20;

// Mock console methods to prevent CLI output during tests
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

// Mock process.stdin for keyboard input tests
process.stdin.setRawMode = jest.fn();
process.stdin.resume = jest.fn();

// Mock process.stdout for CLI rendering tests
process.stdout.write = jest.fn();
process.stdout.columns = 80;
process.stdout.rows = 24;

// Mock node-notifier
jest.mock('node-notifier', () => ({
  notify: jest.fn()
}));

// Mock WebSocket
jest.mock('ws', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    send: jest.fn(),
    close: jest.fn(),
    removeAllListeners: jest.fn()
  }));
});

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});
