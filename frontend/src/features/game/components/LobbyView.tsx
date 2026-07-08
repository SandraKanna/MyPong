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
      <div className="flex flex-col items-center gap-8 py-16">
        <p className="font-sans text-muted">Looking for an opponent…</p>
        <button
          onClick={onCancel}
          className="font-sans text-sm border border-accent text-accent px-6 py-2 hover:bg-accent hover:text-bg transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-8 py-16">
      <h1 className="font-display text-fg text-lg uppercase tracking-widest">Find a Match</h1>
      <button
        onClick={onFindMatch}
        className="bg-primary text-primary-fg font-display text-sm uppercase tracking-wide py-2 px-6 hover:bg-primary-hover transition-colors"
      >
        Find Match
      </button>
      {/* STUDY: JSX short-circuit — `a && b` evaluates b only if a is truthy.
          null/undefined on the right renders nothing; a string renders as text. */}
      {rejectedMessage && (
        <p role="alert" className="font-sans text-danger text-sm">{rejectedMessage}</p>
      )}
    </div>
  );
}
