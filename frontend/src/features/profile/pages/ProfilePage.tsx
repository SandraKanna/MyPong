import { useState, useEffect, useRef } from 'react';
import { getProfile, patchProfile, uploadAvatar } from '../api/profile';
import { useProfileStore } from '../state/profileState';
import StatsDisclosure from '../components/StatsDisclosure';

// A discriminated union (tagged by `phase`) — TypeScript narrows the type when you check
// `pageState.phase`, so e.g. `pageState.message` is only accessible when phase === 'error'.
type PageState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  // userId: captured because GET /me is the only place this page learns the caller's own
  // numeric id — it's what gets passed down to StatsDisclosure below.
  | { phase: 'exists'; userId: number; username: string; avatarUrl: string | null }
  | { phase: 'not-found' };

export default function ProfilePage() {
  // pageState owns what the SERVER says; draft owns what the USER is typing — kept separate
  // because a user can type mid-save, and the save result shouldn't clobber in-progress input.
  const [pageState, setPageState] = useState<PageState>({ phase: 'loading' });
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Cache-buster: the avatar filename never changes ({userId}.webp overwrites in place), so
  // without a changing query string the browser would keep showing the old image after an upload.
  const [avatarVersion, setAvatarVersion] = useState(Date.now);
  const fileInputRef = useRef<HTMLInputElement>(null); // lets the styled "Upload avatar" button trigger the hidden file input's OS picker

  useEffect(() => {
    void (async () => {
      try {
        const profile = await getProfile();
        if (profile === null) {
          // 404 means "authenticated user exists but has no profile row yet" — a valid first-time-setup state, not an error.
          setPageState({ phase: 'not-found' });
        } else {
          setPageState({
            phase: 'exists',
            userId: profile.userId,
            username: profile.username,
            avatarUrl: profile.avatar_url,
          });
          setDraft(profile.username); // initialize the input with the existing username, not a blank field
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
      // Transition 'not-found' → 'exists' on first save — same form handles both create and update (the API endpoint is an upsert).
      setPageState({
        phase: 'exists',
        userId: profile.userId,
        username: profile.username,
        avatarUrl: profile.avatar_url,
      });
      setDraft(profile.username); // reflect the server's saved value (e.g. trimmed), not what the user typed
      useProfileStore.getState().markUsernameSet(profile.username); // marks the username as set immediately, rather than waiting on the store's own next check
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

  // After the two early returns above, pageState.phase is 'exists' or 'not-found' — same form
  // works for both, only the heading text and the "no username yet" hint differ.
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
      {/* Avatar UI is gated on !isNew because avatar upload requires a profile row to already exist (backend enforces via 422) */}
      {!isNew && (
        <div className="flex flex-col gap-3">
          {pageState.avatarUrl !== null && (
            <img
              src={`${pageState.avatarUrl}?v=${avatarVersion.toString()}`}
              alt="Avatar"
              className="w-24 h-24 rounded-full object-cover border border-border"
            />
          )}
          {/* Hidden <input type="file"> + ref: the browser only opens its OS file picker on a direct click, so a styled button triggers this one via the ref. `accept` is just a picker hint — the backend validates via magic bytes regardless. */}
          <input
            data-testid="avatar-input"
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]; // FileList, not an Array — optional chain covers "picker opened, then cancelled"
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
      <button
        onClick={() => void handleSave()}
        disabled={saving || draft.trim() === ''} // saving prevents double-submit; empty draft prevents sending a blank username
        className="bg-primary text-primary-fg font-display text-sm uppercase tracking-wide py-2 px-6 hover:bg-primary-hover disabled:opacity-50 transition-colors self-start"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      {/* Gated on !isNew, same reasoning as avatar upload above — StatsDisclosure needs a real userId, which only exists once a profile row does. */}
      {!isNew && <StatsDisclosure userId={pageState.userId} />}
    </div>
  );
}
