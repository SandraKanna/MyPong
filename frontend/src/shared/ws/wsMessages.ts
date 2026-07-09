// ── Shared payload shape ──────────────────────────────────────────────────────
// game:state carries the base shape. game:resumed extends it with `players` so
// the frontend can rehydrate mySide after a full page reload.
export interface GameStatePayload {
  matchId:  number;
  ball:     { x: number; y: number };
  paddles:  { leftY: number; rightY: number };
  score:    { left: number; right: number };
}

export type GameResumedPayload = GameStatePayload & { players: Record<string, 'left' | 'right'> };

// ── Incoming (server → browser) ───────────────────────────────────────────────
// gateway-ws strips the `to` field before delivery, so browser-side types have none.
// `players` keys are strings — JSON always serialises object keys as strings.

export type ConnectedMessage     = { type: 'connected';      payload: { userId: string } };
export type MatchMatchedMessage  = { type: 'match:matched';  payload: { matchId: number; players: Record<string, 'left' | 'right'>; startsAt: string } };
export type MatchRejectedMessage = { type: 'match:rejected'; payload: { reason: string; message: string } };
export type GameStateMessage     = { type: 'game:state';     payload: GameStatePayload };
export type GamePausedMessage    = { type: 'game:paused';    payload: { matchId: number; disconnectedUserId: number; graceEndsAt: string } };
export type GameResumedMessage   = { type: 'game:resumed';   payload: GameResumedPayload };
export type GameEndMessage       = { type: 'game:end';       payload: { matchId: number; winnerId: number; score: { left: number; right: number }; reason: 'completed' | 'forfeit' } };

export type IncomingMessage =
  | ConnectedMessage
  | MatchMatchedMessage
  | MatchRejectedMessage
  | GameStateMessage
  | GamePausedMessage
  | GameResumedMessage
  | GameEndMessage;

// ── Outgoing (browser → gateway-ws) ──────────────────────────────────────────
// gateway-ws injects userId from the JWT and ignores any client-supplied value.
// No userId field belongs on any browser-originated message.

export type MatchJoinMessage   = { type: 'match:join' };
export type MatchCancelMessage = { type: 'match:cancel' };
export type GameLeaveMessage   = { type: 'game:leave' };
export type GameInputMessage   = { type: 'game:input'; payload: { matchId: number; direction: 'up' | 'down' | 'stop' } };

export type OutgoingMessage = MatchJoinMessage | MatchCancelMessage | GameLeaveMessage | GameInputMessage;
