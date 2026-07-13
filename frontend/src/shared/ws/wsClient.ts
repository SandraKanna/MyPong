import { useAuthStore } from '../../features/auth/state/authState';
import type { IncomingMessage, OutgoingMessage } from './wsMessages';

// STUDY: Module-level singleton — same pattern as httpClient.ts with its
// refreshPromise. One socket shared by all callers; survives React re-renders.
let socket: WebSocket | null = null;

// gateway-ws closes a browser connection with this code when a newer login
// for the same account replaces it — see gateway-ws/README.md#single-session-per-user.
// Duplicated here as a matching constant since there is no shared runtime
// package between frontend and backend for this kind of literal.
const CLOSE_SESSION_REPLACED = 4009;

// STUDY: Handlers persist for the module lifetime (the browser tab). They are
// NOT cleared on close or disconnect — subscriptions survive reconnects so
// callers don't have to re-register. The trade-off: callers MUST call the
// returned unsubscribe function in their useEffect cleanup. A subscriber that
// misses cleanup stays in the Map and will fire again on future connections.
// This is the same contract as addEventListener: the platform doesn't track
// ownership; cleanup is the caller's responsibility.
const handlers = new Map<string, Set<(msg: IncomingMessage) => void>>();

// Exponential backoff strategy, same idea as internalClient.ts's Backoff
// strategy on the backend, but tuned for the browser reconnecting after an
// unwanted disconnection: short initial delay and low cap (needs to beat
// game-service's 5s grace window), not internalClient's 30s cap meant for
// an unattended backend process that can wait out a longer outage.
const RECONNECT_FACTOR  = 2;
const RECONNECT_CAP_MS  = 3_000;
const RECONNECT_INIT_MS = 500;

// STUDY: `stopped` distinguishes intentional close (disconnectWs()) from
// unexpected close — same flag pattern as internalClient.ts in backend services.
// Without it, disconnectWs() would trigger a reconnect via onclose.
let stopped        = false;
let delay          = RECONNECT_INIT_MS;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// STUDY: Constructs a same-origin WS URL so the path (/ws) is handled by
// whoever is in front: Vite proxy (dev) or nginx reverse proxy (prod/docker).
// Same reasoning as using relative paths in apiClient — no hardcoded host/port.
function buildWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export function connectWs(): void {
  stopped = false;
  if (socket !== null && socket.readyState === WebSocket.OPEN) return;

  const token = useAuthStore.getState().accessToken;
  if (!token) return;

  socket = new WebSocket(buildWsUrl());

  socket.onopen = () => {
    delay = RECONNECT_INIT_MS; // reset backoff on successful connect
    // First message must be the auth envelope — gateway-ws closes with 4001
    // if it times out waiting (5 s) or receives anything else first.
    socket?.send(JSON.stringify({ type: 'auth', payload: { token } }));
  };

  socket.onmessage = (event: MessageEvent<string>) => {
    let msg: unknown;
    try {
      msg = JSON.parse(event.data) as unknown;
    } catch {
      return;
    }
    if (typeof msg !== 'object' || msg === null) return;
    const { type } = msg as Record<string, unknown>;
    if (typeof type !== 'string') return;

    const bucket = handlers.get(type);
    if (!bucket) return;
    for (const handler of bucket) {
      handler(msg as IncomingMessage);
    }
  };

  socket.onclose = (event: CloseEvent) => {
    socket = null;

    if (event.code === CLOSE_SESSION_REPLACED) {
      // This session was deliberately superseded by a newer login elsewhere,
      // not dropped by a network blip — reconnecting would be pointless, since
      // the refresh token behind this session was revoked server-side at the
      // same time gateway-ws closed this socket. disconnectWs() marks `stopped`
      // and clears any pending reconnect timer, same as a deliberate logout.
      disconnectWs();
      useAuthStore.getState().clearAuth();
      useAuthStore.getState().setSessionEndedMessage('You were signed in elsewhere.');
      return;
    }

    // handlers intentionally left intact — see module-level comment above.
    if (stopped) return;
    const retryAfter = delay;
    delay = Math.min(delay * RECONNECT_FACTOR, RECONNECT_CAP_MS);
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connectWs(); }, retryAfter);
  };
}

export function disconnectWs(): void {
  // stopped must be set BEFORE socket.close() — some environments (including
  // the test mocks) fire onclose synchronously from close(), so the reconnect
  // branch must already be suppressed by the time it runs. Safe in all cases.
  stopped = true;
  clearTimeout(reconnectTimer ?? undefined);
  reconnectTimer = null;
  socket?.close();
  socket = null;
}

export function sendWs(msg: OutgoingMessage): void {
  // Silent no-op when not connected — callers don't need to guard against
  // this; the message is simply dropped if the socket isn't ready.
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(msg));
}

// STUDY: The generic signature gives full TypeScript narrowing to callers:
// the handler receives the exact message subtype for its `type` key, not
// the wider IncomingMessage union. Internally we store under the common type
// because the Map holds mixed sets — safe, since we only invoke a handler
// when msg.type === the key it was registered under.
export function onWsMessage<K extends IncomingMessage['type']>(
  type: K,
  handler: (msg: Extract<IncomingMessage, { type: K }>) => void,
): () => void {
  if (!handlers.has(type)) {
    handlers.set(type, new Set());
  }
  handlers.get(type)!.add(handler as (msg: IncomingMessage) => void);

  return () => {
    handlers.get(type)?.delete(handler as (msg: IncomingMessage) => void);
  };
}
