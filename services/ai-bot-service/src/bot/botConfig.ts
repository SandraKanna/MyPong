export type Difficulty = 'easy' | 'normal' | 'hard';

export interface BotPreset {
  reactionDelayMs:  number; // TUNE: higher = bot takes longer to start tracking after session start
  trackingErrorPx:  number; // TUNE: higher = bot aims further from ball center (wider error band)
  updateIntervalMs: number; // TUNE: higher = bot re-evaluates its direction less frequently
}

export const BOT_PRESETS: Record<Difficulty, BotPreset> = {
  easy:   { reactionDelayMs: 300, trackingErrorPx: 40, updateIntervalMs: 100 },
  normal: { reactionDelayMs: 120, trackingErrorPx: 60, updateIntervalMs: 50  },
  hard:   { reactionDelayMs: 0,   trackingErrorPx: 0,  updateIntervalMs: 16  },
};
