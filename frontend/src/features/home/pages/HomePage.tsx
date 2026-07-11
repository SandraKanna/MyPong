import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { loginAsGuest } from '../../auth/api/auth';
import { useGameStore } from '../../game/state/gameStore';
import { useWsSession } from '../../game/hooks/useWsSession';
import { sendWs } from '../../../shared/ws/wsClient';
import GameBoard from '../../game/components/GameBoard';

// Physics constants mirrored from game-service DEFAULT_PHYSICS_CONFIG.
// Update here manually if any TUNE: value changes there.
const FIELD_W        = 800;
const FIELD_H        = 600;
const BALL_R         = 10;
const PADDLE_W       = 12;
const PADDLE_H       = 80;
const LEFT_PADDLE_X  = 20;
const RIGHT_PADDLE_X = 768; // fieldWidth - paddleXOffset - paddleWidth
const PADDLE_Y_INIT  = 260; // (fieldHeight - paddleHeight) / 2

// Static SVG preview — shown when no guest session is active.
function BoardPreview() {
  return (
    <svg
      viewBox={`0 0 ${FIELD_W} ${FIELD_H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      className="block bg-black"
    >
      <line
        x1={FIELD_W / 2} y1={0}
        x2={FIELD_W / 2} y2={FIELD_H}
        stroke="#ffffff" strokeOpacity={0.3} strokeWidth={4} strokeDasharray="16 20"
      />
      <text x={FIELD_W / 4}     y={50} textAnchor="middle" fill="#05d9e8" fontSize={40} fontFamily="'Press Start 2P', monospace">0</text>
      <text x={FIELD_W * 3 / 4} y={50} textAnchor="middle" fill="#05d9e8" fontSize={40} fontFamily="'Press Start 2P', monospace">0</text>
      <circle cx={FIELD_W / 2} cy={FIELD_H / 2} r={BALL_R} fill="#fff" />
      <rect x={LEFT_PADDLE_X}  y={PADDLE_Y_INIT} width={PADDLE_W} height={PADDLE_H} fill="#fff" />
      <rect x={RIGHT_PADDLE_X} y={PADDLE_Y_INIT} width={PADDLE_W} height={PADDLE_H} fill="#fff" />
    </svg>
  );
}

// Inline countdown shown over the static preview during the 3-second 'matched' window.
// CountdownOverlay is full-viewport and can't be embedded here.
function InlineCountdown({ startsAt }: { startsAt: string }) {
  const [remaining, setRemaining] = useState(() =>
    Math.ceil((new Date(startsAt).getTime() - Date.now()) / 1000),
  );
  useEffect(() => {
    const id = setInterval(() => {
      const next = Math.ceil((new Date(startsAt).getTime() - Date.now()) / 1000);
      setRemaining(next);
      if (next <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [startsAt]);
  return <p className="font-display text-8xl text-primary">{Math.max(remaining, 0)}</p>;
}

// Active guest session — mounted only while a PvE game is in progress.
// Unmounting this component triggers useWsSession cleanup: game:leave if
// applicable, store reset, disconnectWs.
function GuestMatchView({ onExit }: { onExit: () => void }) {
  const phase    = useGameStore((s) => s.phase);
  const startsAt = useGameStore((s) => s.phase === 'matched' ? s.startsAt : null);
  const winnerId = useGameStore((s) => s.phase === 'ended' ? s.winnerId : null);
  const myUserId = useGameStore((s) => s.myUserId);

  useWsSession({
    onConnected: (userId) => {
      useGameStore.getState().setConnected(userId);
      // Fire game:startAI immediately on connection — the earliest moment the
      // socket is authenticated and sendWs is guaranteed to succeed.
      sendWs({ type: 'game:startAI', payload: { difficulty: 'normal' } });
    },
    onMatchMatched:  (matchId, players, startsAt) =>
      useGameStore.getState().handleMatchMatched(matchId, players, startsAt),
    onMatchRejected: (msg) => useGameStore.getState().handleMatchRejected(msg),
    onGameState:    (snap)          => useGameStore.getState().handleGameState(snap),
    onGamePaused:   (uid, at)       => useGameStore.getState().handleGamePaused(uid, at),
    onGameResumed:  (pay)           => useGameStore.getState().handleGameResumed(pay),
    onGameEnd:      (wid, r, score) => useGameStore.getState().handleGameEnd(wid, r, score),
  });

  // 'playing' and 'paused': GameBoard renders an SVG with width="100%" —
  // same dimensions as the static preview, fits the container identically.
  // PauseOverlay is fixed/full-viewport so is omitted here; 'paused' is also
  // unreachable in practice for PvE (game:paused targets the opponent, not the human).
  if (phase === 'playing' || phase === 'paused') {
    return <GameBoard />;
  }

  // 'ended': minimal result + exit — no full ResultScreen, no score breakdown.
  if (phase === 'ended') {
    const won = winnerId === myUserId;
    return (
      <div className="relative w-full">
        <BoardPreview />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70">
          <p className="font-display text-primary text-3xl uppercase tracking-widest">
            {won ? 'You Win' : 'You Lose'}
          </p>
          <button
            onClick={onExit}
            className="border border-accent text-accent font-display text-sm uppercase tracking-wide py-2 px-6 hover:bg-accent hover:text-bg transition-colors"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  // 'idle' (connecting) and 'matched' (countdown): static preview with overlay.
  return (
    <div className="relative w-full">
      <BoardPreview />
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50">
        {phase === 'matched' && startsAt
          ? <InlineCountdown startsAt={startsAt} />
          : <p className="font-sans text-muted text-sm">Connecting…</p>
        }
      </div>
    </div>
  );
}

type GuestPhase = 'idle' | 'loading' | 'active';

export default function HomePage() {
  const [guestPhase, setGuestPhase] = useState<GuestPhase>('idle');
  const [error,      setError]      = useState<string | null>(null);

  async function handlePlay() {
    setGuestPhase('loading');
    setError(null);
    try {
      await loginAsGuest();
      setGuestPhase('active');
    } catch {
      setError('Could not start guest session — please try again.');
      setGuestPhase('idle');
    }
  }

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center gap-10 px-4 py-16">
      <div className="flex flex-col items-center gap-2">
        <p className="font-sans text-muted text-xl">Welcome to</p>
        <h1 className="font-display text-primary text-5xl md:text-6xl uppercase tracking-widest">MyPong</h1>
      </div>

      <p className="font-sans text-fg text-base max-w-xl text-center">
        A real-time multiplayer Pong game with 1v1 matchmaking, player profiles, and match statistics.
        Built as a portfolio project using React, Node.js/Fastify, PostgreSQL, and Docker in a
        microservices architecture.
      </p>

      <div className="flex gap-4">
        <Link
          to="/login"
          className="bg-primary text-primary-fg font-display text-sm uppercase tracking-wide py-2 px-6 hover:bg-primary-hover transition-colors"
        >
          Log In
        </Link>
        <Link
          to="/register"
          className="border border-accent text-accent font-display text-sm uppercase tracking-wide py-2 px-6 hover:bg-accent hover:text-bg transition-colors"
        >
          Create Account
        </Link>
      </div>
      <p className="font-sans text-fg text-base max-w-xl text-center">
        Create an account to unlock the full experience — JWT-secured PvP matchmaking, 
        AI opponents with adjustable difficulty, and persistent profiles with match history. 
        Or skip straight to a quick AI match below, no signup required.
      </p>

      {/* Guest PvE entry — static board preview with Play button, or active match inline */}
      <div className="flex flex-col items-center gap-3 w-full max-w-lg">
        <h2 className="font-display text-muted text-sm uppercase tracking-widest">Play vs AI — No Account Required</h2>

        {guestPhase === 'active' ? (
          <GuestMatchView onExit={() => setGuestPhase('idle')} />
        ) : (
          <div className="relative w-full">
            <BoardPreview />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/50">
              {error && (
                <p role="alert" className="font-sans text-danger text-xs">{error}</p>
              )}
              <button
                onClick={() => void handlePlay()}
                disabled={guestPhase === 'loading'}
                className="bg-primary text-primary-fg font-display text-sm uppercase tracking-wide py-2 px-8 hover:bg-primary-hover transition-colors disabled:opacity-50"
              >
                {guestPhase === 'loading' ? 'Starting…' : 'Play vs AI'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
