import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleMatchResult } from '../src/handlers/matchResult';

const basePayload = {
  matchId:   7,
  players:   { 42: 'left', 17: 'right' } as Record<string, 'left' | 'right'>,
  winnerId:  42,
  score:     { left: 11, right: 5 },
  status:    'completed' as const,
  startedAt: '2024-01-01T00:00:00.000Z',
  endedAt:   '2024-01-01T00:05:00.000Z',
};

describe('handleMatchResult', () => {
  let closeMatchFn: ReturnType<typeof vi.fn>;
  let sendFn:       ReturnType<typeof vi.fn>;

  beforeEach(() => {
    closeMatchFn = vi.fn().mockResolvedValue(null);
    sendFn       = vi.fn();
  });

  // ─── happy path ──────────────────────────────────────────────────────────────

  it('calls closeMatch with correct matchId, scores, winnerId, and status', async () => {
    await handleMatchResult(basePayload, closeMatchFn, sendFn);

    expect(closeMatchFn).toHaveBeenCalledOnce();
    expect(closeMatchFn).toHaveBeenCalledWith(7, {
      player1Score: 11,
      player2Score: 5,
      winnerId:     42,
      status:       'completed',
    });
  });

  it('maps score.left → player1Score and score.right → player2Score', async () => {
    const payload = { ...basePayload, score: { left: 3, right: 9 } };
    await handleMatchResult(payload, closeMatchFn, sendFn);

    const call = closeMatchFn.mock.calls[0][1];
    expect(call.player1Score).toBe(3);
    expect(call.player2Score).toBe(9);
  });

  it('passes status: forfeit through to closeMatch', async () => {
    const payload = { ...basePayload, status: 'forfeit' as const };
    await handleMatchResult(payload, closeMatchFn, sendFn);

    expect(closeMatchFn).toHaveBeenCalledWith(7, expect.objectContaining({ status: 'forfeit' }));
  });

  // ─── validation ──────────────────────────────────────────────────────────────

  it('does nothing when payload is undefined', async () => {
    await handleMatchResult(undefined, closeMatchFn, sendFn);
    expect(closeMatchFn).not.toHaveBeenCalled();
  });

  it('does nothing when matchId is missing', async () => {
    const { matchId: _, ...noMatchId } = basePayload;
    await handleMatchResult(noMatchId, closeMatchFn);
    expect(closeMatchFn).not.toHaveBeenCalled();
  });

  it('does nothing when winnerId is missing', async () => {
    const { winnerId: _, ...noWinnerId } = basePayload;
    await handleMatchResult(noWinnerId, closeMatchFn);
    expect(closeMatchFn).not.toHaveBeenCalled();
  });

  // ─── error handling ──────────────────────────────────────────────────────────

  it('catches closeMatch failure and logs without throwing', async () => {
    closeMatchFn.mockRejectedValueOnce(new Error('DB down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(handleMatchResult(basePayload, closeMatchFn)).resolves.not.toThrow();
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  it('does not crash on closeMatch failure (no unhandled rejection)', async () => {
    closeMatchFn.mockRejectedValueOnce(new Error('timeout'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(handleMatchResult(basePayload, closeMatchFn, sendFn)).resolves.toBeUndefined();
    errorSpy.mockRestore();
  });

  // ─── user:matchRecorded emission ─────────────────────────────────────────────

  it('sends user:matchRecorded with the full payload after closeMatch succeeds', async () => {
    await handleMatchResult(basePayload, closeMatchFn, sendFn);

    expect(sendFn).toHaveBeenCalledOnce();
    expect(sendFn).toHaveBeenCalledWith({ type: 'user:matchRecorded', payload: basePayload });
  });

  it('does not send user:matchRecorded when closeMatch throws', async () => {
    closeMatchFn.mockRejectedValueOnce(new Error('DB down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await handleMatchResult(basePayload, closeMatchFn, sendFn);
    expect(sendFn).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
