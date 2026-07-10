import type { WsEnvelope } from '@mypong/types';
import { Game } from '../physics/game';
import { DEFAULT_PHYSICS_CONFIG } from '../physics/physicsConfig';
import { AI_BOT_USER_ID } from './constants';

export interface Session {
  game:              Game;
  players:           Map<number, 'left' | 'right'>;
  userIds:           [number, number];
  interval:          ReturnType<typeof setInterval>;
  startedAt:         Date;
  mode:              'pvp' | 'pve';
  disconnectedUserId?: number;
  disconnectTimer?:    ReturnType<typeof setTimeout>;
}

interface PendingMatch {
  userIds:             [number, number];
  startsAt:            string;
  players:             Map<number, 'left' | 'right'>;
  mode:                'pvp' | 'pve';
  disconnectedUserId?: number;
}

interface Opts {
  tickIntervalMs?: number;
  gracePeriodMs?:  number;
  gameFactory?:    () => Game;
}

interface AssignPayload {
  matchId:   number;
  players:   Record<string, string>;
  startsAt?: string;
}

interface InputPayload {
  matchId:   number;
  direction: string;
}

interface StartAIPayload {
  difficulty?: string;
}

export class GameSessionManager {
  private readonly send:           (envelope: WsEnvelope) => void;
  private readonly tickIntervalMs: number;
  private readonly gracePeriodMs:  number;
  private readonly gameFactory:    () => Game;
  private readonly sessions:       Map<number, Session>      = new Map();
  private readonly pendingMatchIds: Map<number, PendingMatch> = new Map();

  constructor(send: (envelope: WsEnvelope) => void, opts?: Opts) {
    this.send           = send;
    this.tickIntervalMs = opts?.tickIntervalMs ?? 16;
    this.gracePeriodMs  = opts?.gracePeriodMs  ?? 5_000;
    this.gameFactory    = opts?.gameFactory    ?? (() => new Game());
  }

  handleAssign(envelope: WsEnvelope): void {
    const payload = envelope.payload as AssignPayload | undefined;
    if (!payload || typeof payload.matchId !== 'number') return;

    const { matchId, players: rawPlayers, startsAt: rawStartsAt } = payload;
    // A duplicate assign (active or still pending) would leak an orphaned game + interval.
    if (this.sessions.has(matchId) || this.pendingMatchIds.has(matchId)) return;
    if (!rawPlayers || typeof rawPlayers !== 'object' || Array.isArray(rawPlayers)) return;

    // JSON object keys are always strings; convert to number here.
    const players = new Map<number, 'left' | 'right'>(
      Object.entries(rawPlayers).map(([k, v]) => [Number(k), v as 'left' | 'right']),
    );
    if (players.size !== 2) return;
    // Validate values: winnerId resolution uses .find()! on these — a missing
    // 'left' or 'right' would throw inside the interval tick callback.
    const sides = [...players.values()];
    if (!sides.includes('left') || !sides.includes('right')) return;

    const userIds  = [...players.keys()] as [number, number];
    const startsAt = (typeof rawStartsAt === 'string') ? rawStartsAt : new Date().toISOString();
    const delay    = Math.max(0, new Date(startsAt).getTime() - Date.now());

    const pendingEntry: PendingMatch = { userIds, startsAt, players, mode: 'pvp' };
    this.pendingMatchIds.set(matchId, pendingEntry);

    const startSession = () => {
      this.pendingMatchIds.delete(matchId);

      if (pendingEntry.disconnectedUserId !== undefined) {
        // Player disconnected during the countdown and never reconnected — forfeit before play.
        this.emitForfeit(
          matchId, players, userIds,
          pendingEntry.disconnectedUserId,
          { left: 0, right: 0 },
          new Date(),
        );
        return;
      }

      const game      = this.gameFactory();
      const startedAt = new Date();

      const interval = setInterval(() => {
        game.update();
        const state = game.getState();

        this.send({ type: 'game:state', to: userIds, payload: { matchId, ...state } });

        if (game.isGameOver) {
          clearInterval(interval);
          this.sessions.delete(matchId);

          const { score } = state;
          const winnerId  = score.left > score.right
            ? [...players.entries()].find(([, side]) => side === 'left')![0]
            : [...players.entries()].find(([, side]) => side === 'right')![0];

          // match:result has no `to` — gateway-ws routes it to match-service by type prefix.
          this.send({ type: 'match:result', payload: {
            matchId,
            players:   Object.fromEntries(players),
            winnerId,
            score,
            status:    'completed',
            startedAt: startedAt.toISOString(),
            endedAt:   new Date().toISOString(),
          }});

          this.send({ type: 'game:end', to: userIds, payload: { matchId, winnerId, score, reason: 'completed' } });
        }
      }, this.tickIntervalMs);

      this.sessions.set(matchId, { game, players, userIds, interval, startedAt, mode: 'pvp' });
    };

    if (delay > 0) {
      setTimeout(startSession, delay);
    } else {
      startSession(); // synchronous — preserves existing test behaviour (no timer advance needed)
    }
  }

