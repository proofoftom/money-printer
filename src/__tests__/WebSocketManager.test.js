const WebSocket = require("ws");
const WebSocketManager = require("../WebSocketManager");

jest.mock("ws");

describe("WebSocketManager", () => {
  let webSocketManager;
  let mockWs;
  let mockLogger;
  let mockConfig;
  let messageHandler;
  let errorHandler;
  let closeHandler;
  let openHandler;

  beforeEach(async () => {
    // Mock WebSocket instance
    mockWs = {
      on: jest.fn((event, handler) => {
        switch (event) {
          case "open":
            openHandler = handler;
            break;
          case "message":
            messageHandler = handler;
            break;
          case "close":
            closeHandler = handler;
            break;
          case "error":
            errorHandler = handler;
            break;
        }
      }),
      send: jest.fn(),
      close: jest.fn(),
      readyState: WebSocket.OPEN,
      removeAllListeners: jest.fn(),
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
      WS_URL: "wss://pumpportal.fun/data-api/real-time",
      MAX_RECONNECT_ATTEMPTS: 3,
      RECONNECT_INTERVAL: 1000,
      LOGGING: {
        TRADES: false,
        WEBSOCKET: false,
      },
    };

    webSocketManager = new WebSocketManager(mockConfig, mockLogger);
    jest.spyOn(webSocketManager, "emit");

    // Connect and wait for handlers to be registered
    await webSocketManager.connect();
  });

  afterEach(() => {
    jest.clearAllMocks();
    webSocketManager.close();
  });

  describe("Connection Management", () => {
    test("establishes connection successfully", () => {
      openHandler();
      expect(webSocketManager.isConnected).toBe(true);
      expect(webSocketManager.emit).toHaveBeenCalledWith("connected");
    });

    test.skip("handles connection errors", () => {
      const error = new Error("Connection failed");
      errorHandler(error);
      expect(mockLogger.error).toHaveBeenCalledWith("WebSocket error:", {
        error,
      });
    });

    test("handles connection close", () => {
      closeHandler();
      expect(webSocketManager.isConnected).toBe(false);
    });

    test("attempts reconnection on close", () => {
      jest.useFakeTimers();
      closeHandler();
      jest.advanceTimersByTime(mockConfig.RECONNECT_INTERVAL);
      expect(WebSocket).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });

    test.skip("stops reconnecting after max attempts", () => {
      jest.useFakeTimers();
      webSocketManager.reconnectAttempts = mockConfig.MAX_RECONNECT_ATTEMPTS;
      closeHandler();
      jest.advanceTimersByTime(mockConfig.RECONNECT_INTERVAL);
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Max reconnection attempts reached"
      );
      jest.useRealTimers();
    });
  });

  describe("Message Handling", () => {
    beforeEach(() => {
      openHandler();
      jest.clearAllMocks();
    });

    test("processes token creation messages", () => {
      const messageData = {
        txType: "create",
        signature: "test-sig",
        mint: "test-mint",
        traderPublicKey: "test-trader",
        initialBuy: 60735849.056603,
        bondingCurveKey: "test-curve",
        vTokensInBondingCurve: 1012264150.943397,
        vSolInBondingCurve: 31.799999999999976,
        marketCapSol: 31.414725069897433,
        name: "Test Token",
        symbol: "TEST",
      };

      messageHandler(JSON.stringify(messageData));
      expect(webSocketManager.emit).toHaveBeenCalledWith(
        "newToken",
        expect.objectContaining({
          mint: "test-mint",
          symbol: "TEST",
          marketCapSol: 31.414725069897433,
        })
      );
    });

    test("processes trade messages", () => {
      const messageData = {
        txType: "buy",
        signature: "test-sig",
        mint: "test-mint",
        traderPublicKey: "test-trader",
        tokenAmount: 94541651,
        newTokenBalance: 94541651,
        bondingCurveKey: "test-curve",
        vTokensInBondingCurve: 897446022.342982,
        vSolInBondingCurve: 35.86845247356589,
        marketCapSol: 35.5,
      };

      messageHandler(JSON.stringify(messageData));
      expect(webSocketManager.emit).toHaveBeenCalledWith(
        "tokenTrade",
        expect.objectContaining({
          txType: "buy",
          mint: "test-mint",
          tokenAmount: 94541651,
        })
      );
    });

    test("silently logs invalid JSON messages", () => {
      messageHandler("invalid json");
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to parse WebSocket message",
        {
          data: "invalid json",
          error: "Unexpected token 'i', \"invalid json\" is not valid JSON",
        }
      );
      expect(webSocketManager.emit).not.toHaveBeenCalled();
    });

    test("handles messages with missing required fields", () => {
      const messageData = {
        txType: "create",
        // Missing mint and symbol
      };

      messageHandler(JSON.stringify(messageData));
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Invalid token creation message",
        expect.any(Object)
      );
      expect(webSocketManager.emit).not.toHaveBeenCalled();
    });
  });

  describe("Subscription Management", () => {
    beforeEach(() => {
      openHandler();
    });

    test("subscribes to new tokens", () => {
      webSocketManager.subscribeToNewTokens();
      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          method: "subscribeNewToken",
        })
      );
    });

    test("subscribes to token trades", () => {
      webSocketManager.subscribeToToken("test-mint");
      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          method: "subscribeTokenTrade",
          keys: ["test-mint"],
        })
      );
    });

    test("unsubscribes from token trades", () => {
      webSocketManager.subscribeToToken("test-mint");
      webSocketManager.unsubscribeFromToken("test-mint");
      expect(mockWs.send).toHaveBeenLastCalledWith(
        JSON.stringify({
          method: "unsubscribeTokenTrade",
          keys: ["test-mint"],
        })
      );
    });

    test("resubscribes to all tokens after reconnect", () => {
      webSocketManager.subscribeToNewTokens();
      webSocketManager.subscribeToToken("test-mint");

      // Simulate disconnect and reconnect
      closeHandler();
      jest.advanceTimersByTime(mockConfig.RECONNECT_INTERVAL);
      openHandler();

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          method: "subscribeNewToken",
        })
      );
      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          method: "subscribeTokenTrade",
          keys: ["test-mint"],
        })
      );
    });
  });
});
