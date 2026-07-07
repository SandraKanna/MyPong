import { useState, useEffect } from 'react';
import { useGameStore } from '../state/gameStore';

export default function PauseOverlay() {
  // GamePage only renders this when phase === 'paused', so these fields exist.
  const disconnectedUserId = useGameStore((s) => s.phase === 'paused' ? s.disconnectedUserId : null);
  const graceEndsAt        = useGameStore((s) => s.phase === 'paused' ? s.graceEndsAt : null);

  // STUDY: useState(() => expr) lazy initializer — runs once on mount to avoid
  // recomputing the initial value on every render (same pattern as CountdownOverlay).
  const [remaining, setRemaining] = useState(() =>
    graceEndsAt
      ? Math.ceil((new Date(graceEndsAt).getTime() - Date.now()) / 1000)
      : 0,
  );

  useEffect(() => {
    if (!graceEndsAt) return;
    const id = setInterval(() => {
      const next = Math.ceil((new Date(graceEndsAt).getTime() - Date.now()) / 1000);
      setRemaining(next);
      // Stop the interval at zero. The actual phase transition out of 'paused'
      // is driven by game:resumed or the next game:state frame (both already
      // handled in gameStore's handleGameState / handleGameResumed). This
      // component is purely visual — it never dispatches any store action.
      if (next <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [graceEndsAt]);

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.75)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#1a1a1a', color: '#fff',
        padding: '2rem 3rem', borderRadius: '12px', textAlign: 'center',
      }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>Paused</h2>
        <p>Player {disconnectedUserId} disconnected</p>
        <p>Waiting for reconnect… {Math.max(remaining, 0)}s</p>
      </div>
    </div>
  );
}
