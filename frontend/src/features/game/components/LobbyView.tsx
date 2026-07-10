import { useState } from 'react';

type Difficulty = 'easy' | 'normal' | 'hard';

interface LobbyViewProps {
  phase: 'idle' | 'queued';
  rejectedMessage: string | null;
  onFindMatch: () => void;
  onCancel: () => void;
  onStartAI: (difficulty: Difficulty) => void;
}

// Pure presentational component — no store access, no WS calls.
// All side effects live in GamePage and arrive via props.
export default function LobbyView({ phase, rejectedMessage, onFindMatch, onCancel, onStartAI }: LobbyViewProps) {
  // Difficulty selection lives here: GamePage only needs the value at click time.
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');

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
    <div className="flex flex-col items-center gap-12 py-16">
      {/* PvP section */}
      <div className="flex flex-col items-center gap-4">
        <h1 className="font-display text-fg text-lg uppercase tracking-widest">Find a Match</h1>
        <button
          onClick={onFindMatch}
          className="bg-primary text-primary-fg font-display text-sm uppercase tracking-wide py-2 px-6 hover:bg-primary-hover transition-colors"
        >
          Find Match
        </button>
      </div>

      <div className="border-t border-border w-32" />

      {/* PvE section */}
      <div className="flex flex-col items-center gap-4">
        <h2 className="font-display text-fg text-lg uppercase tracking-widest">Play vs AI</h2>
        <div className="flex gap-2">
          {(['easy', 'normal', 'hard'] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDifficulty(d)}
              className={[
                'font-sans text-sm px-4 py-1 border transition-colors capitalize',
                difficulty === d
                  ? 'border-primary bg-primary text-primary-fg'
                  : 'border-border text-muted hover:border-accent hover:text-accent',
              ].join(' ')}
            >
              {d}
            </button>
          ))}
        </div>
        <button
          onClick={() => onStartAI(difficulty)}
          className="bg-primary text-primary-fg font-display text-sm uppercase tracking-wide py-2 px-6 hover:bg-primary-hover transition-colors"
        >
          Play vs AI
        </button>
      </div>

      {/* STUDY: JSX short-circuit — `a && b` evaluates b only if a is truthy.
          null/undefined on the right renders nothing; a string renders as text. */}
      {rejectedMessage && (
        <p role="alert" className="font-sans text-danger text-sm">{rejectedMessage}</p>
      )}
    </div>
  );
}
