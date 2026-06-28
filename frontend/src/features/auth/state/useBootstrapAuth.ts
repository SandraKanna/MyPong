import { useEffect } from 'react';
import { sharedRefresh } from '../../../shared/api/httpClient';

// STUDY: A "hook" is just a function React calls on every render. Hooks that start
// with "use" can call other hooks. This one is a custom hook that wraps useEffect
// to encapsulate the bootstrap side effect and keep App.tsx clean.
export function useBootstrapAuth(): void {
  // STUDY: useEffect runs AFTER the component renders, not during. The empty
  // dependency array [] means "run once after the first render only" — equivalent
  // to a constructor side effect or an on-startup call in backend code.
  // Without [], it would run after every re-render, causing an infinite refresh loop.
  useEffect(() => {
    // STUDY: void discards the Promise returned by sharedRefresh. useEffect's
    // callback must return nothing or a cleanup function — returning a Promise
    // would silently break React's cleanup model. void makes the intent explicit
    // and satisfies the no-floating-promises ESLint rule.
    void sharedRefresh();
  }, []);
}
