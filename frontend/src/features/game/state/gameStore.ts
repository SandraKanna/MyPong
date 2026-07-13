import { create } from 'zustand';
import type { GameStatePayload, GameResumedPayload } from '../../../shared/ws/wsMessages';
import { useAuthStore } from '../../auth/state/authState';
import { disconnectWs, sendWs } from '../../../shared/ws/wsClient';
import { lookupUsernames } from '../../profile/api/profile';

// Sentinel userId for the AI opponent's paddle in PvE sessions — duplicated
// from ai-bot-service (no shared package between frontend and backend), same
// convention as GameBoard's duplicated physics constants. Never a real userId
// (Postgres ids start at 1, guest ids are always negative).
const AI_BOT_USER_ID = 0;

// ── Phase shapes ──────────────────────────────────────────────────────────────

// STUDY: `phase` is a discriminant field — each interface has a different
// literal type for it. TypeScript uses that to narrow the union: inside
// `if (state.phase === 'playing')`, state is automatically PlayingPhase,
// so fields like `mySide` that don't exist on other phases become accessible.
export type GameState =
  | IdlePhase
  | QueuedPhase
  | MatchedPhase
  | PlayingPhase
  | PausedPhase
  | EndedPhase;

interface IdlePhase {
  phase: 'idle';
  myUserId: number | null; // null until the first 'connected' WS message arrives
  opponentUsername: string | null; // null outside an active match
}

interface QueuedPhase {
  phase: 'queued';
  myUserId: number;
  opponentUsername: string | null;
}

interface MatchedPhase {
  phase: 'matched';
  myUserId: number;
  matchId: number;
  players: Record<string, 'left' | 'right'>;
  startsAt: string; // ISO timestamp — raw, component computes countdown from this
  opponentUsername: string | null; // null until the batch lookup (or the AI_BOT_USER_ID special case) resolves
}

interface PlayingPhase {
  phase: 'playing';
  myUserId: number;
  matchId: number;
  players: Record<string, 'left' | 'right'>;
  mySide: 'left' | 'right';
  snapshot: GameStatePayload | null; // null until first game:state frame
  opponentUsername: string | null;
}

interface PausedPhase {
  phase: 'paused';
  myUserId: number;
  matchId: number;
  players: Record<string, 'left' | 'right'>;
  mySide: 'left' | 'right';
  snapshot: GameStatePayload | null;
  disconnectedUserId: number;
  graceEndsAt: string; // ISO timestamp — raw, component computes time remaining
  opponentUsername: string | null;
}

interface EndedPhase {
  phase: 'ended';
  myUserId: number;
  winnerId: number;
  reason: 'completed' | 'forfeit';
  score: { left: number; right: number };
  players: Record<string, 'left' | 'right'>; // kept so result screen can label sides
  opponentUsername: string | null;
}

export type GamePhase = GameState['phase'];

// ── Actions ───────────────────────────────────────────────────────────────────

