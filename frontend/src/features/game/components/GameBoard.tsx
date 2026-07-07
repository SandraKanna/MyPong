import { useEffect, useRef } from 'react';
import { useGameStore } from '../state/gameStore';
import { sendWs } from '../../../shared/ws/wsClient';

// Physics constants duplicated from game-service/src/physics/physicsConfig.ts
// DEFAULT_PHYSICS_CONFIG. No shared package exists for these — update manually
// here if any TUNE: value changes there.
const FIELD_W      = 800;
const FIELD_H      = 600;
const BALL_R       = 10;
const PADDLE_W     = 12;
const PADDLE_H     = 80;
const LEFT_PADDLE_X  = 20;
const RIGHT_PADDLE_X = 768; // fieldWidth - paddleXOffset - paddleWidth = 800 - 20 - 12

export default function GameBoard() {
  // GameBoard only renders when phase is 'playing' or 'paused' (GamePage
  // guarantees this), so snapshot and matchId are always present.
  const snapshot = useGameStore((s) =>
    s.phase === 'playing' || s.phase === 'paused' ? s.snapshot : null,
  );
  const matchId = useGameStore((s) =>
    s.phase === 'playing' || s.phase === 'paused' ? s.matchId : null,
  );
  const phase = useGameStore((s) => s.phase);

  // STUDY: useRef holds a value that persists across renders without causing
  // re-renders when it changes — right for tracking keystroke state, which
  // must not trigger the React render cycle on every keydown/keyup.
  const pressedKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Only attach input listeners while playing. During 'paused', game-service
    // ignores input anyway, but not attaching is the cleaner contract — we
    // don't send meaningless messages we know the server will discard.
    if (phase !== 'playing' || matchId === null) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      // Key-repeat guard: browsers fire keydown continuously (~30/s) while a
      // key is held. We only want the first press, so skip if already tracked.
      if (pressedKeys.current.has(e.key)) return;
      pressedKeys.current.add(e.key);
      sendWs({
        type: 'game:input',
        payload: { matchId, direction: e.key === 'ArrowUp' ? 'up' : 'down' },
      });
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      pressedKeys.current.delete(e.key);
      // Send 'stop' only when no relevant key remains held — handles the
      // edge case of both arrow keys pressed simultaneously.
      if (pressedKeys.current.size === 0) {
        sendWs({ type: 'game:input', payload: { matchId, direction: 'stop' } });
      }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup',   onKeyUp);
      // Send stop for any held key so the server-side paddle direction is
      // neutral before the effect re-runs (e.g. playing→paused transition)
      // or the component unmounts. game-service does NOT reset direction on
      // pause() — it persists and drives the paddle on the first tick after
      // resume() — so this explicit stop is required, not just defensive.
      // sendWs is a safe no-op if the socket is already closed.
      if (pressedKeys.current.size > 0) {
        sendWs({ type: 'game:input', payload: { matchId, direction: 'stop' } });
        pressedKeys.current.clear();
      }
    };
  // STUDY: snapshot is intentionally excluded from deps. It updates ~60/s with
  // every game:state frame — including it would tear down and re-attach both
  // listeners 60 times per second, risking dropped keystrokes in the gap.
  // matchId is read at effect-setup time; snapshot is read from the store
  // directly inside sendWs calls so no closure staleness issue arises.
  }, [phase, matchId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!snapshot) return null;

  const { ball, paddles, score } = snapshot;

  return (
    // STUDY: viewBox defines the internal coordinate system (800×600 units).
    // width="100%" + preserveAspectRatio let the SVG scale to any container
    // while keeping the physics coordinates unchanged — no unit conversion needed.
    <svg
      viewBox={`0 0 ${FIELD_W} ${FIELD_H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      style={{ display: 'block', background: '#000' }}
    >
      {/* Score — positioned above the mid-line, one per side */}
      <text x={FIELD_W / 4}     y={50} textAnchor="middle" fill="#fff" fontSize={40}>{score.left}</text>
      <text x={FIELD_W * 3 / 4} y={50} textAnchor="middle" fill="#fff" fontSize={40}>{score.right}</text>

      {/* Ball — ball.x/y are the center coordinates from game-service */}
      <circle cx={ball.x} cy={ball.y} r={BALL_R} fill="#fff" />

      {/* Left paddle — x/width/height hardcoded; y (top-left corner) from snapshot */}
      <rect x={LEFT_PADDLE_X}  y={paddles.leftY}  width={PADDLE_W} height={PADDLE_H} fill="#fff" />
      {/* Right paddle */}
      <rect x={RIGHT_PADDLE_X} y={paddles.rightY} width={PADDLE_W} height={PADDLE_H} fill="#fff" />
    </svg>
  );
}
