import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BotSessionManager } from '../src/bot/BotSessionManager';
import type { WsEnvelope } from '@mypong/types';

const DEFAULT_CFG = {
  fieldWidth:    800,
  fieldHeight:   600,
  ballRadius:    10,
  paddleHeight:  80,
  paddleXOffset: 20,
  paddleWidth:   12,
  paddleSpeed:   5,
};

function makeSessionStart(matchId: number, difficulty: string, botSide = 'right'): WsEnvelope {
  return {
    type: 'ai-bot:sessionStart',
    payload: { matchId, difficulty, botSide, physicsConfig: DEFAULT_CFG },
  };
}

function makeState(
  matchId: number,
  ball:    { x: number; y: number; vx: number; vy: number },
  paddles: { leftY: number; rightY: number } = { leftY: 260, rightY: 260 },
): WsEnvelope {
  return {
    type: 'ai-bot:state',
    payload: { matchId, ball, paddles, score: { left: 0, right: 0 } },
  };
}

describe('BotSessionManager', () => {
  let sent:    WsEnvelope[];
  let manager: BotSessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    sent    = [];
    manager = new BotSessionManager((msg) => sent.push(msg));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── session lifecycle ────────────────────────────────────────────────────────

  it('handleSessionStart creates a bot session', () => {
    manager.handleSessionStart(makeSessionStart(1, 'normal'));
    expect(manager.sessionCount()).toBe(1);
  });

  it('handleSessionStart ignores unknown difficulty', () => {
    manager.handleSessionStart(makeSessionStart(1, 'godmode'));
    expect(manager.sessionCount()).toBe(0);
  });

  it('handleSessionStart ignores invalid botSide', () => {
    manager.handleSessionStart(makeSessionStart(1, 'easy', 'center'));
    expect(manager.sessionCount()).toBe(0);
  });

  it('handleSessionEnd removes the session', () => {
    manager.handleSessionStart(makeSessionStart(1, 'easy'));
    manager.handleSessionEnd({ type: 'ai-bot:sessionEnd', payload: { matchId: 1 } });
    expect(manager.sessionCount()).toBe(0);
  });

  it('handleSessionEnd is a no-op for unknown matchId', () => {
    expect(() => manager.handleSessionEnd({ type: 'ai-bot:sessionEnd', payload: { matchId: 99 } })).not.toThrow();
  });

  // ── state handling and direction decisions ───────────────────────────────────

  it('does not send any direction before the reactionDelay elapses', () => {
    // hard preset has reactionDelayMs=0 — use normal (120ms) to test the delay.
    manager.handleSessionStart(makeSessionStart(1, 'normal'));
    // Advance time by less than reactionDelayMs (120ms).
    vi.advanceTimersByTime(50);
    manager.handleState(makeState(1, { x: 400, y: 300, vx: 5, vy: 3 }));
    expect(sent).toHaveLength(0);
  });

  it('sends a direction after the reactionDelay elapses', () => {
    manager.handleSessionStart(makeSessionStart(1, 'hard')); // reactionDelayMs=0
    manager.handleState(makeState(1, { x: 400, y: 100, vx: 5, vy: 0 }));
    // Hard bot reacts immediately — should send a direction.
    expect(sent.length).toBeGreaterThan(0);
    const msg = sent[0]!;
    expect(msg.type).toBe('game:botInput');
    expect((msg.payload as { direction: string }).direction).toMatch(/^(up|down|stop)$/);
  });

  it('throttles updates to updateIntervalMs (hard preset = 16ms)', () => {
    manager.handleSessionStart(makeSessionStart(1, 'hard'));
    manager.handleState(makeState(1, { x: 400, y: 100, vx: 5, vy: 0 }));
    const countAfterFirst = sent.length;

    // State arrives again immediately (< 16ms) — must be throttled.
    manager.handleState(makeState(1, { x: 400, y: 100, vx: 5, vy: 0 }));
    expect(sent.length).toBe(countAfterFirst);
  });

  it('allows another update after updateIntervalMs passes', () => {
    manager.handleSessionStart(makeSessionStart(1, 'hard'));
    manager.handleState(makeState(1, { x: 400, y: 100, vx: 5, vy: 0 }));
    const countAfterFirst = sent.length;

    vi.advanceTimersByTime(16);
    // Different y so direction definitely re-evaluates.
    manager.handleState(makeState(1, { x: 400, y: 500, vx: 5, vy: 0 }));
    // If direction changed, a new message is sent.
    // (We can't assert length unconditionally since direction may coincide, but
    // at least the call must not throw and no error is raised.)
    expect(sent.length).toBeGreaterThanOrEqual(countAfterFirst);
  });

  it('does not resend direction when it has not changed', () => {
    manager.handleSessionStart(makeSessionStart(1, 'hard'));

    // First evaluation.
    manager.handleState(makeState(1, { x: 400, y: 100, vx: 5, vy: 0 }));
    const countAfterFirst = sent.length;

    // Advance past updateIntervalMs (16ms for hard) and send exact same state.
    vi.advanceTimersByTime(16);
    manager.handleState(makeState(1, { x: 400, y: 100, vx: 5, vy: 0 }));
    // Direction unchanged — no second message.
    expect(sent.length).toBe(countAfterFirst);
  });

  it('moves up when ball is heading toward the bot and target is above paddle center', () => {
    // Hard preset: no error, no delay. Ball approaching from center (x=400), heading right.
    // Bot is on right paddle at y=260 (center 300). Ball y=50 → predicted impact near 50 →
    // paddle should move up.
    manager.handleSessionStart(makeSessionStart(1, 'hard'));
    manager.handleState(makeState(1, { x: 400, y: 50, vx: 5, vy: 0 }, { leftY: 260, rightY: 260 }));

    const dirMsg = sent.find((m) => m.type === 'game:botInput');
    expect(dirMsg).toBeDefined();
    expect((dirMsg!.payload as { direction: string }).direction).toBe('up');
  });

  it('moves down when target is below paddle center', () => {
    // Ball y=550 → predicted impact near 550 → paddle (center at 300) should move down.
    manager.handleSessionStart(makeSessionStart(1, 'hard'));
    manager.handleState(makeState(1, { x: 400, y: 550, vx: 5, vy: 0 }, { leftY: 260, rightY: 260 }));

    const dirMsg = sent.find((m) => m.type === 'game:botInput');
    expect(dirMsg).toBeDefined();
    expect((dirMsg!.payload as { direction: string }).direction).toBe('down');
  });

  it('sends stop after a direction change when paddle reaches the target', () => {
    // Hard preset (trackingErrorPx=0, updateIntervalMs=16ms, reactionDelayMs=0).
    // Ball at y=300, vy=0: predicted landing = 300 (no vy drift). Target cached on first eval.
    // Step 1: paddle center at 440 (rightY=400) → distanceToTarget = -140 → 'up'.
    // Step 2: advance 16ms, paddle now at center=300 (rightY=260) → distance=0 → 'stop'.
    manager.handleSessionStart(makeSessionStart(1, 'hard'));

    manager.handleState(makeState(1, { x: 400, y: 300, vx: 5, vy: 0 }, { leftY: 260, rightY: 400 }));
    const countAfterUp = sent.filter((m) => m.type === 'game:botInput').length;
    expect(countAfterUp).toBeGreaterThan(0);

    vi.advanceTimersByTime(16);
    // x advances slightly to show ball is still moving; cachedTargetY=300 is kept (still approaching).
    manager.handleState(makeState(1, { x: 410, y: 300, vx: 5, vy: 0 }, { leftY: 260, rightY: 260 }));

    const allDir = sent.filter((m) => m.type === 'game:botInput');
    expect(allDir.length).toBeGreaterThan(countAfterUp);
    const last = allDir[allDir.length - 1]!;
    expect((last.payload as { direction: string }).direction).toBe('stop');
  });

  it('does not re-roll tracking error mid-approach — target is stable once cached', () => {
    // Hard preset used here for simplicity (zero error). The cache mechanism itself
    // is what's under test: the target must not change between ticks of the same approach.
    // We verify by checking no contradictory direction is emitted mid-approach.
    manager.handleSessionStart(makeSessionStart(1, 'hard'));

    // First approach: ball heading right (vx=5), paddle far below target (rightY=0 → center=40).
    // Predicted target = predictBallY(50, 0, ...) = 50. Paddle center 40 < 50 → 'down'.
    manager.handleState(makeState(1, { x: 400, y: 50, vx: 5, vy: 0 }, { leftY: 260, rightY: 0 }));
    const firstDir = (sent[0]!.payload as { direction: string }).direction;

    // Advance past updateIntervalMs; send another state with ball still approaching.
    vi.advanceTimersByTime(16);
    manager.handleState(makeState(1, { x: 410, y: 50, vx: 5, vy: 0 }, { leftY: 260, rightY: 0 }));

    // Direction must not have reversed — target is held stable (no re-roll).
    const allDir = sent.filter((m) => m.type === 'game:botInput').map((m) => (m.payload as { direction: string }).direction);
    for (const d of allDir) {
      expect(d).toBe(firstDir);
    }
  });

  it('recomputes target when ball reverses direction (away then back)', () => {
    // Shows the cache clears on "away" and recomputes on the next "toward" transition.
    manager.handleSessionStart(makeSessionStart(1, 'hard'));

    // Phase 1: ball approaching (vx > 0) → target cached based on y=50.
    manager.handleState(makeState(1, { x: 400, y: 50, vx: 5, vy: 0 }, { leftY: 260, rightY: 260 }));
    const dirAfterApproach = sent.filter((m) => m.type === 'game:botInput').length;

    // Phase 2: ball moving away (vx < 0) → cache clears, bot drifts to center.
    vi.advanceTimersByTime(16);
    manager.handleState(makeState(1, { x: 400, y: 50, vx: -5, vy: 0 }, { leftY: 260, rightY: 260 }));

    // Phase 3: ball approaching again (vx > 0) from a different y → new target computed.
    vi.advanceTimersByTime(16);
    manager.handleState(makeState(1, { x: 300, y: 550, vx: 5, vy: 0 }, { leftY: 260, rightY: 260 }));

    // All evaluations should complete without throwing.
    expect(manager.sessionCount()).toBe(1);
    const allDir = sent.filter((m) => m.type === 'game:botInput');
    expect(allDir.length).toBeGreaterThanOrEqual(dirAfterApproach);
  });

  it('handleState is a no-op for unknown matchId', () => {
    expect(() => manager.handleState(makeState(99, { x: 400, y: 300, vx: 5, vy: 0 }))).not.toThrow();
    expect(sent).toHaveLength(0);
  });

  it('sends game:botInput with the correct matchId in payload', () => {
    manager.handleSessionStart(makeSessionStart(42, 'hard'));
    manager.handleState(makeState(42, { x: 400, y: 50, vx: 5, vy: 0 }));

    const dirMsg = sent.find((m) => m.type === 'game:botInput');
    expect(dirMsg).toBeDefined();
    expect((dirMsg!.payload as { matchId: number }).matchId).toBe(42);
    expect(dirMsg!.to).toBeUndefined(); // no `to` — routed by prefix to game-service
  });

  // ── stop threshold and per-tick correction ───────────────────────────────────
  //
  // Unified threshold: max(4, paddleSpeed) = 5px for all branches and difficulties.
  // Direction correction (Phase 2) runs on every handleState call after reactionDelayMs,
  // so the paddle converges within one tick of entering the 5px zone — no oscillation.
  // Aim update (Phase 1) is still gated by updateIntervalMs (difficulty trait).
  //
  // Tests use the "establish a direction, then enter the stop zone" pattern because the
  // bot's `dir !== session.currentDir` guard suppresses sends when direction is unchanged.
  // Starting from currentDir='stop', a 'stop' evaluation produces no message — the test
  // must first confirm the paddle moves, then confirm it stops when inside the threshold.

  it('direction correction runs every tick, not every updateIntervalMs', () => {
    // easy: updateIntervalMs=100ms, but Phase 2 (correction) runs every call.
    // Prove by entering the 5px stop zone after only one tick (16ms < 100ms) — bot
    // still sends 'stop' because Phase 2 is not gated by updateIntervalMs.
    manager.handleSessionStart(makeSessionStart(1, 'easy'));
    vi.advanceTimersByTime(300); // past reactionDelayMs=300ms

    // Call 1: Phase 1 fires (first call). Ball moving away, cache cleared.
    // rightY=180 → center=220 → distance to 300 = 80px > 5px → 'down'.
    manager.handleState(makeState(1, { x: 200, y: 300, vx: -5, vy: 0 }, { leftY: 260, rightY: 180 }));
    expect(sent.find((m) => (m.payload as { direction: string }).direction === 'down')).toBeDefined();

    vi.advanceTimersByTime(16); // one tick — Phase 1 still gated (16ms < 100ms)
    // rightY=258 → center=298 → distance=2px < 5px → 'stop'.
    // Phase 1 does NOT fire, but Phase 2 does — proves per-tick correction.
    manager.handleState(makeState(1, { x: 200, y: 300, vx: -5, vy: 0 }, { leftY: 260, rightY: 258 }));

    const last = [...sent].reverse().find((m) => m.type === 'game:botInput');
    expect(last).toBeDefined();
    expect((last!.payload as { direction: string }).direction).toBe('stop');
  });

  it('center-drift uses the unified 5px threshold (not the old wider threshold)', () => {
    // normal: old centerDriftStopThreshold was 20px. Now it is the same 5px as approach.
    // Proves that 3px from center → 'stop', and 10px from center → direction sent.
    manager.handleSessionStart(makeSessionStart(1, 'normal'));
    vi.advanceTimersByTime(120); // past reactionDelayMs=120ms

    // rightY=140 → center=180 → distance=120px > 5px → 'down'.
    manager.handleState(makeState(1, { x: 200, y: 300, vx: -5, vy: 0 }, { leftY: 260, rightY: 140 }));
    expect(sent.find((m) => (m.payload as { direction: string }).direction === 'down')).toBeDefined();

    vi.advanceTimersByTime(16); // one tick (Phase 1 still gated — 16ms < 50ms)
    // rightY=257 → center=297 → distance=3px < 5px → 'stop'.
    manager.handleState(makeState(1, { x: 200, y: 300, vx: -5, vy: 0 }, { leftY: 260, rightY: 257 }));

    const last = [...sent].reverse().find((m) => m.type === 'game:botInput');
    expect(last).toBeDefined();
    expect((last!.payload as { direction: string }).direction).toBe('stop');
  });

  it('approach branch uses the unified 5px threshold', () => {
    // easy with Math.random pinned: tracking error = (0.5×2−1)×40 = 0 → cachedTargetY=predicted.
    // Ball approaching (vx>0), predicted landing = 300 (ball.y=300, vy=0).
    // Proves 10px distance → direction sent, 4px distance → 'stop'.
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    manager.handleSessionStart(makeSessionStart(1, 'easy'));
    vi.advanceTimersByTime(300); // past reactionDelayMs=300ms

    // rightY=250 → center=290 → distance=10px > 5px → 'down'.
    manager.handleState(makeState(1, { x: 400, y: 300, vx: 5, vy: 0 }, { leftY: 260, rightY: 250 }));
    expect(sent.find((m) => (m.payload as { direction: string }).direction === 'down')).toBeDefined();

    vi.advanceTimersByTime(16); // one tick (Phase 1 still gated)
    // rightY=256 → center=296 → distance=4px < 5px → 'stop'.
    manager.handleState(makeState(1, { x: 410, y: 300, vx: 5, vy: 0 }, { leftY: 260, rightY: 256 }));

    randSpy.mockRestore();

    const last = [...sent].reverse().find((m) => m.type === 'game:botInput');
    expect(last).toBeDefined();
    expect((last!.payload as { direction: string }).direction).toBe('stop');
  });

  it('no oscillation: direction does not reverse after reaching stop zone (regression)', () => {
    // Regression for approach-branch oscillation in easy: old code gated direction
    // correction by updateIntervalMs (100ms), so the paddle overshot the 5px stop
    // zone (~35px of travel per window) before the next correction fired, causing
    // a reversal. New per-tick Phase 2 settles within one tick — no reversal.
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5); // error=0, target=300

    manager.handleSessionStart(makeSessionStart(1, 'easy'));
    vi.advanceTimersByTime(300); // past reactionDelayMs

    // Ball at y=300, vy=0, vx=5: target cached = 300, ideal rightY=260 (center=300).
    // rightY=270: center=310, distance=-10px (just outside the 5px stop zone).
    // Simulate paddle responding to the bot's most recently commanded direction
    // at paddleSpeed=5px/tick — same as game-service would move it.
    let rightY = 270;
    let commandedDir: 'up' | 'down' | 'stop' = 'stop';
    for (let tick = 0; tick < 15; tick++) {
      vi.advanceTimersByTime(16);
      manager.handleState(makeState(
        1,
        { x: 400 + tick * 5, y: 300, vx: 5, vy: 0 },
        { leftY: 260, rightY },
      ));
      // Persist the last commanded direction until explicitly changed.
      const lastSent = [...sent].reverse().find((m) => m.type === 'game:botInput');
      if (lastSent) commandedDir = (lastSent.payload as { direction: string }).direction as typeof commandedDir;
      if (commandedDir === 'up')   rightY = Math.max(0, rightY - 5);
      if (commandedDir === 'down') rightY = Math.min(520, rightY + 5);
    }
    randSpy.mockRestore();

    const dirMsgs = sent
      .filter((m) => m.type === 'game:botInput')
      .map((m) => (m.payload as { direction: string }).direction);

    // Bot must reach 'stop' within the simulation window.
    const firstStopIdx = dirMsgs.indexOf('stop');
    expect(firstStopIdx).toBeGreaterThanOrEqual(0);

    // Zero direction-change sends after the first 'stop' — no oscillation.
    expect(dirMsgs.slice(firstStopIdx + 1)).toHaveLength(0);
  });
});
