import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import CountdownOverlay from '../src/features/game/components/CountdownOverlay';

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

  it('displays 0 (not negative) after the deadline passes', () => {
    render(<CountdownOverlay startsAt={startsAtMs(1_000)} />);

    act(() => { vi.advanceTimersByTime(2_000); });

    expect(screen.getByText('0')).toBeDefined();
  });

  it('stops ticking after reaching 0 — interval is cleared, no further updates', () => {
    // Spy on setInterval/clearInterval to verify the interval is cancelled at zero.
    const clearSpy = vi.spyOn(global, 'clearInterval');
    render(<CountdownOverlay startsAt={startsAtMs(1_000)} />);

    act(() => { vi.advanceTimersByTime(1_000); }); // reaches 0, clearInterval should fire
    expect(clearSpy).toHaveBeenCalled();

    // Advancing further should not change the displayed value.
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(screen.getByText('0')).toBeDefined();
  });
});
