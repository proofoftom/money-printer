const blessed = require("blessed");
const contrib = require("blessed-contrib");
const EventEmitter = require("events");
const chalk = require("chalk");

class Dashboard extends EventEmitter {
  constructor(moneyPrinter) {
    super();
    this.moneyPrinter = moneyPrinter;
    this.setupScreen();
    this.setupLayout();
    this.setupKeybindings();
    this.setupUpdates();
  }

  setupScreen() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: "💸 Money Printer Dashboard",
      cursor: {
        artificial: true,
        shape: "line",
        blink: true,
        color: null,
      },
    });
  }

  setupLayout() {
    // Create layout grid
    this.grid = new contrib.grid({
      rows: 12,
      cols: 14,
      screen: this.screen,
    });

    // Top Row (0-2)
    this.activePositions = this.grid.set(0, 0, 2, 4, contrib.table, {
      label: " Active Positions ",
      keys: true,
      fg: "white",
      selectedFg: "white",
      selectedBg: "blue",
      interactive: false,
      columnSpacing: 2,
      columnWidth: [8, 10, 10, 8, 8, 10, 10, 10],
    });

    this.tradeHistory = this.grid.set(0, 4, 2, 4, contrib.table, {
      label: " Trade History ",
      keys: true,
      fg: "white",
      selectedFg: "white",
      selectedBg: "blue",
      interactive: false,
      columnSpacing: 2,
      columnWidth: [8, 8, 8, 8, 12],
    });

    this.controlsBox = this.grid.set(0, 8, 2, 4, blessed.box, {
      label: " Controls ",
      tags: true,
      border: { type: "line" },
      style: { border: { fg: "yellow" } },
      content:
        "q: Quit\n↑/↓: Navigate\nenter: Select\ns: Stop Bot\nr: Resume Bot",
    });

    // Token Swim Lanes (Rest of Screen)
    this.newTokens = this.grid.set(2, 0, 10, 2, blessed.box, {
      label: " New ",
      tags: true,
      border: { type: "line" },
      style: { border: { fg: "white" } },
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
      alwaysScroll: true,
      scrollbar: {
        ch: " ",
        inverse: true,
      },
    });

    this.pumpingTokens = this.grid.set(2, 2, 10, 2, blessed.box, {
      label: " Pumping ",
      tags: true,
      border: { type: "line" },
      style: { border: { fg: "green" } },
    });

    this.pumpedTokens = this.grid.set(2, 4, 10, 2, blessed.box, {
      // New box for PUMPED tokens
      label: " Pumped ",
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
      alwaysScroll: true,
      scrollbar: {
        ch: " ",
        inverse: true,
      },
    });

    this.dippingTokens = this.grid.set(2, 6, 10, 2, blessed.box, {
      label: " Dipping ",
      tags: true,
      border: { type: "line" },
      style: { border: { fg: "red" } },
    });

    this.recoveringTokens = this.grid.set(2, 8, 10, 2, blessed.box, {
      label: " Recovering ",
      tags: true,
      border: { type: "line" },
      style: { border: { fg: "blue" } },
    });

    this.readyTokens = this.grid.set(2, 10, 10, 2, blessed.box, {
      label: " Ready ",
      tags: true,
      border: { type: "line" },
      style: { border: { fg: "yellow" } },
    });

    this.deadTokens = this.grid.set(2, 12, 10, 2, blessed.box, {
      label: " Pumped/Dead ",
      tags: true,
      border: { type: "line" },
      style: { border: { fg: "gray" } },
    });
  }

  setupKeybindings() {
    this.screen.key(["escape", "q", "C-c"], () => process.exit(0));
    this.screen.key(["s"], () => this.moneyPrinter.stop());
    this.screen.key(["r"], () => this.moneyPrinter.start());
  }

  setupUpdates() {
    // Existing update interval
    setInterval(() => {
      this.render();
    }, 1000);

    // Add position event listeners
    if (this.moneyPrinter?.positionManager) {
      this.moneyPrinter.positionManager.on(
        "positionOpened",
        ({ position, token }) => {
          this.logger?.info(`Position opened for ${token.symbol}`);
          this.render(); // Force immediate update
        }
      );

      this.moneyPrinter.positionManager.on(
        "positionClosed",
        ({ position, token }) => {
          this.logger?.info(`Position closed for ${token.symbol}`);
          this.render(); // Force immediate update
        }
      );
    }
  }

  updateTokenStates() {
    try {
      if (!this.moneyPrinter?.tokenTracker?.tokens) {
        return;
      }
      const tokens = Array.from(
        this.moneyPrinter?.tokenTracker?.tokens.values()
      );

      const formatToken = (token) => {
        const marketCapUSD =
          token.marketCapSol *
          (this.moneyPrinter.priceManager?.solPriceUSD || 0);
        const mcap = this.formatUSD(marketCapUSD);
        const age = Math.floor((Date.now() - token.createdAt) / 1000) + "s";
        const holdersCount = token.holders?.size || 0;
        const tokenPrice =
          token.currentPrice *
          (this.moneyPrinter.priceManager?.solPriceUSD || 0);

        // Get the most recent candles for volume calculation
        const secondlyCandles = token.ohlcvData?.secondly || [];
        const fiveSecondCandles = token.ohlcvData?.fiveSeconds || [];
        const thirtySecondCandles = token.ohlcvData?.thirtySeconds || [];

        // Use the last candle's volume for each timeframe (they now contain delta volumes)
        const lastSecondVolume =
          secondlyCandles[secondlyCandles.length - 1]?.volume || 0;
        const lastFiveSecondVolume =
          fiveSecondCandles[fiveSecondCandles.length - 1]?.volume || 0;
        const lastThirtySecondVolume =
          thirtySecondCandles[thirtySecondCandles.length - 1]?.volume || 0;

        // Convert to USD
        const volume1s = lastSecondVolume * tokenPrice;
        const volume5s = lastFiveSecondVolume * tokenPrice;
        const volume30s = lastThirtySecondVolume * tokenPrice;

        return `${token.symbol}   ${age} | MC: ${mcap} | H:${holdersCount}
VOL    1s:${this.formatUSD(volume1s)} | 5s:${this.formatUSD(
          volume5s
        )} | 30s:${this.formatUSD(volume30s)}`;
      };

      // Filter tokens by their states
      const newTokens = tokens
        .filter((t) => t.state === "NEW")
        .sort((a, b) => {
          const aVolume =
            (a.ohlcvData?.thirtySeconds[a.ohlcvData.thirtySeconds.length - 1]
              ?.volume || 0) *
            (a.currentPrice *
              (this.moneyPrinter.priceManager?.solPriceUSD || 0));
          const bVolume =
            (b.ohlcvData?.thirtySeconds[b.ohlcvData.thirtySeconds.length - 1]
              ?.volume || 0) *
            (b.currentPrice *
              (this.moneyPrinter.priceManager?.solPriceUSD || 0));
          return bVolume - aVolume;
        });

      const pumpingTokens = tokens
        .filter((t) => t.state === "PUMPING")
        .sort((a, b) => {
          const aVolume =
            (a.ohlcvData?.thirtySeconds[a.ohlcvData.thirtySeconds.length - 1]
              ?.volume || 0) *
            (a.currentPrice *
              (this.moneyPrinter.priceManager?.solPriceUSD || 0));
          const bVolume =
            (b.ohlcvData?.thirtySeconds[b.ohlcvData.thirtySeconds.length - 1]
              ?.volume || 0) *
            (b.currentPrice *
              (this.moneyPrinter.priceManager?.solPriceUSD || 0));
          return bVolume - aVolume;
        });

      const pumpedTokens = tokens
        .filter((t) => t.state === "PUMPED")
        .sort((a, b) => {
          const aVolume =
            (a.ohlcvData?.thirtySeconds[a.ohlcvData.thirtySeconds.length - 1]
              ?.volume || 0) *
            (a.currentPrice *
              (this.moneyPrinter.priceManager?.solPriceUSD || 0));
          const bVolume =
            (b.ohlcvData?.thirtySeconds[b.ohlcvData.thirtySeconds.length - 1]
              ?.volume || 0) *
            (b.currentPrice *
              (this.moneyPrinter.priceManager?.solPriceUSD || 0));
          return bVolume - aVolume;
        });

      const dippingTokens = tokens
        .filter((t) => t.state === "DIPPING")
        .sort((a, b) => {
          const aVolume =
            (a.ohlcvData?.thirtySeconds[a.ohlcvData.thirtySeconds.length - 1]
              ?.volume || 0) *
            (a.currentPrice *
              (this.moneyPrinter.priceManager?.solPriceUSD || 0));
          const bVolume =
            (b.ohlcvData?.thirtySeconds[b.ohlcvData.thirtySeconds.length - 1]
              ?.volume || 0) *
            (b.currentPrice *
              (this.moneyPrinter.priceManager?.solPriceUSD || 0));
          return bVolume - aVolume;
        });

      const recoveringTokens = tokens
        .filter((t) => t.state === "RECOVERING")
        .sort((a, b) => {
          const aVolume =
            (a.ohlcvData?.thirtySeconds[a.ohlcvData.thirtySeconds.length - 1]
              ?.volume || 0) *
            (a.currentPrice *
              (this.moneyPrinter.priceManager?.solPriceUSD || 0));
          const bVolume =
            (b.ohlcvData?.thirtySeconds[b.ohlcvData.thirtySeconds.length - 1]
              ?.volume || 0) *
            (b.currentPrice *
              (this.moneyPrinter.priceManager?.solPriceUSD || 0));
          return bVolume - aVolume;
        });

      const readyTokens = tokens
        .filter((t) => t.state === "READY")
        .sort((a, b) => {
          const aVolume =
            (a.ohlcvData?.thirtySeconds[a.ohlcvData.thirtySeconds.length - 1]
              ?.volume || 0) *
            (a.currentPrice *
              (this.moneyPrinter.priceManager?.solPriceUSD || 0));
          const bVolume =
            (b.ohlcvData?.thirtySeconds[b.ohlcvData.thirtySeconds.length - 1]
              ?.volume || 0) *
            (b.currentPrice *
              (this.moneyPrinter.priceManager?.solPriceUSD || 0));
          return bVolume - aVolume;
        });

      const deadTokens = tokens
        .filter(
          (t) =>
            t.state === "PUMPED" || t.state === "DEAD" || t.state === "UNSAFE"
        )
        .sort((a, b) => {
          const aVolume =
            (a.ohlcvData?.thirtySeconds[a.ohlcvData.thirtySeconds.length - 1]
              ?.volume || 0) *
            (a.currentPrice *
              (this.moneyPrinter.priceManager?.solPriceUSD || 0));
          const bVolume =
            (b.ohlcvData?.thirtySeconds[b.ohlcvData.thirtySeconds.length - 1]
              ?.volume || 0) *
            (b.currentPrice *
              (this.moneyPrinter.priceManager?.solPriceUSD || 0));
          return bVolume - aVolume;
        });

      // Update the content of each swim lane
      this.newTokens?.setContent(
        newTokens.map((t) => chalk.white(formatToken(t))).join("\n")
      );
      this.pumpingTokens?.setContent(
        pumpingTokens.map((t) => chalk.green(formatToken(t))).join("\n")
      );
      this.pumpedTokens?.setContent(
        pumpedTokens.map((t) => chalk.cyanBright(formatToken(t))).join("\n")
      );
      this.dippingTokens?.setContent(
        dippingTokens.map((t) => chalk.red(formatToken(t))).join("\n")
      );
      this.recoveringTokens?.setContent(
        recoveringTokens.map((t) => chalk.blue(formatToken(t))).join("\n")
      );
      this.readyTokens?.setContent(
        readyTokens.map((t) => chalk.yellow(formatToken(t))).join("\n")
      );
      this.deadTokens?.setContent(
        deadTokens.map((t) => chalk.gray(formatToken(t))).join("\n")
      );
    } catch (error) {
      console.error("Error updating token states:", error);
    }
  }

  updateTradeHistory() {
    try {
      if (!this.moneyPrinter?.completedTrades) {
        return;
      }
      const trades = Array.from(this.moneyPrinter.completedTrades).slice(-5);
      const data = trades.map((trade) => [
        trade.symbol,
        trade.entryPrice?.toFixed(6) || "0.000000",
        trade.exitPrice?.toFixed(6) || "0.000000",
        `${trade.pnlPercent >= 0 ? "{green-fg}" : "{red-fg}"}${(
          trade.pnlPercent || 0
        ).toFixed(2)}%{/}`,
        trade.exitTime ? new Date(trade.exitTime).toLocaleTimeString() : "N/A",
      ]);

      this.tradeHistory?.setData({
        headers: ["Token", "Entry", "Exit", "P/L %", "Time"],
        data: data,
      });
    } catch (error) {
      console.error("Error updating trade history:", error);
    }
  }

  updateActivePositions() {
    try {
      if (!this.moneyPrinter?.positionManager?.position) {
        // console.log("No active position found"); // Debug log
        this.activePositions?.setData({
          headers: [
            "Token",
            "Entry",
            "Current",
            "P/L %",
            "Size",
            "Take Profit",
            "Stop Loss",
            "Open Time",
          ],
          data: [],
        });
        return;
      }

      const position = this.moneyPrinter.positionManager.position;
      console.log(`Found position for token: ${position.mint}`); // Debug log

      const token = this.moneyPrinter.tokens?.get(position.mint);

      if (!token) {
        console.log("Token not found for mint:", position.mint); // Debug log
        return;
      }

      const unrealizedPnL = position.unrealizedPnLPercent || 0;
      const pnlColor = unrealizedPnL >= 0 ? "{green-fg}" : "{red-fg}";

      const data = [
        [
          token.symbol,
          position.entryPrice?.toFixed(6) || "0.000000",
          position.currentPrice?.toFixed(6) || "0.000000",
          `${pnlColor}${unrealizedPnL.toFixed(2)}%{/}`,
          position.size?.toFixed(2) || "0.00",
          position.takeProfitPrice?.toFixed(6) || "0.000000",
          position.stopLossPrice?.toFixed(6) || "0.000000",
          position.openTime
            ? new Date(position.openTime).toLocaleTimeString()
            : "N/A",
        ],
      ];

      this.activePositions?.setData({
        headers: [
          "Token",
          "Entry",
          "Current",
          "P/L %",
          "Size",
          "Take Profit",
          "Stop Loss",
          "Open Time",
        ],
        data: data,
      });
    } catch (error) {
      console.error("Error updating active positions:", error);
    }
  }

  formatUSD(amount) {
    if (amount >= 1000) {
      return "$" + (amount / 1000).toFixed(1) + "k";
    }
    return "$" + amount.toFixed(2);
  }

  render() {
    try {
      this.updateTokenStates();
      this.updateActivePositions();
      this.updateTradeHistory();
      this.screen.render();
    } catch (error) {
      console.error("Error rendering dashboard:", error);
    }
  }

  start() {
    this.screen.render();
  }
}

module.exports = Dashboard;
