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
}
