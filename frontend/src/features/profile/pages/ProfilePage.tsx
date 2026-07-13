import { useState, useEffect, useRef } from 'react';
import { getProfile, patchProfile, uploadAvatar } from '../api/profile';
import { useProfileStore } from '../state/profileState';

// STUDY: A discriminated union (tagged by `phase`) models the page lifecycle
// explicitly. TypeScript narrows the type when you check `pageState.phase`,
// so `pageState.message` is only accessible when phase === 'error'. The
// alternative — a single object with optional fields — compiles but loses
// that safety: the compiler won't stop you reading `.message` on a loaded page.
type PageState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'exists'; username: string; avatarUrl: string | null }
  | { phase: 'not-found' };

export default function ProfilePage() {
  // STUDY: pageState owns what the SERVER says. draft owns what the USER is
  // typing. They are separate because a user can type mid-save, and the save
  // result (server truth) should overwrite draft without conflicting with
  // the current page-level state machine.
  const [pageState, setPageState] = useState<PageState>({ phase: 'loading' });
  // STUDY: setDraft is the setter React gives you from useState — calling it
  // changes `draft` AND triggers a re-render. It's not a "draft mode"; `draft`
  // is just the variable holding the input's current text. Here we overwrite it
  // with the server's confirmed value after a successful save.
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // STUDY: avatarVersion is a timestamp appended to the avatar URL as a cache-buster.
  // Browsers aggressively cache images by URL. Since the avatar filename never changes
  // ({userId}.webp overwrites in place), without a changing query string the browser
  // would show the old image after an upload. Setting ?v=<timestamp> makes the URL
  // unique on each upload, forcing a fresh fetch.
  const [avatarVersion, setAvatarVersion] = useState(Date.now);
  // STUDY: useRef gives a stable reference to a DOM element across re-renders without
  // triggering a re-render itself when it changes. Here it lets the "Upload avatar"
  // button programmatically click the hidden file input (which opens the OS picker).
  const fileInputRef = useRef<HTMLInputElement>(null);

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
          setPageState({ phase: 'exists', username: profile.username, avatarUrl: profile.avatar_url });
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
      setPageState({ phase: 'exists', username: profile.username, avatarUrl: profile.avatar_url });
      // STUDY: Update draft from the server response, not from `draft` itself.
      // If the server normalizes the value (e.g., trims whitespace) the input
      // reflects the actual saved value rather than what the user typed.
      setDraft(profile.username);
      // Lifts ProtectedRoute's gameplay gate immediately — without this, the
      // gate would keep redirecting to /profile until its own next check.
      useProfileStore.getState().markUsernameSet();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarChange(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const profile = await uploadAvatar(file);
      // Update the avatar URL in state and bump the cache-buster so the browser
      // fetches the new file instead of serving the stale cached version.
      setPageState((prev) =>
        prev.phase === 'exists'
          ? { ...prev, avatarUrl: profile.avatar_url }
          : prev,
      );
      setAvatarVersion(Date.now());
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Failed to upload avatar');
    } finally {
      setUploading(false);
    }
  }

  if (pageState.phase === 'loading') {
    return <p className="font-sans text-muted">Loading…</p>;
  }

  if (pageState.phase === 'error') {
    return <p className="font-sans text-danger">{pageState.message}</p>;
  }

  // STUDY: After the two early returns above, TypeScript knows pageState.phase
  // is either 'exists' or 'not-found'. The same form works for both — the only
  // difference is the heading text and the "no username yet" hint.
  const isNew = pageState.phase === 'not-found';

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-fg text-lg uppercase tracking-widest">
        {isNew ? 'Set up your profile' : 'Your profile'}
      </h1>
      {isNew && (
        <p className="font-sans text-muted">
          You haven&apos;t set a username yet — finish setting up your profile before you can play.
        </p>
      )}
      {/* STUDY: Avatar UI is gated on !isNew because avatar upload requires a
          profile row to already exist (the backend enforces this via 422). Showing
          an upload button before the user has set a username would lead to a
          guaranteed rejection — better to not offer the option at all. */}
      {!isNew && (
        <div className="flex flex-col gap-3">
          {pageState.avatarUrl !== null && (
            <img
              src={`${pageState.avatarUrl}?v=${avatarVersion.toString()}`}
              alt="Avatar"
              className="w-24 h-24 rounded-full object-cover border border-border"
            />
          )}
          {/* STUDY: Hidden <input type="file"> + ref is the standard pattern for
              custom-styled file pickers. The browser only opens its OS file picker
              when a file input is clicked — there's no other API for it. We hide
              the ugly default input and trigger its click() via the ref from a
              styled button. `accept` is a hint to the OS picker (not a security
              control — the backend validates via magic bytes regardless). */}
          {/* STUDY: e.target.files is a FileList (not an Array), so we index it
              with [0]. The optional chain (?.) handles the case where the user
              opens the picker and cancels without selecting anything. */}
          <input
            data-testid="avatar-input"
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleAvatarChange(file);
            }}
          />
          <button
            onClick={() => { fileInputRef.current?.click(); }}
            disabled={uploading}
            className="font-sans text-sm border border-border text-fg px-4 py-2 hover:border-primary hover:text-primary transition-colors disabled:opacity-50 self-start"
          >
            {uploading
              ? 'Uploading…'
              : pageState.avatarUrl !== null
                ? 'Change avatar'
                : 'Upload avatar'}
          </button>
          {uploadError !== null && (
            <p className="font-sans text-danger text-sm">{uploadError}</p>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <label htmlFor="username" className="font-sans text-muted text-sm">
          Username
        </label>
        <input
          id="username"
          type="text"
          aria-label="Username"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="bg-surface-raised border border-border text-fg px-3 py-2 font-sans focus:outline-none focus:ring-2 focus:ring-primary max-w-sm"
        />
      </div>
      {saveError !== null && (
        <p className="font-sans text-danger text-sm">{saveError}</p>
      )}
      {/* STUDY: Two independent disabled conditions — saving prevents double-submit;
          empty draft prevents sending a blank username to the server. */}
      <button
        onClick={() => void handleSave()}
        disabled={saving || draft.trim() === ''}
        className="bg-primary text-primary-fg font-display text-sm uppercase tracking-wide py-2 px-6 hover:bg-primary-hover disabled:opacity-50 transition-colors self-start"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
