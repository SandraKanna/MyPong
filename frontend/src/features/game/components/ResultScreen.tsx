import { useGameStore } from '../state/gameStore';
import { useMyDisplayName } from '../../profile/state/profileState';

// Heading copy table — reason × didWin. Score is always shown regardless of reason.
const HEADINGS: Record<'completed' | 'forfeit', Record<'win' | 'lose', string>> = {
  completed: { win: 'You win!',          lose: 'You lose.'          },
  forfeit:   { win: 'Forfeit — you win.', lose: 'Forfeit — you lose.' },
};

export default function ResultScreen() {
  // GamePage only renders this when phase === 'ended', so all fields are present.
  // The null guard also covers the brief re-render window after reset() fires.
  const ended = useGameStore((s) => s.phase === 'ended' ? s : null);
  const myName = useMyDisplayName();
  if (!ended) return null;
  const { winnerId, reason, score, myUserId, players, opponentUsername } = ended;

  const didWin  = winnerId === myUserId;
  const heading = HEADINGS[reason][didWin ? 'win' : 'lose'];
  // players is kept specifically so this screen can label each side — same
  // String() lookup gameStore itself uses (JSON always stringifies object keys).
  const mySide = players[String(myUserId)];
  const opponentName = opponentUsername ?? 'Opponent';
  const leftName  = mySide === 'left'  ? myName : opponentName;
  const rightName = mySide === 'left'  ? opponentName : myName;

  return (
    <div className="flex flex-col items-center gap-8 py-16">
      <h2 className={`font-display text-4xl uppercase tracking-widest ${didWin ? 'text-success' : 'text-muted'}`}>
        {heading}
      </h2>
      <p className="font-sans text-muted text-sm">{leftName} vs {rightName}</p>
      <p className="font-display text-2xl text-fg">{score.left} – {score.right}</p>
      <button
        onClick={() => useGameStore.getState().reset()}
        className="bg-primary text-primary-fg font-display text-sm uppercase tracking-wide py-2 px-6 hover:bg-primary-hover transition-colors"
      >
        Play Again
      </button>
    </div>
  );
}
