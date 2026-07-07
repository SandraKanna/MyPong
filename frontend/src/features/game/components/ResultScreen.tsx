import { useGameStore } from '../state/gameStore';

// Heading copy table — reason × didWin. Score is always shown regardless of reason.
const HEADINGS: Record<'completed' | 'forfeit', Record<'win' | 'lose', string>> = {
  completed: { win: 'You win!',          lose: 'You lose.'          },
  forfeit:   { win: 'Forfeit — you win.', lose: 'Forfeit — you lose.' },
};

export default function ResultScreen() {
  // GamePage only renders this when phase === 'ended', so all fields are present.
  // The null guard also covers the brief re-render window after reset() fires.
  const ended = useGameStore((s) => s.phase === 'ended' ? s : null);
  if (!ended) return null;
  const { winnerId, reason, score, myUserId } = ended;

  const didWin  = winnerId === myUserId;
  const heading = HEADINGS[reason][didWin ? 'win' : 'lose'];

  return (
    <div>
      <h2>{heading}</h2>
      <p>{score.left} – {score.right}</p>
      <button onClick={() => useGameStore.getState().reset()}>Play again</button>
    </div>
  );
}
