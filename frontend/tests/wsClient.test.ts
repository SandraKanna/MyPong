import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.resetModules() between tests resets the module-level `socket` and `handlers`
// in wsClient, exactly as httpClient.test.ts does for `refreshPromise`.
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  MockWebSocket.lastInstance = null;
  MockWebSocket.callCount    = 0;
});

// ── MockWebSocket ─────────────────────────────────────────────────────────────
// Assigned directly to global.WebSocket (not via vi.fn()) because vi.fn() does
// not produce a constructable function — `new vi.fn()` throws in jsdom.
// Instance tracking is done via static properties instead.

class MockWebSocket {
  static readonly OPEN    = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED  = 3;

  static lastInstance: MockWebSocket | null = null;
  static callCount = 0;

  readyState = 0; // CONNECTING
  sent: string[] = [];

  onopen:    (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose:   ((event: { code: number }) => void) | null = null;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_url: string) {
    MockWebSocket.lastInstance = this;
    MockWebSocket.callCount++;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  // Defaults to 1000 (Normal Closure) — tests that care about a specific
  // close code (e.g. 4009) pass it explicitly.
  close(code = 1000): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code });
  }

  // ── Test helpers ────────────────────────────────────────────────────────────
  triggerOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  triggerMessage(data: string): void {
    this.onmessage?.({ data });
  }
}

