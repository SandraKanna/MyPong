import { useState } from 'react';
import { sendWs } from '../../../shared/ws/wsClient';
import { useGameStore } from '../state/gameStore';
import { useWsSession } from '../hooks/useWsSession';
import { useMyDisplayName } from '../../profile/state/profileState';
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

  const myName = useMyDisplayName();

  useWsSession({
    onConnected:     (userId) => useGameStore.getState().setConnected(userId),
    onMatchMatched:  (matchId, players, startsAt) =>
      useGameStore.getState().handleMatchMatched(matchId, players, startsAt),
    onMatchRejected: (msg) => {
      useGameStore.getState().handleMatchRejected(msg);
      setRejectedMessage(msg);
    },
    onGameState:    (snap)          => useGameStore.getState().handleGameState(snap),
    onGamePaused:   (uid, at)       => useGameStore.getState().handleGamePaused(uid, at),
    onGameResumed:  (pay)           => useGameStore.getState().handleGameResumed(pay),
    onGameEnd:      (wid, r, score) => useGameStore.getState().handleGameEnd(wid, r, score),
  });

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

  function handleStartAI(difficulty: 'easy' | 'normal' | 'hard') {
    setRejectedMessage(null);
    // game-service creates the ephemeral session and replies with match:matched,
    // which drives idle → matched directly (no setQueued step needed).
    sendWs({ type: 'game:startAI', payload: { difficulty } });
  }

  if (phase === 'idle' || phase === 'queued') {
    return (
      <LobbyView
        phase={phase}
        rejectedMessage={rejectedMessage}
        myName={myName}
        onFindMatch={handleFindMatch}
        onCancel={handleCancel}
        onStartAI={handleStartAI}
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
