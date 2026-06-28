import { useState, useEffect } from 'react';
import { getProfile, patchProfile } from '../api/profile';

// STUDY: A discriminated union (tagged by `phase`) models the page lifecycle
// explicitly. TypeScript narrows the type when you check `pageState.phase`,
// so `pageState.message` is only accessible when phase === 'error'. The
// alternative — a single object with optional fields — compiles but loses
// that safety: the compiler won't stop you reading `.message` on a loaded page.
type PageState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'exists'; username: string }
  | { phase: 'not-found' };

export default function ProfilePage() {
  // STUDY: pageState owns what the SERVER says. draft owns what the USER is
  // typing. They are separate because a user can type mid-save, and the save
  // result (server truth) should overwrite draft without conflicting with
  // the current page-level state machine.
  const [pageState, setPageState] = useState<PageState>({ phase: 'loading' });
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    // STUDY: useEffect callbacks must return void or a cleanup function, not a
    // Promise. The IIFE (immediately-invoked function expression) pattern wraps
    // an async function so we can use await without making the effect itself async.
    // `void` discards the Promise the IIFE returns, satisfying the linter.
    void (async () => {
      try {
        const profile = await getProfile();
        if (profile === null) {
          // STUDY: 404 means "authenticated user exists but has no profile row yet".
          // We treat it as a valid first-time-setup state, not an error.
          setPageState({ phase: 'not-found' });
        } else {
          setPageState({ phase: 'exists', username: profile.username });
          // STUDY: Initialize the input with the existing username so the user
          // sees their current value, not a blank field.
          setDraft(profile.username);
        }
      } catch (e) {
        setPageState({
          phase: 'error',
          message: e instanceof Error ? e.message : 'Failed to load profile',
        });
      }
    })();
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const profile = await patchProfile(draft);
      // STUDY: Transition 'not-found' → 'exists' on first save — same form
      // handles both create and update (the API endpoint is an upsert).
      setPageState({ phase: 'exists', username: profile.username });
      // STUDY: Update draft from the server response, not from `draft` itself.
      // If the server normalizes the value (e.g., trims whitespace) the input
      // reflects the actual saved value rather than what the user typed.
      setDraft(profile.username);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (pageState.phase === 'loading') {
    return <p className="text-muted">Loading…</p>;
  }

  if (pageState.phase === 'error') {
    return <p className="text-muted">{pageState.message}</p>;
  }

  // STUDY: After the two early returns above, TypeScript knows pageState.phase
  // is either 'exists' or 'not-found'. The same form works for both — the only
  // difference is the heading text and the "no username yet" hint.
  const isNew = pageState.phase === 'not-found';

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-fg text-xl font-semibold">
        {isNew ? 'Set up your profile' : 'Your profile'}
      </h1>
      {isNew && (
        <p className="text-muted">You haven&apos;t set a username yet.</p>
      )}
      <div className="flex flex-col gap-2">
        <label htmlFor="username" className="text-fg text-sm">
          Username
        </label>
        <input
          id="username"
          type="text"
          aria-label="Username"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="bg-surface text-fg px-3 py-2 rounded"
        />
      </div>
      {saveError !== null && (
        <p className="text-muted">{saveError}</p>
      )}
      {/* STUDY: Two independent disabled conditions — saving prevents double-submit;
          empty draft prevents sending a blank username to the server. */}
      <button
        onClick={() => void handleSave()}
        disabled={saving || draft.trim() === ''}
        className="bg-surface text-fg px-4 py-2 rounded disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
