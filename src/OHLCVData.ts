import { EventEmitter } from "events";
import {
  Candle,
  VolumeProfile,
  Pattern,
  TimeframeType,
  CacheType,
  TokenStatus,
  OHLCVDataExport,
} from "./types/OHLCVData";

export class OHLCVData extends EventEmitter {
  private candles: {
    [timeframe in TimeframeType]: Map<number, Candle>;
  };
  private status: TokenStatus;
  private cache: {
    indicators: Map<string, any>;
    volumeProfiles: Map<string, any>;
    patterns: Map<string, any>;
  };
  private tokenAddress: string;
  private priceManager: any; // We'll type this properly once we see PriceManager

  constructor(tokenAddress: string, priceManager: any) {
    super();
    this.tokenAddress = tokenAddress;
    this.priceManager = priceManager;
    this.status = "ACTIVE";
    this.candles = {
      "1s": new Map(),
      "5s": new Map(),
      "15s": new Map(),
      "30s": new Map(),
      "1m": new Map(),
    };
    this.cache = {
      indicators: new Map(),
      volumeProfiles: new Map(),
      patterns: new Map(),
    };
  }

  private createCandle(
    timestamp: number,
    tokenPrice: number,
    tokenVolume: number,
    marketCapSol: number
  ): Candle {
    const solPrice = this.priceManager.solToUSD(1);
    return {
      timestamp,
      open: {
        tokens: tokenPrice,
        sol: marketCapSol,
        usd: marketCapSol * solPrice,
      },
      high: {
        tokens: tokenPrice,
        sol: marketCapSol,
        usd: marketCapSol * solPrice,
      },
      low: {
        tokens: tokenPrice,
        sol: marketCapSol,
        usd: marketCapSol * solPrice,
      },
      close: {
        tokens: tokenPrice,
        sol: marketCapSol,
        usd: marketCapSol * solPrice,
      },
      volume: {
        tokens: tokenVolume,
        sol: marketCapSol,
        usd: marketCapSol * solPrice,
      },
      trades: 1,
      marketCap: {
        sol: marketCapSol,
        usd: marketCapSol * solPrice,
      },
    };
  }

  private updateExistingCandle(
    candle: Candle,
    tokenPrice: number,
    tokenVolume: number,
    marketCapSol: number
  ): Candle {
    const solPrice = this.priceManager.solToUSD(1);
    return {
      ...candle,
      high: {
        tokens: Math.max(candle.high.tokens, tokenPrice),
        sol: Math.max(candle.high.sol, marketCapSol),
        usd: Math.max(candle.high.usd, marketCapSol * solPrice),
      },
      low: {
        tokens: Math.min(candle.low.tokens, tokenPrice),
        sol: Math.min(candle.low.sol, marketCapSol),
        usd: Math.min(candle.low.usd, marketCapSol * solPrice),
      },
      close: {
        tokens: tokenPrice,
        sol: marketCapSol,
        usd: marketCapSol * solPrice,
      },
      volume: {
        tokens: candle.volume.tokens + tokenVolume,
        sol: candle.volume.sol + marketCapSol,
        usd: candle.volume.usd + marketCapSol * solPrice,
      },
      trades: candle.trades + 1,
      marketCap: {
        sol: marketCapSol,
        usd: marketCapSol * solPrice,
      },
    };
  }

  public updateCandle(
    tokenPrice: number,
    tokenVolume: number,
    marketCapSol: number,
    timestamp: number
  ): void {
    // Handle secondly candles first
    const secondlyTimestamp = Math.floor(timestamp / 1000) * 1000;
    let secondlyCandle = this.candles["1s"].get(secondlyTimestamp);

    if (!secondlyCandle) {
      secondlyCandle = this.createCandle(
        secondlyTimestamp,
        tokenPrice,
        tokenVolume,
        marketCapSol
      );
      this.candles["1s"].set(secondlyTimestamp, secondlyCandle);
      this.emitCandleUpdate("1s", secondlyCandle);
    } else {
      const updatedCandle = this.updateExistingCandle(
        secondlyCandle,
        tokenPrice,
        tokenVolume,
        marketCapSol
      );
      this.candles["1s"].set(secondlyTimestamp, updatedCandle);
      this.emitCandleUpdate("1s", updatedCandle);
    }

    // Invalidate relevant caches
    this.invalidateCache("indicators");
    this.invalidateCache("volumeProfiles");
    this.invalidateCache("patterns");

    // Aggregate to higher timeframes
    this.aggregateToHigherTimeframes(timestamp);
  }

  private emitCandleUpdate(timeframe: TimeframeType, candle: Candle): void {
    this.emit("candleUpdate", { timeframe, candle });
  }