function installMockWebSocket(): { getInstance: () => MockWebSocket } {
  // @ts-expect-error — deliberately replacing the global for tests
  global.WebSocket = MockWebSocket;
  return {
    getInstance() {
      if (!MockWebSocket.lastInstance) throw new Error('No WebSocket instantiated yet');
      return MockWebSocket.lastInstance;
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('wsClient — auth message on open', () => {
  it('sends { type: "auth", payload: { token } } as the first message when the socket opens', async () => {
    const { getInstance } = installMockWebSocket();
    const { useAuthStore } = await import('../src/features/auth/state/authState');
    const { connectWs }    = await import('../src/shared/ws/wsClient');

    useAuthStore.setState({ accessToken: 'test-token', status: 'authenticated', user: null });
    connectWs();
    getInstance().triggerOpen();

    expect(getInstance().sent).toHaveLength(1);
    expect(JSON.parse(getInstance().sent[0])).toEqual({
      type:    'auth',
      payload: { token: 'test-token' },
    });
  });

  it('does not open a socket when there is no access token', async () => {
    installMockWebSocket();
    const { useAuthStore } = await import('../src/features/auth/state/authState');
    const { connectWs }    = await import('../src/shared/ws/wsClient');

    useAuthStore.setState({ accessToken: null, status: 'unauthenticated', user: null });
    connectWs();

    expect(MockWebSocket.callCount).toBe(0);
  });
});

describe('wsClient — sendWs no-ops when not connected', () => {
  it('drops the message silently when the socket is still CONNECTING (not yet OPEN)', async () => {
    const { getInstance } = installMockWebSocket();
    const { useAuthStore }      = await import('../src/features/auth/state/authState');
    const { connectWs, sendWs } = await import('../src/shared/ws/wsClient');

    useAuthStore.setState({ accessToken: 'tok', status: 'authenticated', user: null });
    connectWs();
    // readyState is 0 (CONNECTING) — triggerOpen() is intentionally NOT called

    sendWs({ type: 'match:join' });

    // sent is empty because onopen hasn't fired (no auth msg) and sendWs was dropped
    expect(getInstance().sent).toHaveLength(0);
  });

  it('drops the message silently when readyState is CLOSING', async () => {
    const { getInstance } = installMockWebSocket();
    const { useAuthStore }      = await import('../src/features/auth/state/authState');
    const { connectWs, sendWs } = await import('../src/shared/ws/wsClient');

    useAuthStore.setState({ accessToken: 'tok', status: 'authenticated', user: null });
    connectWs();
    getInstance().triggerOpen();
    const countAfterOpen = getInstance().sent.length; // 1 (auth message)

    getInstance().readyState = MockWebSocket.CLOSING;
    sendWs({ type: 'match:cancel' });

    expect(getInstance().sent).toHaveLength(countAfterOpen); // no new message added
  });
});

describe('wsClient — onWsMessage dispatches by type', () => {
  it('delivers a message only to subscribers of the matching type', async () => {
    const { getInstance } = installMockWebSocket();
    const { useAuthStore }         = await import('../src/features/auth/state/authState');
    const { connectWs, onWsMessage } = await import('../src/shared/ws/wsClient');

    useAuthStore.setState({ accessToken: 'tok', status: 'authenticated', user: null });
    connectWs();
    getInstance().triggerOpen();

    const gameEndHandler      = vi.fn();
    const matchMatchedHandler = vi.fn();
    onWsMessage('game:end',      gameEndHandler);
    onWsMessage('match:matched', matchMatchedHandler);

    getInstance().triggerMessage(JSON.stringify({
      type:    'game:end',
      payload: { matchId: 1, winnerId: 42, score: { left: 11, right: 3 }, reason: 'completed' },
    }));

    expect(gameEndHandler).toHaveBeenCalledOnce();
    expect(matchMatchedHandler).not.toHaveBeenCalled();
  });

  it('delivers the exact parsed message object to the handler', async () => {
    const { getInstance } = installMockWebSocket();
    const { useAuthStore }         = await import('../src/features/auth/state/authState');
    const { connectWs, onWsMessage } = await import('../src/shared/ws/wsClient');

    useAuthStore.setState({ accessToken: 'tok', status: 'authenticated', user: null });
    connectWs();
    getInstance().triggerOpen();

    const handler = vi.fn();
    onWsMessage('match:rejected', handler);

    const msg = { type: 'match:rejected', payload: { reason: 'already_in_match', message: 'You are already in an active match.' } };
    getInstance().triggerMessage(JSON.stringify(msg));

    expect(handler).toHaveBeenCalledWith(msg);
  });

  it('silently ignores malformed JSON without throwing', async () => {
    const { getInstance } = installMockWebSocket();
    const { useAuthStore }         = await import('../src/features/auth/state/authState');
    const { connectWs, onWsMessage } = await import('../src/shared/ws/wsClient');

    useAuthStore.setState({ accessToken: 'tok', status: 'authenticated', user: null });
    connectWs();
    getInstance().triggerOpen();

    const handler = vi.fn();
    onWsMessage('game:state', handler);

    expect(() => getInstance().triggerMessage('not valid json{')).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('wsClient — unsubscribe stops delivery', () => {
  it('stops calling the handler after the returned unsubscribe function is called', async () => {
    const { getInstance } = installMockWebSocket();
    const { useAuthStore }         = await import('../src/features/auth/state/authState');
    const { connectWs, onWsMessage } = await import('../src/shared/ws/wsClient');

    useAuthStore.setState({ accessToken: 'tok', status: 'authenticated', user: null });
    connectWs();
    getInstance().triggerOpen();

    const handler     = vi.fn();
    const unsubscribe = onWsMessage('game:paused', handler);

    const msg = JSON.stringify({ type: 'game:paused', payload: { matchId: 1, disconnectedUserId: 7, graceEndsAt: '2025-01-01T00:00:05Z' } });
    getInstance().triggerMessage(msg);
    expect(handler).toHaveBeenCalledOnce();

    unsubscribe();
    getInstance().triggerMessage(msg);
    expect(handler).toHaveBeenCalledOnce(); // still once — not called again after unsubscribe
  });

  it('other subscribers of the same type are unaffected by an unrelated unsubscribe', async () => {
    const { getInstance } = installMockWebSocket();
    const { useAuthStore }         = await import('../src/features/auth/state/authState');
    const { connectWs, onWsMessage } = await import('../src/shared/ws/wsClient');

    useAuthStore.setState({ accessToken: 'tok', status: 'authenticated', user: null });
    connectWs();
    getInstance().triggerOpen();

    const handlerA = vi.fn();
    const handlerB = vi.fn();
    const unsubA   = onWsMessage('game:end', handlerA);
    onWsMessage('game:end', handlerB);

    const msg = JSON.stringify({ type: 'game:end', payload: { matchId: 1, winnerId: 5, score: { left: 0, right: 11 }, reason: 'completed' } });

    unsubA();
    getInstance().triggerMessage(msg);

    expect(handlerA).not.toHaveBeenCalled();
    expect(handlerB).toHaveBeenCalledOnce();
  });
});

describe('wsClient — connectWs idempotency', () => {
  it('does not open a second socket if one is already OPEN', async () => {
    const { getInstance } = installMockWebSocket();
    const { useAuthStore } = await import('../src/features/auth/state/authState');
    const { connectWs }    = await import('../src/shared/ws/wsClient');

    useAuthStore.setState({ accessToken: 'tok', status: 'authenticated', user: null });
    connectWs();
    getInstance().triggerOpen();

    connectWs(); // second call while already OPEN

    expect(MockWebSocket.callCount).toBe(1);
  });
});

describe('wsClient — reconnect on unexpected close', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules a reconnect after 500 ms when the socket closes unexpectedly', async () => {
    vi.useFakeTimers();
    const { getInstance } = installMockWebSocket();
    const { useAuthStore } = await import('../src/features/auth/state/authState');
    const { connectWs }    = await import('../src/shared/ws/wsClient');

    useAuthStore.setState({ accessToken: 'tok', status: 'authenticated', user: null });
    connectWs();
    getInstance().triggerOpen();
    getInstance().close(); // unexpected close

    expect(MockWebSocket.callCount).toBe(1);
    vi.advanceTimersByTime(500);
    expect(MockWebSocket.callCount).toBe(2);
  });

  it('does not reconnect after disconnectWs() closes the socket intentionally', async () => {
    vi.useFakeTimers();
    const { getInstance } = installMockWebSocket();
    const { useAuthStore }          = await import('../src/features/auth/state/authState');
    const { connectWs, disconnectWs } = await import('../src/shared/ws/wsClient');

    useAuthStore.setState({ accessToken: 'tok', status: 'authenticated', user: null });
    connectWs();
    getInstance().triggerOpen();
    disconnectWs();

    vi.advanceTimersByTime(10_000);
    expect(MockWebSocket.callCount).toBe(1);
  });

  it('cancels a pending reconnect timer if disconnectWs() is called during the waiting window', async () => {
    vi.useFakeTimers();
    const { getInstance } = installMockWebSocket();
    const { useAuthStore }          = await import('../src/features/auth/state/authState');
    const { connectWs, disconnectWs } = await import('../src/shared/ws/wsClient');

    useAuthStore.setState({ accessToken: 'tok', status: 'authenticated', user: null });
    connectWs();
    getInstance().triggerOpen();
    getInstance().close(); // schedules reconnect at +500ms

    disconnectWs(); // called before the timer fires
    vi.advanceTimersByTime(10_000);

    expect(MockWebSocket.callCount).toBe(1); // timer was cancelled — no second socket
  });

  it('doubles the delay on each failure, capping at 3000 ms', async () => {
    vi.useFakeTimers();
    installMockWebSocket();
    const { useAuthStore } = await import('../src/features/auth/state/authState');
    const { connectWs }    = await import('../src/shared/ws/wsClient');

    useAuthStore.setState({ accessToken: 'tok', status: 'authenticated', user: null });
    connectWs(); // callCount = 1, delay = 500ms

    // Each close is without triggerOpen() — no delay reset, so doubling accumulates.
    // 1st close → reconnect at 500ms; delay becomes 1000ms
    MockWebSocket.lastInstance!.close();
    vi.advanceTimersByTime(500);   // fires: callCount = 2

    // 2nd close → reconnect at 1000ms; delay becomes 2000ms
    MockWebSocket.lastInstance!.close();
    vi.advanceTimersByTime(1_000); // fires: callCount = 3

    // 3rd close → reconnect at 2000ms; delay becomes 3000ms (cap)
    MockWebSocket.lastInstance!.close();
    vi.advanceTimersByTime(2_000); // fires: callCount = 4

    // 4th close → reconnect at 3000ms (capped — no further doubling)
    MockWebSocket.lastInstance!.close();
    vi.advanceTimersByTime(2_999); // not yet
    expect(MockWebSocket.callCount).toBe(4);
    vi.advanceTimersByTime(1);     // fires exactly at 3000ms: callCount = 5
    expect(MockWebSocket.callCount).toBe(5);
  });

  it('resets the delay to 500 ms after a successful open', async () => {
    vi.useFakeTimers();
    installMockWebSocket();
    const { useAuthStore } = await import('../src/features/auth/state/authState');
    const { connectWs }    = await import('../src/shared/ws/wsClient');

    useAuthStore.setState({ accessToken: 'tok', status: 'authenticated', user: null });
    connectWs();

    // Fail once (delay becomes 1000ms)
    MockWebSocket.lastInstance!.triggerOpen();
    MockWebSocket.lastInstance!.close();
    vi.advanceTimersByTime(500); // reconnect fires

    // Successful open resets delay to 500ms
    MockWebSocket.lastInstance!.triggerOpen();

    // Next failure should fire at 500ms again, not 1000ms
    MockWebSocket.lastInstance!.close();
    vi.advanceTimersByTime(499);
    expect(MockWebSocket.callCount).toBe(2);
    vi.advanceTimersByTime(1);   // fires at exactly 500ms
    expect(MockWebSocket.callCount).toBe(3);
  });
});

describe('wsClient — close code 4009 (session replaced)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not attempt to reconnect after a 4009 close', async () => {
    vi.useFakeTimers();
    const { getInstance } = installMockWebSocket();
    const { useAuthStore } = await import('../src/features/auth/state/authState');
    const { connectWs }    = await import('../src/shared/ws/wsClient');

    useAuthStore.setState({ accessToken: 'tok', status: 'authenticated', user: null, isGuest: false });
    connectWs();
    getInstance().triggerOpen();
    getInstance().close(4009);

    vi.advanceTimersByTime(10_000);
    expect(MockWebSocket.callCount).toBe(1); // no reconnect attempt at any backoff delay
  });

  it('clears auth state on a 4009 close', async () => {
    const { getInstance } = installMockWebSocket();
    const { useAuthStore } = await import('../src/features/auth/state/authState');
    const { connectWs }    = await import('../src/shared/ws/wsClient');

    useAuthStore.setState({ accessToken: 'tok', status: 'authenticated', user: null, isGuest: false });
    connectWs();
    getInstance().triggerOpen();
    getInstance().close(4009);

    const state = useAuthStore.getState();
    expect(state.status).toBe('unauthenticated');
    expect(state.accessToken).toBeNull();
  });

  it('sets a distinct sessionEndedMessage on a 4009 close', async () => {
    const { getInstance } = installMockWebSocket();
    const { useAuthStore } = await import('../src/features/auth/state/authState');
    const { connectWs }    = await import('../src/shared/ws/wsClient');

    useAuthStore.setState({ accessToken: 'tok', status: 'authenticated', user: null, isGuest: false });
    connectWs();
    getInstance().triggerOpen();
    getInstance().close(4009);

    expect(useAuthStore.getState().sessionEndedMessage).toBe('You were signed in elsewhere.');
  });

  it('does not touch auth state or attempt reconnection for an ordinary close code', async () => {
    vi.useFakeTimers();
    const { getInstance } = installMockWebSocket();
    const { useAuthStore } = await import('../src/features/auth/state/authState');
    const { connectWs }    = await import('../src/shared/ws/wsClient');

    useAuthStore.setState({ accessToken: 'tok', status: 'authenticated', user: null, isGuest: false });
    connectWs();
    getInstance().triggerOpen();
    getInstance().close(1006); // unexpected close, not a session replacement

    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().sessionEndedMessage).toBeNull();

    vi.advanceTimersByTime(500);
    expect(MockWebSocket.callCount).toBe(2); // normal reconnect still happens
  });
});
