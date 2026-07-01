import type { WsEnvelope } from '@mypong/types';
import { Game } from '../physics/game';

export interface Session {
  game:     Game;
  players:  Map<number, 'left' | 'right'>;
  userIds:  [number, number];
  interval: ReturnType<typeof setInterval>;
}

interface Opts {
  tickIntervalMs?: number;
  gameFactory?:    () => Game;
}

interface AssignPayload {
  matchId: number;
  players: Record<string, string>;
}

interface InputPayload {
  matchId:   number;
  direction: string;
}

export class GameSessionManager {
  private readonly send:           (envelope: WsEnvelope) => void;
  private readonly tickIntervalMs: number;
  private readonly gameFactory:    () => Game;
  private readonly sessions:       Map<number, Session> = new Map();

  constructor(send: (envelope: WsEnvelope) => void, opts?: Opts) {
    this.send           = send;
    this.tickIntervalMs = opts?.tickIntervalMs ?? 16;
    this.gameFactory    = opts?.gameFactory    ?? (() => new Game());
  }

  handleAssign(envelope: WsEnvelope): void {
    const payload = envelope.payload as AssignPayload | undefined;
    if (!payload || typeof payload.matchId !== 'number') return;

    const { matchId, players: rawPlayers } = payload;
    // A duplicate assign would leak an orphaned Game + interval whose messages
    // reference a matchId that is no longer tracked anywhere.
    if (this.sessions.has(matchId)) return;
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

    const userIds = [...players.keys()] as [number, number];
    const game    = this.gameFactory();

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
        this.send({ type: 'match:result', payload: { matchId, winnerId, score } });

        this.send({ type: 'game:end', to: userIds, payload: { matchId, winnerId, score } });
      }
    }, this.tickIntervalMs);

    this.sessions.set(matchId, { game, players, userIds, interval });
  }

  handleInput(envelope: WsEnvelope): void {
    const payload = envelope.payload as InputPayload | undefined;
    if (!payload || typeof payload.matchId !== 'number') return;

    const { matchId, direction } = payload;
    if (direction !== 'up' && direction !== 'down' && direction !== 'stop') return;

    const session = this.sessions.get(matchId);
    if (!session) return;

    const { userId } = envelope;
    if (userId === undefined) return;

    const side = session.players.get(userId);
    if (!side) return;

    session.game.setPaddleDirection(side, direction);
  }

  getSession(matchId: number): Session | undefined {
    return this.sessions.get(matchId);
  }

  sessionCount(): number {
    return this.sessions.size;
  }
}
