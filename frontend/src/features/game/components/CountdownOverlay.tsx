import { useState, useEffect } from 'react';

interface CountdownOverlayProps {
  startsAt: string; // ISO timestamp from match:matched — raw server value, we compute remaining time locally
}

export default function CountdownOverlay({ startsAt }: CountdownOverlayProps) {
  // STUDY: useState(() => expr) is the lazy initializer form — the function runs
  // only once on mount to compute the initial value. useState(expr) would re-evaluate
  // expr on every render even though React ignores all but the first result.
  const [remaining, setRemaining] = useState(() =>
    // STUDY: Math.ceil so that 2.3 s left displays as "3", not "2" — we want to
    // show the second we're still inside, not the one that already passed.
    Math.ceil((new Date(startsAt).getTime() - Date.now()) / 1000),
  );

  // STUDY: useEffect(fn, deps) runs fn after the component renders. React re-runs it
  // whenever a value in deps changes — here [startsAt], so a new match resets the timer.
  // The function returned by fn is the cleanup: React calls it before the next run
  // and on unmount, which is where we stop the interval to avoid a memory leak.
  useEffect(() => {
    // STUDY: setInterval is a standard browser/Node timer (not React-specific).
    // It calls the callback every `ms` milliseconds and returns an id we can
    // pass to clearInterval to stop it. Without clearInterval the interval keeps
    // firing even after the component unmounts, updating state on a dead component.
    const id = setInterval(() => {
      // STUDY: `next` is a plain local variable — we compute this tick's value
      // once and use it twice (setRemaining + the zero-check) without risk of
      // reading a stale `remaining` state value from before this tick.
      const next = Math.ceil((new Date(startsAt).getTime() - Date.now()) / 1000);
      setRemaining(next);
      // Stop the interval at zero — the transition to 'playing' is triggered by
      // the first real game:state frame from the server, not by this local timer.
      if (next <= 0) clearInterval(id);
    }, 1000);

    return () => clearInterval(id); // cleanup: stop the interval on unmount or startsAt change
  }, [startsAt]);

  return (
    <div>
      <p>Match starting in</p>
      <p>{Math.max(remaining, 0)}</p>
    </div>
  );
}
