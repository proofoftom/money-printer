const WebSocket = require("ws");
const WebSocketManager = require("../WebSocketManager");

jest.mock("ws");

describe("WebSocketManager", () => {
  let webSocketManager;
  let mockWs;
  let mockLogger;
  let mockConfig;

  beforeEach(() => {
    // Mock WebSocket instance
    mockWs = {
      on: jest.fn(),
      send: jest.fn(),
      close: jest.fn(),
      readyState: WebSocket.OPEN,
    };

    // Mock WebSocket constructor
    WebSocket.mockImplementation(() => mockWs);

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    mockConfig = {
      WS_ENDPOINT: "wss://pumpportal.fun/api/data",
      RECONNECT_INTERVAL: 1000,
    };

    webSocketManager = new WebSocketManager(mockConfig, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
    webSocketManager.close();
  });

  describe("Connection Management", () => {
    test("establishes connection and subscribes to new tokens", () => {
      webSocketManager.connect();

      // Verify WebSocket was initialized with correct URL
      expect(WebSocket).toHaveBeenCalledWith(mockConfig.WS_ENDPOINT, {
        handshakeTimeout: 10000,
        headers: {
          "User-Agent": "MoneyPrinter/1.0",
          Origin: "https://pumpportal.fun",
        },
      });

      // Get the 'open' handler and simulate connection
      const openHandler = mockWs.on.mock.calls.find(
        (call) => call[0] === "open"
      )[1];
      openHandler();

      // Verify connection state
      expect(webSocketManager.isConnected).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith("WebSocket connected");

      // Verify subscription to new tokens
      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          method: "subscribeNewToken",
        })
      );
    });

    test.skip("handles connection errors", () => {
      const error = new Error("Connection failed");
      webSocketManager.connect();

      // Get the 'error' handler and simulate error
      const errorHandler = mockWs.on.mock.calls.find(
        (call) => call[0] === "error"
      )[1];
      errorHandler(error);

      expect(mockLogger.error).toHaveBeenCalledWith("WebSocket error:", {
        error,
      });
    });

    test("attempts reconnection on close", () => {
      jest.useFakeTimers();
      webSocketManager.connect();

      // Get the 'close' handler and simulate disconnection
      const closeHandler = mockWs.on.mock.calls.find(
        (call) => call[0] === "close"
      )[1];
      closeHandler();

      expect(webSocketManager.isConnected).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith("WebSocket disconnected");

      // Advance timers and verify reconnection attempt
      jest.advanceTimersByTime(mockConfig.RECONNECT_INTERVAL);
      expect(WebSocket).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });
  });

  describe("Message Handling", () => {
    let messageHandler;
    let emitSpy;

    beforeEach(() => {
      webSocketManager.connect();
      const openHandler = mockWs.on.mock.calls.find(
        (call) => call[0] === "open"
      )[1];
      openHandler();

      messageHandler = mockWs.on.mock.calls.find(
        (call) => call[0] === "message"
      )[1];
      emitSpy = jest.spyOn(webSocketManager, "emit");
    });

    afterEach(() => {
      emitSpy.mockRestore();
    });

    test("handles new token messages", () => {
      const tokenMessage = {
        txType: "create",
        mint: "testMint123",
        symbol: "TEST",
        name: "Test Token",
        marketCapSol: 100,
        initialBuy: 1000000,
        vSolInBondingCurve: 50
      };

      // Convert message to Buffer as WebSocket would do
      messageHandler(Buffer.from(JSON.stringify(tokenMessage)));

      expect(emitSpy).toHaveBeenCalledWith("newToken", tokenMessage);
    });

    test("handles trade messages", () => {
      const tradeMessage = {
        txType: "buy",
        mint: "testMint123",
        tokenAmount: 1000
      };

      // Convert message to Buffer as WebSocket would do
      messageHandler(Buffer.from(JSON.stringify(tradeMessage)));

      expect(emitSpy).toHaveBeenCalledWith("tokenTrade", tradeMessage);
    });

    test("handles invalid JSON messages", () => {
      const messageHandler = mockWs.on.mock.calls.find(
        (call) => call[0] === "message"
      )[1];
      const invalidMessage = "invalid json{";

      messageHandler(invalidMessage);

      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to parse WebSocket message:",
        expect.any(Object)
      );
    });
  });

  describe("Token Subscriptions", () => {
    beforeEach(() => {
      webSocketManager.connect();
      const openHandler = mockWs.on.mock.calls.find(
        (call) => call[0] === "open"
      )[1];
      openHandler();
      jest.clearAllMocks();
    });

    test("subscribes to token trades", () => {
      const testMint = "testMint123";
      webSocketManager.subscribeToToken(testMint);

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          method: "subscribeTokenTrade",
          keys: [testMint],
        })
      );
      expect(webSocketManager.subscribedTokens.has(testMint)).toBe(true);
    });

    test("unsubscribes from token trades", () => {
      const testMint = "testMint123";
      webSocketManager.subscribedTokens.add(testMint);
      webSocketManager.unsubscribeFromToken(testMint);

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          method: "unsubscribeTokenTrade",
          keys: [testMint],
        })
      );
      expect(webSocketManager.subscribedTokens.has(testMint)).toBe(false);
    });

    test.skip("resubscribes to existing tokens on reconnection", () => {
      const mint = "test-mint";
      webSocketManager.connect();

      // Get the 'open' handler and simulate connection
      const openHandler = mockWs.on.mock.calls.find(
        (call) => call[0] === "open"
      )[1];
      openHandler();

      // Subscribe to a token
      webSocketManager.subscribeToToken(mint);

      // Verify subscription was sent
      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          method: "subscribeTokenTrade",
          keys: [mint],
        })
      );

      // Reset the mock to track new calls
      mockWs.send.mockClear();

      // Simulate disconnection
      const closeHandler = mockWs.on.mock.calls.find(
        (call) => call[0] === "close"
      )[1];
      closeHandler();

      // Create a new mock WebSocket for reconnection
      const mockWs2 = {
        on: jest.fn((event, handler) => {
          if (event === "open") {
            // Store the open handler for later use
            mockWs2._openHandler = handler;
          }
          return mockWs2;
        }),
        send: jest.fn(),
        close: jest.fn(),
      };
      WebSocket.mockReturnValue(mockWs2);

      // Wait for reconnection attempt
      jest.advanceTimersByTime(mockConfig.RECONNECT_INTERVAL);

      // Trigger the stored open handler
      mockWs2._openHandler();

      // Verify resubscription was sent
      expect(mockWs2.send).toHaveBeenCalledWith(
        JSON.stringify({
          method: "subscribeTokenTrade",
          keys: [mint],
        })
      );
    });
  });
});
