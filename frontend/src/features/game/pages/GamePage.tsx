import { useEffect, useState } from 'react';
import { connectWs, disconnectWs, onWsMessage, sendWs } from '../../../shared/ws/wsClient';
import { useGameStore } from '../state/gameStore';
import LobbyView from '../components/LobbyView';
import CountdownOverlay from '../components/CountdownOverlay';
import GameBoard from '../components/GameBoard';
import PauseOverlay from '../components/PauseOverlay';
import ResultScreen from '../components/ResultScreen';

export default function GamePage() {
  // STUDY: useGameStore with a selector — the component re-renders only when
  // `phase` changes, not on every store update. Deep fields like `snapshot`
  // that update every frame won't cause this component to re-render.
  const phase = useGameStore((s) => s.phase);

  // startsAt is only needed in the 'matched' phase; read it unconditionally to
  // satisfy the Rules of Hooks (hooks can't be called conditionally).
  const startsAt = useGameStore((s) => s.phase === 'matched' ? s.startsAt : null);

  // Holds the most recent match:rejected message for the lobby to display.
  // Lives here (not in the store) because it's transient UI state — it clears
  // on the next "Find Match" click and doesn't need to survive navigation.
  const [rejectedMessage, setRejectedMessage] = useState<string | null>(null);

  // STUDY: [] as the dependency array means "run only on mount, never re-run on
  // re-renders" — equivalent to componentDidMount in class components. Omitting
  // the array entirely would re-run the effect on every render, re-subscribing
  // to every WS message type on each state change.
  useEffect(() => {
    // If returning to /game after leaving mid-queue or after a completed
    // match, clear the stale phase so the lobby shows fresh instead of a
    // leftover "Looking for an opponent…" or result screen.
    const staleOnMount = useGameStore.getState().phase;
    if (staleOnMount === 'queued' || staleOnMount === 'ended' || staleOnMount === 'matched') {
      useGameStore.getState().reset();
    }
    connectWs();

    const { setConnected, handleMatchMatched, handleMatchRejected, handleGameState,
            handleGamePaused, handleGameResumed, handleGameEnd } = useGameStore.getState();

    // Collect all unsubscribes so the cleanup can remove every handler at once.
    const unsubs = [
      onWsMessage('connected', (msg) => {
        // payload.userId is typed `string` in wsMessages.ts (JSON keys are strings)
        setConnected(Number(msg.payload.userId));
      }),
      onWsMessage('match:matched', (msg) => {
        handleMatchMatched(msg.payload.matchId, msg.payload.players, msg.payload.startsAt);
      }),
      onWsMessage('match:rejected', (msg) => {
        handleMatchRejected(msg.payload.message);
        setRejectedMessage(msg.payload.message);
      }),
      onWsMessage('game:state',   (msg) => handleGameState(msg.payload)),
      onWsMessage('game:paused',  (msg) => handleGamePaused(msg.payload.disconnectedUserId, msg.payload.graceEndsAt)),
      onWsMessage('game:resumed', (msg) => handleGameResumed(msg.payload)),
      onWsMessage('game:end',     (msg) => handleGameEnd(msg.payload.winnerId, msg.payload.reason, msg.payload.score)),
    ];

    return () => {
      unsubs.forEach((unsub) => unsub());
      disconnectWs();
    };
  }, []);

  function handleFindMatch() {
    setRejectedMessage(null); // clear any previous rejection before re-queuing
    // No connection guard here — setQueued()'s null-guard and sendWs()'s OPEN-check
    // already cover the "not connected yet" case (acknowledged design decision).
    sendWs({ type: 'match:join' });
    useGameStore.getState().setQueued();
  }

  function handleCancel() {
    sendWs({ type: 'match:cancel' });
    useGameStore.getState().cancelQueued();
  }

  if (phase === 'idle' || phase === 'queued') {
    return (
      <LobbyView
        phase={phase}
        rejectedMessage={rejectedMessage}
        onFindMatch={handleFindMatch}
        onCancel={handleCancel}
      />
    );
  }

  if (phase === 'matched' && startsAt) {
    return <CountdownOverlay startsAt={startsAt} />;
  }

  if (phase === 'playing') {
    return <GameBoard />;
  }

  if (phase === 'paused') {
    return (
      <>
        <GameBoard />
        <PauseOverlay />
      </>
    );
  }

  return <ResultScreen />;
}
