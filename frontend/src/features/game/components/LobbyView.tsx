interface LobbyViewProps {
  phase: 'idle' | 'queued';
  rejectedMessage: string | null;
  onFindMatch: () => void;
  onCancel: () => void;
}

// Pure presentational component — no store access, no WS calls.
// All side effects live in GamePage and arrive via props.
export default function LobbyView({ phase, rejectedMessage, onFindMatch, onCancel }: LobbyViewProps) {
  if (phase === 'queued') {
    return (
      <div>
        <p>Looking for an opponent…</p>
        <button onClick={onCancel}>Cancel button</button>
      </div>
    );
  }

  return (
    <div>
      <h1>Find a Match title</h1>
      <button onClick={onFindMatch}>Find Match button</button>
      {/* STUDY: JSX short-circuit — `a && b` evaluates b only if a is truthy.
          null/undefined on the right renders nothing; a string renders as text. */}
      {rejectedMessage && <p role="alert">{rejectedMessage}</p>}
    </div>
  );
}
