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
    <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center">
      <div className="bg-surface-raised border border-border px-12 py-8 text-center flex flex-col gap-4">
        <h2 className="font-display text-fg text-xl uppercase tracking-widest">Paused</h2>
        <p className="font-sans text-muted">Player {disconnectedUserId} disconnected</p>
        <p className="font-sans text-muted">
          Waiting for reconnect… <span className="font-display text-primary">{Math.max(remaining, 0)}s</span>
        </p>
      </div>
    </div>
  );
}