  handleStartAI(envelope: WsEnvelope): void {
    const payload = envelope.payload as StartAIPayload | undefined;
    const { userId } = envelope;
    if (!payload || userId === undefined) return;

    const { difficulty } = payload;
    if (difficulty !== 'easy' && difficulty !== 'normal' && difficulty !== 'hard') return;

    // Reject if user already has an active or pending session (PvP or PvE).
    for (const session of this.sessions.values()) {
      if (session.players.has(userId)) {
        this.send({ type: 'match:rejected', to: [userId], payload: { reason: 'already_in_session', message: 'You are already in a match.' } });
        return;
      }
    }
    for (const pending of this.pendingMatchIds.values()) {
      if (pending.userIds.includes(userId)) {
        this.send({ type: 'match:rejected', to: [userId], payload: { reason: 'already_in_session', message: 'You are already in a match.' } });
        return;
      }
    }

    const matchId  = this.generatePveMatchId();
    const startsAt = new Date(Date.now() + 3_000).toISOString();
    const players  = new Map<number, 'left' | 'right'>([[userId, 'left'], [AI_BOT_USER_ID, 'right']]);
    const userIds: [number, number] = [userId, AI_BOT_USER_ID];

    const pendingEntry: PendingMatch = { userIds, startsAt, players, mode: 'pve' };
    this.pendingMatchIds.set(matchId, pendingEntry);

    // match:matched reuses the existing 3-second countdown frontend flow.
    this.send({ type: 'match:matched', to: [userId], payload: { matchId, players: Object.fromEntries(players), startsAt } });
    // Notify the bot service so it can prepare its session state.
    this.send({ type: 'ai-bot:sessionStart', payload: { matchId, difficulty, botSide: 'right', physicsConfig: DEFAULT_PHYSICS_CONFIG } });

    const delay = Math.max(0, new Date(startsAt).getTime() - Date.now());

    const startSession = () => {
      this.pendingMatchIds.delete(matchId);

      if (pendingEntry.disconnectedUserId !== undefined) {
        // Human disconnected during the countdown — cancel without a DB record.
        this.send({ type: 'ai-bot:sessionEnd', payload: { matchId } });
        return;
      }

      const game      = this.gameFactory();
      const startedAt = new Date();

      const interval = setInterval(() => {
        game.update();
        const state = game.getState();

        // game:state to the human player (to:[userId] — AI_BOT_USER_ID has no socket).
        this.send({ type: 'game:state', to: [userId], payload: { matchId, ...state } });
        // ai-bot:state includes velocity so the bot can predict ball trajectory.
        this.send({ type: 'ai-bot:state', payload: { matchId, ball: { x: game.ball.x, y: game.ball.y, vx: game.ball.vx, vy: game.ball.vy }, paddles: state.paddles, score: state.score } });

        if (game.isGameOver) {
          clearInterval(interval);
          this.sessions.delete(matchId);

          const { score } = state;
          const winnerId  = score.left > score.right ? userId : AI_BOT_USER_ID;

          // PvE: no match:result — this session has no DB record.
          this.send({ type: 'ai-bot:sessionEnd', payload: { matchId } });
          this.send({ type: 'game:end', to: [userId], payload: { matchId, winnerId, score, reason: 'completed' } });
        }
      }, this.tickIntervalMs);

      this.sessions.set(matchId, { game, players, userIds, interval, startedAt, mode: 'pve' });
    };

    if (delay > 0) {
      setTimeout(startSession, delay);
    } else {
      startSession();
    }
  }

