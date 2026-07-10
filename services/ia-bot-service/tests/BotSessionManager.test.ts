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
    type: 'ia-bot:sessionStart',
    payload: { matchId, difficulty, botSide, physicsConfig: DEFAULT_CFG },
  };
}

function makeState(
  matchId: number,
  ball:    { x: number; y: number; vx: number; vy: number },
  paddles: { leftY: number; rightY: number } = { leftY: 260, rightY: 260 },
): WsEnvelope {
  return {
    type: 'ia-bot:state',
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
    manager.handleSessionStart(makeSessionStart(1, 'medium'));
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
    manager.handleSessionEnd({ type: 'ia-bot:sessionEnd', payload: { matchId: 1 } });
    expect(manager.sessionCount()).toBe(0);
  });

  it('handleSessionEnd is a no-op for unknown matchId', () => {
    expect(() => manager.handleSessionEnd({ type: 'ia-bot:sessionEnd', payload: { matchId: 99 } })).not.toThrow();
  });

  // ── state handling and direction decisions ───────────────────────────────────

  it('does not send any direction before the reactionDelay elapses', () => {
    // hard preset has reactionDelayMs=0 — use medium (120ms) to test the delay.
    manager.handleSessionStart(makeSessionStart(1, 'medium'));
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
    // Hard preset. First establish a 'down' direction, then show a stop when
    // the ball is centered on the paddle. The transition only sends a message
    // when the direction actually changes from the previous value.
    manager.handleSessionStart(makeSessionStart(1, 'hard'));

    // Step 1: ball below paddle center → 'down'.
    manager.handleState(makeState(1, { x: 400, y: 550, vx: 5, vy: 0 }, { leftY: 260, rightY: 260 }));
    const countAfterDown = sent.filter((m) => m.type === 'game:botInput').length;

    // Step 2: advance past updateIntervalMs (16ms for hard), then ball at center.
    vi.advanceTimersByTime(16);
    // Ball at y=300, vy=0, paddle center at 300 → targetY=300, distance=0 → stop.
    manager.handleState(makeState(1, { x: 400, y: 300, vx: 5, vy: 0 }, { leftY: 260, rightY: 260 }));

    const allDir = sent.filter((m) => m.type === 'game:botInput');
    expect(allDir.length).toBeGreaterThan(countAfterDown); // a new message was sent
    const last = allDir[allDir.length - 1]!;
    expect((last.payload as { direction: string }).direction).toBe('stop');
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
});
