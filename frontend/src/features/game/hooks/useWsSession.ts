import { useEffect, useRef } from 'react';
import { connectWs, disconnectWs, onWsMessage, sendWs } from '../../../shared/ws/wsClient';
import { useGameStore } from '../state/gameStore';
import type { GameStatePayload, GameResumedPayload } from '../../../shared/ws/wsMessages';

interface WsSessionCallbacks {
  onConnected:     (userId: number) => void;
  onMatchMatched:  (matchId: number, players: Record<string, 'left' | 'right'>, startsAt: string) => void;
  onMatchRejected: (message: string) => void;
  onGameState:     (snapshot: GameStatePayload) => void;
  onGamePaused:    (disconnectedUserId: number, graceEndsAt: string) => void;
  onGameResumed:   (payload: GameResumedPayload) => void;
  onGameEnd:       (winnerId: number, reason: 'completed' | 'forfeit', score: { left: number; right: number }) => void;
}

// Manages the full WS lifecycle for a game session: connect on mount, register
// all 7 message subscriptions, and on unmount send the phase-appropriate farewell
// message, reset the store, then disconnect. The callbacks ref pattern keeps the
// effect dependency array empty (no re-subscription on re-render) while always
// calling the latest closure the component passed in.
export function useWsSession(callbacks: WsSessionCallbacks): void {
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  useEffect(() => {
    connectWs();

    const unsubs = [
      onWsMessage('connected',      (msg) => cbRef.current.onConnected(Number(msg.payload.userId))),
      onWsMessage('match:matched',  (msg) =>
        cbRef.current.onMatchMatched(msg.payload.matchId, msg.payload.players, msg.payload.startsAt)),
      onWsMessage('match:rejected', (msg) => cbRef.current.onMatchRejected(msg.payload.message)),
      onWsMessage('game:state',     (msg) => cbRef.current.onGameState(msg.payload)),
      onWsMessage('game:paused',    (msg) =>
        cbRef.current.onGamePaused(msg.payload.disconnectedUserId, msg.payload.graceEndsAt)),
      onWsMessage('game:resumed',   (msg) => cbRef.current.onGameResumed(msg.payload)),
      onWsMessage('game:end',       (msg) =>
        cbRef.current.onGameEnd(msg.payload.winnerId, msg.payload.reason, msg.payload.score)),
    ];

    return () => {
      unsubs.forEach((unsub) => unsub());
      const phase = useGameStore.getState().phase;
      if (phase === 'queued') {
        sendWs({ type: 'match:cancel' });
      } else if (phase === 'matched' || phase === 'playing' || phase === 'paused') {
        sendWs({ type: 'game:leave' });
      }
      useGameStore.getState().reset();
      disconnectWs();
    };
  }, []);
}
