export interface Candle {
  timestamp: number;
  open: {
    tokens: number;
    sol: number;
    usd: number;
  };
  high: {
    tokens: number;
    sol: number;
    usd: number;
  };
  low: {
    tokens: number;
    sol: number;
    usd: number;
  };
  close: {
    tokens: number;
    sol: number;
    usd: number;
  };
  volume: {
    tokens: number;
    sol: number;
    usd: number;
  };
  trades: number;
  marketCap: {
    sol: number;
    usd: number;
  };
}

export interface VolumeProfile {
  priceLevel: {
    tokens: number;
    sol: number;
    usd: number;
  };
  volume: {
    tokens: number;
    sol: number;
    usd: number;
  };
  trades: number;
}

export interface Pattern {
  type: string;
  timeframe: string;
  timestamp: number;
  significance: number;
}

export type TimeframeType = "1s" | "5s" | "15s" | "30s" | "1m";
export type CacheType = "indicators" | "volumeProfiles" | "patterns";
export type TokenStatus = "ACTIVE" | "DEAD";

export interface OHLCVDataExport {
  candles: {
    [timeframe in TimeframeType]?: Candle[];
  };
  indicators: {
    ema: Record<string, number>;
    vwap: Record<string, number>;
  };
  volumeProfiles: {
    [timeframe in TimeframeType]?: VolumeProfile[];
  };
  patterns: Pattern[];
}