interface GameActions {
  setConnected: (userId: number) => void;
  setQueued: () => void;
  cancelQueued: () => void;
  handleMatchMatched: (matchId: number, players: Record<string, 'left' | 'right'>, startsAt: string) => void;
  handleMatchRejected: (message: string) => void;
  handleGameState: (snapshot: GameStatePayload) => void;
  handleGamePaused: (disconnectedUserId: number, graceEndsAt: string) => void;
  handleGameResumed: (payload: GameResumedPayload) => void;
  handleGameEnd: (winnerId: number, reason: 'completed' | 'forfeit', score: { left: number; right: number }) => void;
  reset: () => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

// STUDY: `create<T>()` returns a hook factory; calling it with `(set, get) => ...`
// produces the actual hook. The double-call `create<T>()((set, get) => ...)` is
// the curried form required for TypeScript to infer middleware types correctly —
// without it, strict mode breaks inference when middleware (like immer or devtools)
// is added later.
export const useGameStore = create<GameState & GameActions>()((set, get) => {
  // Resolves the opponent's display name for a just-started match. Fires and
  // forgets — the phase transition itself never waits on this, since it's
  // just a network call for a label, not something the match flow depends on.
  // Guards against a stale write: if the match ends and a new one starts
  // before this lookup's response comes back, the store will have moved on
  // to a brand-new `players` object (each match message constructs one fresh)
  // by the time we're ready to apply the result — the reference-equality
  // check below catches that and silently drops the stale result instead of
  // overwriting the newer match's opponent name. (EndedPhase has no matchId
  // field to compare against directly, which is why this checks the players
  // object's identity instead.)
  function resolveOpponentUsername(
    myUserId: number,
    players: Record<string, 'left' | 'right'>,
  ): void {
    // players' keys are userIds as strings (JSON always serialises object keys
    // as strings) — the opponent is whichever key isn't my own id.
    const opponentIdStr = Object.keys(players).find((id) => id !== String(myUserId));
    if (opponentIdStr === undefined) return; // shouldn't happen — players always has exactly 2 entries
    const opponentId = Number(opponentIdStr);

    function applyIfStillCurrentMatch(name: string): void {
      const current = get();
      const hasPlayers =
        current.phase === 'matched' ||
        current.phase === 'playing' ||
        current.phase === 'paused' ||
        current.phase === 'ended';
      if (hasPlayers && current.players === players) {
        set({ opponentUsername: name });
      }
    }

    if (opponentId === AI_BOT_USER_ID) {
      applyIfStillCurrentMatch('Computer'); // no lookup call for the bot — its id was never a real profile
      return;
    }

    void (async () => {
      try {
        const names = await lookupUsernames([opponentId]);
        // Same raw-id fallback convention as MatchHistoryTable: an opponent
        // with no profile row (e.g. never set a username) isn't an error.
        applyIfStillCurrentMatch(names.get(opponentId) ?? String(opponentId));
      } catch {
        applyIfStillCurrentMatch(String(opponentId));
      }
    })();
  }

  return {
    phase: 'idle',
    myUserId: null,
    opponentUsername: null,

    // STUDY: `get()` reads the current store state at call time, not at the time
    // the action was created. Using a closure variable would capture a stale
    // snapshot; `get()` always reflects the latest committed state.

    setConnected(userId) {
      // Updates myUserId in any phase — called on every WS 'connected' message,
      // including mid-game reconnects. No phase transition, only the field changes.
      // Zustand's set() shallow-merges by default (unlike React's setState, which
      // replaces the whole value) — no need to spread ...state here.
      set({ myUserId: userId });
    },

    setQueued() {
      const state = get();
      if (state.phase !== 'idle')
        return;
      if (state.myUserId === null)
        return; // no-op: 'connected' hasn't arrived yet, no real userId to carry forward
      set({ phase: 'queued', myUserId: state.myUserId, opponentUsername: null });
    },

    cancelQueued() {
      const state = get();
      if (state.phase !== 'queued')
        return;
      set({ phase: 'idle', myUserId: state.myUserId, opponentUsername: null });
    },

    handleMatchMatched(matchId, players, startsAt) {
      const state = get();
      // Also accepts 'idle' to handle cold-start rehydration: if the player
      // reloaded during the countdown, game-service re-sends match:matched on
      // reconnect so the store can land on CountdownOverlay instead of the Lobby.
      if (state.phase !== 'queued' && state.phase !== 'idle')
        return;
      if (state.myUserId === null)
        return; // 'connected' hasn't arrived yet — no userId to carry forward
      set({ phase: 'matched', myUserId: state.myUserId, matchId, players, startsAt, opponentUsername: null });
      resolveOpponentUsername(state.myUserId, players);
    },

    handleMatchRejected(message) {
      const state = get();
      if (state.phase !== 'queued')
        return;
      console.warn('[gameStore] match:rejected —', message); // not stored; no UI consumer yet
      set({ phase: 'idle', myUserId: state.myUserId, opponentUsername: null });
    },

    handleGameState(snapshot) {
      const state = get();
      if (state.phase === 'matched') {
        // The first real game:state from the server transitions matched -> playing.
        // CountdownOverlay is purely visual and never triggers this transition itself.
        // This also correctly handles countdown-window forfeits: if the match ended
        // before any game:state arrived, game:end transitions to 'ended' instead,
        // and this branch is simply never reached.
        // JSON always serialises object keys as strings, so the lookup must use String().
        // STUDY: `state.phase === 'matched'` already narrowed `state` to MatchedPhase,
        // so `state.players` and `state.myUserId` are accessible without optional chaining.
        const mySide = state.players[String(state.myUserId)];
        if (mySide !== 'left' && mySide !== 'right') {
          // Guard: never write undefined into a typed field — stay in 'matched'.
          console.warn('[gameStore] handleGameState: myUserId not found in players map, staying in matched');
          return;
        }
        set({
          phase: 'playing',
          myUserId: state.myUserId,
          matchId: state.matchId,
          players: state.players,
          mySide,
          snapshot,
          opponentUsername: state.opponentUsername,
        });
        return;
      }
      if (state.phase === 'playing') {
        set({ ...state, snapshot });
      }
      // 'paused' intentionally falls through as a no-op — game-service keeps
      // streaming frozen game:state frames during the grace window (physics are
      // suspended but the tick loop continues). Accepting them here would evict
      // PauseOverlay after a single tick (~16ms). The only exits from 'paused'
      // are handleGameResumed (opponent reconnects) and handleGameEnd (forfeit).
    },

    handleGamePaused(disconnectedUserId, graceEndsAt) {
      const state = get();
      if (state.phase !== 'playing')
        return;
      set({
        phase: 'paused',
        myUserId: state.myUserId,
        matchId: state.matchId,
        players: state.players,
        mySide: state.mySide,
        snapshot: state.snapshot,
        disconnectedUserId,
        graceEndsAt,
        opponentUsername: state.opponentUsername,
      });
    },

    handleGameResumed(payload) {
      const state = get();

      if (state.phase === 'idle' && state.myUserId !== null) {
        // Cold-start rehydration: a full page reload wiped React/Zustand state while
        // game-service kept the session alive. game:resumed now carries `players` so
        // mySide can be derived without a separate backend query. opponentUsername
        // was wiped by the same reload, so it's re-resolved from scratch here too.
        const mySide = payload.players[String(state.myUserId)];
        if (mySide !== 'left' && mySide !== 'right') {
          console.warn('[gameStore] handleGameResumed: myUserId not found in players, ignoring');
          return;
        }
        set({
          phase: 'playing',
          myUserId: state.myUserId,
          matchId: payload.matchId,
          players: payload.players,
          mySide,
          snapshot: payload,
          opponentUsername: null,
        });
        resolveOpponentUsername(state.myUserId, payload.players);
        return;
      }

      if (state.phase !== 'paused')
        return;
      set({
        phase: 'playing',
        myUserId: state.myUserId,
        matchId: state.matchId,
        players: state.players,
        mySide: state.mySide,
        snapshot: payload,
        opponentUsername: state.opponentUsername,
      });
    },

    handleGameEnd(winnerId, reason, score) {
      const state = get();
      if (state.phase !== 'playing' && state.phase !== 'paused' && state.phase !== 'matched')
        return;
      set({
        phase: 'ended',
        myUserId: state.myUserId,
        winnerId,
        reason,
        score,
        players: state.players,
        opponentUsername: state.opponentUsername,
      });
    },

    reset() {
      // Preserves myUserId so it's immediately available when setQueued() is
      // called for the next match without waiting for another 'connected' message.
      const { myUserId } = get() as { myUserId: number | null };
      set({ phase: 'idle', myUserId: myUserId ?? null, opponentUsername: null });
    },
  };
});

// Subscribes to authStore for the tab's lifetime — no unsubscribe needed,
// same lifespan as the store itself. Checks `status`, not `accessToken`, so
// a silent token refresh (accessToken changes, status stays 'authenticated')
// never resets the game store mid-match.
useAuthStore.subscribe((state, prevState) => {
  if (prevState.status === 'authenticated' && state.status !== 'authenticated') {
    const phase = useGameStore.getState().phase;
    if (phase === 'queued') {
      sendWs({ type: 'match:cancel' });
    } else if (phase === 'matched' || phase === 'playing' || phase === 'paused') {
      sendWs({ type: 'game:leave' });
    }
    disconnectWs();
    useGameStore.setState({ phase: 'idle', myUserId: null, opponentUsername: null });
  }
});
