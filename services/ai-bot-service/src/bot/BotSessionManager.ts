import type { WsEnvelope } from '@mypong/types';
import { BOT_PRESETS, type Difficulty } from './botConfig';
import { predictBallY } from './ballPredictor';

interface PhysicsConfig {
  fieldWidth:    number;
  fieldHeight:   number;
  ballRadius:    number;
  paddleHeight:  number;
  paddleXOffset: number;
  paddleWidth:   number;
  paddleSpeed:   number;
}

interface BotSession {
  matchId:         number;
  botSide:         'left' | 'right';
  difficulty:      Difficulty;
  cfg:             PhysicsConfig;
  lastEvalMs:      number;  // wall-clock ms of last direction evaluation
  sessionStartMs:  number;  // wall-clock ms when session was created (for reactionDelay)
  currentDir:      'up' | 'down' | 'stop';
  // Cached target Y for the current incoming-ball approach. Computed once when the
  // ball first starts moving toward this bot's paddle and held until the ball
  // reverses direction. This prevents the random tracking error from being
  // re-rolled on every evaluation tick, which causes visible paddle jitter.
  cachedTargetY:   number | null;
  ballApproaching: boolean; // tracks the previous approaching state to detect transitions
}

interface SessionStartPayload {
  matchId:       number;
  difficulty?:   string;
  botSide?:      string;
  physicsConfig: PhysicsConfig;
}

interface BotStatePayload {
  matchId: number;
  ball:    { x: number; y: number; vx: number; vy: number };
  paddles: { leftY: number; rightY: number };
  score:   { left: number; right: number };
}

interface SessionEndPayload {
  matchId: number;
}

// Minimum stop precision used as the floor for both threshold calculations.
// TUNE: smaller = bot stops closer to target before coasting (hard preset floor).
const STOP_THRESHOLD_MIN_PX = 4;

// TUNE: probability that easy bot deliberately misses when it is tied or ahead.
const EASY_MISS_PROBABILITY = 0.5;
// TUNE: how far past the paddle edge the bot aims on a deliberate miss (guarantees a clean miss).
const EASY_MISS_OFFSET_PX   = 70;

export class BotSessionManager {
  private readonly send:     (envelope: WsEnvelope) => void;
  private readonly sessions: Map<number, BotSession> = new Map();

  constructor(send: (envelope: WsEnvelope) => void) {
    this.send = send;
  }

  handleSessionStart(envelope: WsEnvelope): void {
    const payload = envelope.payload as SessionStartPayload | undefined;
    if (!payload || typeof payload.matchId !== 'number') return;
    if (payload.difficulty !== 'easy' && payload.difficulty !== 'normal' && payload.difficulty !== 'hard') return;
    if (payload.botSide !== 'left' && payload.botSide !== 'right') return;

    const { matchId, difficulty, botSide, physicsConfig } = payload;

    this.sessions.set(matchId, {
      matchId,
      botSide,
      difficulty,
      cfg:             physicsConfig,
      lastEvalMs:      0,
      sessionStartMs:  Date.now(),
      currentDir:      'stop',
      cachedTargetY:   null,
      ballApproaching: false,
    });
  }

  handleState(envelope: WsEnvelope): void {
    const payload = envelope.payload as BotStatePayload | undefined;
    if (!payload || typeof payload.matchId !== 'number') return;

    const session = this.sessions.get(payload.matchId);
    if (!session) return;

    const now   = Date.now();
    const preset = BOT_PRESETS[session.difficulty];

    // Respect the reaction delay before making any move after session start.
    if (now - session.sessionStartMs < preset.reactionDelayMs) return;

    const { ball, paddles, matchId } = payload;
    const { cfg, botSide } = session;

    // Paddle face X: where the ball must reach for the bot to intercept.
    const faceX = botSide === 'right'
      ? cfg.fieldWidth - cfg.paddleXOffset - cfg.paddleWidth
      : cfg.paddleXOffset + cfg.paddleWidth;

    const paddleY = botSide === 'right' ? paddles.rightY : paddles.leftY;

    // ── Phase 1: aim update (gated by updateIntervalMs) ──────────────────────
    // Recomputes where the bot is trying to go. Difficulty is expressed here:
    // hard re-aims every 16ms, normal every 50ms, easy every 100ms.
    if (now - session.lastEvalMs >= preset.updateIntervalMs) {
      session.lastEvalMs = now;

      const movingTowardBot = botSide === 'right' ? ball.vx > 0 : ball.vx < 0;

      if (movingTowardBot && ball.vx !== 0) {
        // Cache the target once on the away→toward transition. Holding it stable
        // for the whole approach prevents re-rolling the random error every tick,
        // which would cause visible jitter.
        if (!session.ballApproaching) {
          const stepsToImpact = (faceX - ball.x) / ball.vx;
          const predicted     = predictBallY(ball.y, ball.vy, stepsToImpact, cfg.fieldHeight, cfg.ballRadius);

          let targetY: number;
          if (session.difficulty === 'easy' && Math.random() < EASY_MISS_PROBABILITY) {
            // Deliberate miss: aim past the paddle edge to let the human score.
            const missDir = Math.random() < 0.5 ? 1 : -1;
            targetY = predicted + missDir * EASY_MISS_OFFSET_PX;
          } else {
            const error = (Math.random() * 2 - 1) * preset.trackingErrorPx;
            targetY = predicted + error;
          }
          session.cachedTargetY  = targetY;
          session.ballApproaching = true;
        }
      } else {
        // Ball moving away — clear the cache and drift toward field center.
        session.cachedTargetY   = null;
        session.ballApproaching = false;
      }
    }

    // ── Phase 2: direction correction (runs every call) ───────────────────────
    // Pure servo: move toward whatever target Phase 1 last set. Runs every physics
    // tick so the paddle converges within one tick of entering the stop zone,
    // preventing oscillation regardless of how infrequently Phase 1 fires.
    const targetY       = session.cachedTargetY ?? cfg.fieldHeight / 2;
    const paddleCenterY = paddleY + cfg.paddleHeight / 2;
    const distance      = targetY - paddleCenterY;
    // TUNE: max(4, paddleSpeed) = 7px — paddle stops when center is within one
    // tick's travel of the target, preventing single-tick overshoot oscillation.
    const stopThreshold = Math.max(STOP_THRESHOLD_MIN_PX, cfg.paddleSpeed);

    let dir: 'up' | 'down' | 'stop';
    if (Math.abs(distance) < stopThreshold) {
      dir = 'stop';
    } else if (distance < 0) {
      dir = 'up';
    } else {
      dir = 'down';
    }

    if (dir !== session.currentDir) {
      session.currentDir = dir;
      this.send({ type: 'game:botInput', payload: { matchId, direction: dir } });
    }
  }

  handleSessionEnd(envelope: WsEnvelope): void {
    const payload = envelope.payload as SessionEndPayload | undefined;
    if (!payload || typeof payload.matchId !== 'number') return;

    this.sessions.delete(payload.matchId);
  }

  sessionCount(): number {
    return this.sessions.size;
  }
}
