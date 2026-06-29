import { describe, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import ProfilePage from '../src/features/profile/pages/ProfilePage';
import { getProfile, patchProfile, uploadAvatar } from '../src/features/profile/api/profile';

vi.mock('../src/features/profile/api/profile');

beforeEach(() => {
  vi.resetAllMocks();
});

function renderProfilePage() {
  render(
    <MemoryRouter initialEntries={['/profile']}>
      <Routes>
        <Route path="/profile" element={<ProfilePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProfilePage', () => {
  it('renders username and profile heading when GET /me returns a profile', async () => {
    vi.mocked(getProfile).mockResolvedValue({
      userId: 1,
      username: 'alice',
      avatar_url: null,
    });

    renderProfilePage();

    await screen.findByText('Your profile');
    expect(screen.getByDisplayValue('alice')).toBeTruthy();
  });

  it('renders empty-state heading when GET /me returns 404 (no profile yet)', async () => {
    vi.mocked(getProfile).mockResolvedValue(null);

    renderProfilePage();

    await screen.findByText('Set up your profile');
  });

  it('transitions from empty state to profile view after a successful PATCH', async () => {
    vi.mocked(getProfile).mockResolvedValue(null);
    vi.mocked(patchProfile).mockResolvedValue({
      userId: 1,
      username: 'alice',
      avatar_url: null,
    });
    const user = userEvent.setup();

    renderProfilePage();

    await screen.findByText('Set up your profile');
    await user.type(screen.getByRole('textbox', { name: /username/i }), 'alice');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await screen.findByText('Your profile');
    expect(vi.mocked(patchProfile)).toHaveBeenCalledWith('alice');
  });

  it('surfaces the duplicate-username error when PATCH returns 409', async () => {
    vi.mocked(getProfile).mockResolvedValue({
      userId: 1,
      username: 'alice',
      avatar_url: null,
    });
    vi.mocked(patchProfile).mockRejectedValue(new Error('Username already taken'));
    const user = userEvent.setup();

    renderProfilePage();

    await screen.findByText('Your profile');
    await user.clear(screen.getByRole('textbox', { name: /username/i }));
    await user.type(screen.getByRole('textbox', { name: /username/i }), 'bob');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await screen.findByText('Username already taken');
  });

  // ── Avatar upload ──────────────────────────────────────────────────────────

  it('renders avatar image when profile has avatar_url', async () => {
    vi.mocked(getProfile).mockResolvedValue({
      userId: 1,
      username: 'alice',
      avatar_url: '/avatars/1.webp',
    });

    renderProfilePage();

    const img = await screen.findByRole('img');
    // src includes the avatar path plus a cache-busting query string
    expect(img.getAttribute('src')).toContain('/avatars/1.webp');
  });

  it('updates avatar display after a successful upload', async () => {
    vi.mocked(getProfile).mockResolvedValue({
      userId: 1,
      username: 'alice',
      avatar_url: null,
    });
    vi.mocked(uploadAvatar).mockResolvedValue({
      userId: 1,
      username: 'alice',
      avatar_url: '/avatars/1.webp',
    });
    const user = userEvent.setup();

    renderProfilePage();

    await screen.findByText('Your profile');
    // File input is hidden — userEvent.upload works on it regardless
    const input = screen.getByTestId('avatar-input');
    await user.upload(input, new File(['fakebytes'], 'avatar.jpg', { type: 'image/jpeg' }));

    const img = await screen.findByRole('img');
    expect(img.getAttribute('src')).toContain('/avatars/1.webp');
    expect(vi.mocked(uploadAvatar)).toHaveBeenCalledOnce();
  });

  it('surfaces upload error when uploadAvatar rejects', async () => {
    vi.mocked(getProfile).mockResolvedValue({
      userId: 1,
      username: 'alice',
      avatar_url: null,
    });
    vi.mocked(uploadAvatar).mockRejectedValue(new Error('File too large (max 5 MB)'));
    const user = userEvent.setup();

    renderProfilePage();

    await screen.findByText('Your profile');
    const input = screen.getByTestId('avatar-input');
    await user.upload(input, new File(['fakebytes'], 'avatar.jpg', { type: 'image/jpeg' }));

    await screen.findByText('File too large (max 5 MB)');
  });
});
