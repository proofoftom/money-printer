export type TimeframeType = "1s" | "5s" | "15s" | "30s" | "1m";
export type CacheType = "indicators" | "volumeProfiles" | "patterns";
export type TokenStatus = "ACTIVE" | "DEAD";
export type CrossType = "EMA" | "VWAP";
export type CrossDirection = "BULLISH" | "BEARISH";

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

export interface Pattern {
  type: string;
  timeframe: string;
  timestamp: number;
  significance: number;
}

export interface CrossEvent {
  type: CrossType;
  direction: CrossDirection;
  timeframe: TimeframeType;
  timestamp: number;
  fastPeriod?: number; // For EMA crosses
  slowPeriod?: number; // For EMA crosses
  price: number;
  crossValue: number;
}

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

export interface VolumeProfileLevel {
  price: number;
  volume: {
    tokens: number;
    sol: number;
    usd: number;
  };
  trades: number;
  significance: number; // 0-1 score based on relative volume
}

export enum PatternType {
  SUPPORT = "support",
  RESISTANCE = "resistance",
  VOLUME_CLUSTER = "volume_cluster",
  // We can add more patterns later
}

export interface SupportResistanceLevel {
  price: number;
  strength: number; // 0-1 score based on volume and recurrence
  type: PatternType.SUPPORT | PatternType.RESISTANCE;
  volumeProfile: VolumeProfileLevel;
}