  private invalidateCache(type: CacheType): void {
    this.cache[type].clear();
  }

  private getTimeframeTimestamp(
    timestamp: number,
    timeframe: TimeframeType
  ): number {
    const seconds = Math.floor(timestamp / 1000);
    switch (timeframe) {
      case "5s":
        return Math.floor(seconds / 5) * 5000;
      case "15s":
        return Math.floor(seconds / 15) * 15000;
      case "30s":
        return Math.floor(seconds / 30) * 30000;
      case "1m":
        return Math.floor(seconds / 60) * 60000;
      default:
        return seconds * 1000;
    }
  }

  private aggregateToHigherTimeframes(timestamp: number): void {
    const timeframes: TimeframeType[] = ["5s", "15s", "30s", "1m"];

    for (const timeframe of timeframes) {
      const periodStart = this.getTimeframeTimestamp(timestamp, timeframe);
      const periodEnd = periodStart + this.getTimeframeDuration(timeframe);

      // Get all 1s candles within this timeframe
      const relevantCandles = Array.from(this.candles["1s"].values()).filter(
        (candle) =>
          candle.timestamp >= periodStart && candle.timestamp < periodEnd
      );

      if (relevantCandles.length === 0) return;

      const aggregatedCandle: Candle = {
        timestamp: periodStart,
        open: relevantCandles[0].open,
        high: {
          tokens: Math.max(...relevantCandles.map((c) => c.high.tokens)),
          sol: Math.max(...relevantCandles.map((c) => c.high.sol)),
          usd: Math.max(...relevantCandles.map((c) => c.high.usd)),
        },
        low: {
          tokens: Math.min(...relevantCandles.map((c) => c.low.tokens)),
          sol: Math.min(...relevantCandles.map((c) => c.low.sol)),
          usd: Math.min(...relevantCandles.map((c) => c.low.usd)),
        },
        close: relevantCandles[relevantCandles.length - 1].close,
        volume: {
          tokens: relevantCandles.reduce((sum, c) => sum + c.volume.tokens, 0),
          sol: relevantCandles.reduce((sum, c) => sum + c.volume.sol, 0),
          usd: relevantCandles.reduce((sum, c) => sum + c.volume.usd, 0),
        },
        trades: relevantCandles.reduce((sum, c) => sum + c.trades, 0),
        marketCap: relevantCandles[relevantCandles.length - 1].marketCap,
      };

      this.candles[timeframe].set(periodStart, aggregatedCandle);
      this.emitCandleUpdate(timeframe, aggregatedCandle);
    }
  }

  private getTimeframeDuration(timeframe: TimeframeType): number {
    const durations: Record<TimeframeType, number> = {
      "1s": 1000,
      "5s": 5000,
      "15s": 15000,
      "30s": 30000,
      "1m": 60000,
    };
    return durations[timeframe];
  }

  public getCandles(
    timeframe: TimeframeType,
    start?: number,
    end?: number
  ): Candle[] {
    const candles = Array.from(this.candles[timeframe].values());

    if (!start && !end) return candles;

    return candles
      .filter(
        (candle) =>
          (!start || candle.timestamp >= start) &&
          (!end || candle.timestamp <= end)
      )
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  public getLatestCandle(timeframe: TimeframeType): Candle | undefined {
    const candles = this.getCandles(timeframe);
    return candles[candles.length - 1];
  }

  public calculateVWAP(timeframe: TimeframeType, period: number): number {
    const candles = this.getCandles(timeframe).slice(-period);
    if (candles.length === 0) return 0;

    const totalVolume = candles.reduce(
      (sum, candle) => sum + candle.volume.usd,
      0
    );
    if (totalVolume === 0) return 0;

    const sumVolumePrice = candles.reduce(
      (sum, candle) =>
        sum +
        candle.volume.usd *
          ((candle.high.usd + candle.low.usd + candle.close.usd) / 3),
      0
    );

    return sumVolumePrice / totalVolume;
  }

  public calculateEMA(timeframe: TimeframeType, period: number): number {
    const cacheKey = `ema_${timeframe}_${period}`;
    const cached = this.cache.indicators.get(cacheKey);
    if (cached) return cached;

    const candles = this.getCandles(timeframe);
    if (candles.length < period) return 0;

    const multiplier = 2 / (period + 1);
    let ema = candles[0].close.usd;

    for (let i = 1; i < candles.length; i++) {
      ema = (candles[i].close.usd - ema) * multiplier + ema;
    }

    this.cache.indicators.set(cacheKey, ema);
    return ema;
  }
}
