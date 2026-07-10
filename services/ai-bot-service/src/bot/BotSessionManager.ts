import type { WsEnvelope } from '@mypong/types';
import { BOT_PRESETS, type Difficulty } from './botConfig';
import { predictBallY } from './ballPredictor';

interface PhysicsConfig {
  fieldWidth:   number;
  fieldHeight:  number;
  ballRadius:   number;
  paddleHeight: number;
  paddleXOffset: number;
  paddleWidth:  number;
  paddleSpeed:  number;
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

const STOP_THRESHOLD_PX = 4; // TUNE: smaller = bot stops closer to target before coasting

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

    // Throttle direction updates to updateIntervalMs.
    if (now - session.lastEvalMs < preset.updateIntervalMs) return;
    session.lastEvalMs = now;

    const { ball, paddles, matchId } = payload;
    const { cfg, botSide } = session;

    // Paddle face X: where the ball must reach for the bot to intercept.
    const faceX = botSide === 'right'
      ? cfg.fieldWidth - cfg.paddleXOffset - cfg.paddleWidth
      : cfg.paddleXOffset + cfg.paddleWidth;

    const paddleY = botSide === 'right' ? paddles.rightY : paddles.leftY;

    let targetY: number;

    const movingTowardBot = botSide === 'right' ? ball.vx > 0 : ball.vx < 0;

    if (movingTowardBot && ball.vx !== 0) {
      // Recompute the cached target only when the ball just turned toward this bot
      // (transition from away → toward). Holding the target stable for the full
      // approach avoids re-rolling the random error every tick, which causes jitter.
      if (!session.ballApproaching) {
        const stepsToImpact    = (faceX - ball.x) / ball.vx;
        const predicted        = predictBallY(ball.y, ball.vy, stepsToImpact, cfg.fieldHeight, cfg.ballRadius);
        const error            = (Math.random() * 2 - 1) * preset.trackingErrorPx;
        session.cachedTargetY  = predicted + error;
        session.ballApproaching = true;
      }
      targetY = session.cachedTargetY!;
    } else {
      // Ball moving away — clear the cache and drift toward field center.
      session.cachedTargetY   = null;
      session.ballApproaching = false;
      targetY = cfg.fieldHeight / 2;
    }

    // Move so paddle center reaches targetY.
    const paddleCenterY   = paddleY + cfg.paddleHeight / 2;
    const distanceToTarget = targetY - paddleCenterY;

    let dir: 'up' | 'down' | 'stop';
    if (Math.abs(distanceToTarget) < STOP_THRESHOLD_PX) {
      dir = 'stop';
    } else if (distanceToTarget < 0) {
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