  handleInput(envelope: WsEnvelope): void {
    const payload = envelope.payload as InputPayload | undefined;
    if (!payload || typeof payload.matchId !== 'number') return;

    const { matchId, direction } = payload;
    if (direction !== 'up' && direction !== 'down' && direction !== 'stop') return;

    // Sessions not yet started (pending) simply won't be in this Map — safe no-op.
    const session = this.sessions.get(matchId);
    if (!session) return;

    const { userId } = envelope;
    if (userId === undefined) return;

    const side = session.players.get(userId);
    if (!side) return;

    session.game.setPaddleDirection(side, direction);
  }

  handleBotInput(envelope: WsEnvelope): void {
    const payload = envelope.payload as InputPayload | undefined;
    if (!payload || typeof payload.matchId !== 'number') return;

    const { matchId, direction } = payload;
    if (direction !== 'up' && direction !== 'down' && direction !== 'stop') return;

    const session = this.sessions.get(matchId);
    if (!session || session.mode !== 'pve') return;

    // Bot always controls the right paddle in PvE sessions.
    session.game.setPaddleDirection('right', direction);
  }

  handlePlayerDisconnect(userId: number): void {
    // ── Active session ───────────────────────────────────────────────────────────
    for (const [matchId, session] of this.sessions) {
      if (!session.players.has(userId)) continue;

      if (session.mode === 'pve') {
        // PvE: immediate teardown with no grace window — the bot doesn't wait.
        clearInterval(session.interval);
        this.sessions.delete(matchId);
        this.send({ type: 'ai-bot:sessionEnd', payload: { matchId } });
        // Skip game:end — the browser socket is already gone (involuntary disconnect).
        return;
      }

      // Intentional: `userId` is captured by closure in the setTimeout below, so
      // the first disconnector always loses when the timer fires. Second disconnect
      // while the timer is running is a no-op — do not override disconnectedUserId.
      if (session.disconnectedUserId !== undefined) return;

      session.game.pause();
      session.disconnectedUserId = userId;

      const opponentId  = session.userIds.find((id) => id !== userId)!;
      const graceEndsAt = new Date(Date.now() + this.gracePeriodMs).toISOString();
      this.send({ type: 'game:paused', to: [opponentId],
        payload: { matchId, disconnectedUserId: userId, graceEndsAt } });

      session.disconnectTimer = setTimeout(() => {
        this.sessions.delete(matchId);
        clearInterval(session.interval);

        const { score } = session.game.getState();
        this.emitForfeit(matchId, session.players, session.userIds, userId, score, session.startedAt);
      }, this.gracePeriodMs);
      return;
    }

    // ── Pending session (player disconnected during countdown) ───────────────────
    for (const [matchId, pending] of this.pendingMatchIds) {
      if (!pending.userIds.includes(userId)) continue;
      // Same double-disconnect guard as above.
      if (pending.disconnectedUserId !== undefined) return;

      pending.disconnectedUserId = userId;

      if (pending.mode === 'pve') {
        // PvE: no human opponent to notify with game:paused.
        // startSession fires at startsAt and cancels cleanly if disconnectedUserId is set.
        return;
      }

      const opponentId = pending.userIds.find((id) => id !== userId)!;
      // No separate timer: startSession already fires at startsAt, which is the
      // natural grace deadline. Use startsAt directly as graceEndsAt.
      this.send({ type: 'game:paused', to: [opponentId],
        payload: { matchId, disconnectedUserId: userId, graceEndsAt: pending.startsAt } });
      return;
    }
  }

