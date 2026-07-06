import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import CountdownOverlay from '../src/features/game/components/CountdownOverlay';
import { useGameStore } from '../src/features/game/state/gameStore';

// The component calls useGameStore.getState().startPlaying() imperatively —
// spy on it directly so we don't need to drive the store to 'matched' first.
function spyStartPlaying() {
  const spy = vi.fn();
  vi.spyOn(useGameStore, 'getState').mockReturnValue({
    ...useGameStore.getState(),
    startPlaying: spy,
  });
  return spy;
}

function startsAtMs(msFromNow: number) {
  return new Date(Date.now() + msFromNow).toISOString();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('CountdownOverlay', () => {
  it('renders the initial remaining seconds', () => {
    render(<CountdownOverlay startsAt={startsAtMs(3_000)} />);
    expect(screen.getByText('3')).toBeDefined();
  });

  it('ticks down by 1 each second', () => {
    render(<CountdownOverlay startsAt={startsAtMs(3_000)} />);

    act(() => { vi.advanceTimersByTime(1_000); });
    expect(screen.getByText('2')).toBeDefined();

    act(() => { vi.advanceTimersByTime(1_000); });
    expect(screen.getByText('1')).toBeDefined();
  });

  it('calls startPlaying() when the countdown reaches 0', () => {
    const startPlaying = spyStartPlaying();
    render(<CountdownOverlay startsAt={startsAtMs(3_000)} />);

    act(() => { vi.advanceTimersByTime(3_000); });

    expect(startPlaying).toHaveBeenCalledOnce();
  });

  it('does not call startPlaying() before the countdown reaches 0', () => {
    const startPlaying = spyStartPlaying();
    render(<CountdownOverlay startsAt={startsAtMs(3_000)} />);

    act(() => { vi.advanceTimersByTime(2_000); });

    expect(startPlaying).not.toHaveBeenCalled();
  });

  it('displays 0 (not negative) after the deadline passes', () => {
    render(<CountdownOverlay startsAt={startsAtMs(1_000)} />);

    act(() => { vi.advanceTimersByTime(2_000); });

    expect(screen.getByText('0')).toBeDefined();
  });
});
