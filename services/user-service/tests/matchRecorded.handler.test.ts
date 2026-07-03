import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleMatchRecorded } from '../src/handlers/matchRecorded';

const basePayload = {
  matchId:   7,
  players:   { '42': 'left', '17': 'right' } as Record<string, 'left' | 'right'>,
  winnerId:  42,
  score:     { left: 11, right: 5 },
  status:    'completed' as const,
  startedAt: '2024-01-01T00:00:00.000Z',
  endedAt:   '2024-01-01T00:05:00.000Z',
};

describe('handleMatchRecorded', () => {
  let recordFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    recordFn = vi.fn().mockResolvedValue(undefined);
  });

  // ─── happy path ──────────────────────────────────────────────────────────────

  it('calls recordFn with the full validated payload', async () => {
    await handleMatchRecorded(basePayload, recordFn);

    expect(recordFn).toHaveBeenCalledOnce();
    expect(recordFn).toHaveBeenCalledWith(basePayload);
  });

  // ─── validation ──────────────────────────────────────────────────────────────

  it('does nothing when payload is undefined', async () => {
    await handleMatchRecorded(undefined, recordFn);
    expect(recordFn).not.toHaveBeenCalled();
  });

  it('does nothing when matchId is missing', async () => {
    const { matchId: _, ...noMatchId } = basePayload;
    await handleMatchRecorded(noMatchId, recordFn);
    expect(recordFn).not.toHaveBeenCalled();
  });

  it('does nothing when winnerId is missing', async () => {
    const { winnerId: _, ...noWinnerId } = basePayload;
    await handleMatchRecorded(noWinnerId, recordFn);
    expect(recordFn).not.toHaveBeenCalled();
  });

  // ─── error handling ───────────────────────────────────────────────────────────

  it('catches recordFn rejection and does not throw', async () => {
    recordFn.mockRejectedValueOnce(new Error('DB down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(handleMatchRecorded(basePayload, recordFn)).resolves.toBeUndefined();
    errorSpy.mockRestore();
  });

  it('log message includes the matchId', async () => {
    recordFn.mockRejectedValueOnce(new Error('timeout'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await handleMatchRecorded(basePayload, recordFn);

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(String(errorSpy.mock.calls[0][0])).toContain('matchId=7');
    errorSpy.mockRestore();
  });
});