  handlePlayerLeave(userId: number): void {
    // Active session: forfeit immediately, no grace window, no game:paused to opponent.
    for (const [matchId, session] of this.sessions) {
      if (!session.players.has(userId)) continue;

      if (session.mode === 'pve') {
        // PvE: immediate teardown. Human leaving voluntarily gets a game:end.
        clearTimeout(session.disconnectTimer);
        clearInterval(session.interval);
        this.sessions.delete(matchId);
        const { score } = session.game.getState();
        this.send({ type: 'game:end', to: [userId], payload: { matchId, winnerId: AI_BOT_USER_ID, score, reason: 'forfeit' } });
        this.send({ type: 'ai-bot:sessionEnd', payload: { matchId } });
        return;
      }

      // Cancel any grace timer already armed from the opponent's prior disconnect to prevent a double forfeit.
      clearTimeout(session.disconnectTimer);
      clearInterval(session.interval);
      this.sessions.delete(matchId);
      const { score } = session.game.getState();
      this.emitForfeit(matchId, session.players, session.userIds, userId, score, session.startedAt);
      return;
    }

    // Pending session: reuse the existing passive-disconnect path.
    // startSession already fires emitForfeit at startsAt — exactly one call site, no new fields needed.
    this.handlePlayerDisconnect(userId);
  }

  handlePlayerConnect(userId: number): void {
    // ── Active session ───────────────────────────────────────────────────────────
    for (const [matchId, session] of this.sessions.entries()) {
      if (session.disconnectedUserId !== userId) continue;

      clearTimeout(session.disconnectTimer);
      session.disconnectTimer    = undefined;
      session.disconnectedUserId = undefined;
      session.game.resume();

      const state = session.game.getState();
      this.send({ type: 'game:resumed', to: session.userIds, payload: { matchId, players: Object.fromEntries(session.players), ...state } });
      return;
    }

    // ── Pending session (player reconnects during countdown) ─────────────────────
    for (const [matchId, pending] of this.pendingMatchIds.entries()) {
      if (pending.disconnectedUserId !== userId) continue;
      pending.disconnectedUserId = undefined;

      if (pending.mode === 'pve') {
        // Re-send match:matched so the human sees CountdownOverlay instead of Lobby.
        this.send({ type: 'match:matched', to: [userId], payload: { matchId, players: Object.fromEntries(pending.players), startsAt: pending.startsAt } });
        return;
      }

      // Re-send match:matched to the reconnecting player only. Their store was wiped
      // by the reload (phase reset to 'idle'), so they need the match context again
      // to land on CountdownOverlay rather than the Lobby. startSession still fires
      // at startsAt; the first game:state frame transitions matched → playing as normal.
      this.send({ type: 'match:matched', to: [userId], payload: { matchId, players: Object.fromEntries(pending.players), startsAt: pending.startsAt } });
      return;
    }
  }

  getSession(matchId: number): Session | undefined {
    return this.sessions.get(matchId);
  }

  sessionCount(): number {
    return this.sessions.size;
  }

  private generatePveMatchId(): number {
    // Use the upper half of the 32-bit int range to avoid any collision with
    // Postgres serial IDs (which start at 1 and grow upward).
    let matchId: number;
    do {
      matchId = Math.floor(Math.random() * 2 ** 31) + 2 ** 31;
    } while (this.sessions.has(matchId) || this.pendingMatchIds.has(matchId));
    return matchId;
  }

  private emitForfeit(
    matchId:            number,
    players:            Map<number, 'left' | 'right'>,
    userIds:            [number, number],
    disconnectedUserId: number,
    score:              { left: number; right: number },
    startedAt:          Date,
  ): void {
    const winnerId = userIds.find((id) => id !== disconnectedUserId)!;
    this.send({ type: 'match:result', payload: {
      matchId,
      players:   Object.fromEntries(players),
      winnerId,
      score,
      status:    'forfeit',
      startedAt: startedAt.toISOString(),
      endedAt:   new Date().toISOString(),
    }});
    this.send({ type: 'game:end', to: userIds, payload: { matchId, winnerId, score, reason: 'forfeit' } });
  }
}
