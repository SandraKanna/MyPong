import type { WsEnvelope } from '@mypong/types';
import { Game } from '../physics/game';

export interface Session {
  game:              Game;
  players:           Map<number, 'left' | 'right'>;
  userIds:           [number, number];
  interval:          ReturnType<typeof setInterval>;
  startedAt:         Date;
  disconnectedUserId?: number;
  disconnectTimer?:    ReturnType<typeof setTimeout>;
}

interface PendingMatch {
  userIds:             [number, number];
  startsAt:            string;
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

    const pendingEntry: PendingMatch = { userIds, startsAt };
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

      this.sessions.set(matchId, { game, players, userIds, interval, startedAt });
    };

    if (delay > 0) {
      setTimeout(startSession, delay);
    } else {
      startSession(); // synchronous — preserves existing test behaviour (no timer advance needed)
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

  handlePlayerDisconnect(userId: number): void {
    // ── Active session ───────────────────────────────────────────────────────────
    for (const [matchId, session] of this.sessions) {
      if (!session.players.has(userId)) continue;
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

      const opponentId = pending.userIds.find((id) => id !== userId)!;
      // No separate timer: startSession already fires at startsAt, which is the
      // natural grace deadline. Use startsAt directly as graceEndsAt.
      this.send({ type: 'game:paused', to: [opponentId],
        payload: { matchId, disconnectedUserId: userId, graceEndsAt: pending.startsAt } });
      return;
    }
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
      this.send({ type: 'game:resumed', to: session.userIds, payload: { matchId, ...state } });
      return;
    }

    // ── Pending session (player reconnects during countdown) ─────────────────────
    for (const pending of this.pendingMatchIds.values()) {
      if (pending.disconnectedUserId !== userId) continue;
      pending.disconnectedUserId = undefined;
      // No game:resumed — the game hasn't started yet. startSession will create the
      // session normally at startsAt; the first game:state is the implicit signal.
      return;
    }
  }

  getSession(matchId: number): Session | undefined {
    return this.sessions.get(matchId);
  }

  sessionCount(): number {
    return this.sessions.size;
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
