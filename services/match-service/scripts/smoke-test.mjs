#!/usr/bin/env node
/**
 * match-service smoke test — matchmaking WS wiring.
 * Tests: match:join → match:matched, match:cancel, match:rejected.
 *
 * Requires:
 *   - Full stack running (make up) with migrations applied.
 *
 * Usage:
 *   node services/match-service/scripts/smoke-test.mjs [ws_url] [api_url]
 *
 *   ws_url   WebSocket base URL for gateway-ws  (default: ws://localhost:4500)
 *   api_url  HTTP base URL for gateway-api       (default: http://localhost:4010)
 *
 * On Mac with nxd occupying :4000, gateway-api is published on :4010.
 */

import { WebSocket } from 'ws';

const WS_URL  = process.argv[2] ?? 'ws://localhost:4500';
const API_URL = process.argv[3] ?? 'http://localhost:4010';

let passed = 0;
let failed = 0;

function pass(label) {
  console.log(`  ✓  ${label}`);
  passed++;
}

function fail(label, detail = '') {
  console.error(`  ✗  ${label}${detail ? ` — ${detail}` : ''}`);
  failed++;
}

// ── WS helpers ────────────────────────────────────────────────────────────────

function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open',  ()    => resolve(ws));
    ws.once('error', (err) => reject(err));
  });
}

function wsNextMessage(ws) {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

// Waits for the next message satisfying predicate, up to timeoutMs.
// Uses a persistent listener so it catches the right message even if
// other frames arrive continuously.
function wsNextMatching(ws, predicate, timeoutMs = 500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error(`no matching message within ${timeoutMs}ms`));
    }, timeoutMs);

    function handler(data) {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(msg);
      }
    }

    ws.on('message', handler);
  });
}

function wsClose(ws) {
  return new Promise((resolve) => {
    ws.once('close', (code) => resolve(code));
  });
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function getAccessToken(label) {
  const email    = `smoke-match-${label}-${process.pid}@test.invalid`;
  const password = 'SmokeTest123!';

  const reg = await fetch(`${API_URL}/api/auth/register`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email, password }),
  });
  if (!reg.ok && reg.status !== 409) throw new Error(`register failed: ${reg.status}`);

  const login = await fetch(`${API_URL}/api/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email, password }),
  });
  if (!login.ok) throw new Error(`login failed: ${login.status}`);

  const { accessToken } = await login.json();
  return accessToken;
}

async function getGuestToken() {
  const res = await fetch(`${API_URL}/api/auth/guest`, { method: 'POST' });
  if (!res.ok) throw new Error(`guest token failed: ${res.status}`);
  const { accessToken } = await res.json();
  return accessToken;
}

// Connects a browser to gateway-ws, authenticates, and returns { ws, userId }.
async function connectBrowser(token) {
  const ws  = await wsConnect(WS_URL);
  ws.send(JSON.stringify({ type: 'auth', payload: { token } }));
  const msg = await withTimeout(wsNextMessage(ws), 3000);
  if (msg.type !== 'connected' || !msg.payload?.userId) {
    ws.terminate();
    throw new Error(`unexpected response: ${JSON.stringify(msg)}`);
  }
  return { ws, userId: Number(msg.payload.userId) };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nmatch-service smoke test');
  console.log(`  WS:  ${WS_URL}`);
  console.log(`  API: ${API_URL}\n`);

  const sockets = [];

  try {
    // Obtain tokens for two match players, one cancel tester, one already-matched tester.
    let token1, token2, token3;
    try {
      [token1, token2, token3] = await Promise.all([
        getAccessToken('p1'),
        getAccessToken('p2'),
        getAccessToken('p3'),
      ]);
    } catch (err) {
      console.error(`Could not obtain access tokens: ${err.message}`);
      console.error('Is the stack running? (make up + migrations applied)');
      process.exitCode = 1;
      return;
    }

    // ── Test 1: two browsers authenticate ─────────────────────────────────────
    let browser1, browser2;
    try {
      browser1 = await connectBrowser(token1);
      sockets.push(browser1.ws);
      browser2 = await connectBrowser(token2);
      sockets.push(browser2.ws);
      pass(`browser1 authenticates (userId: ${browser1.userId})`);
      pass(`browser2 authenticates (userId: ${browser2.userId})`);
    } catch (err) {
      fail('browser authentication', err.message);
      process.exitCode = 1;
      return;
    }

    // ── Test 2: match:join → match:matched ───────────────────────────────────
    // Attach listeners before sending match:join so no message is missed.
    const matched1 = wsNextMatching(browser1.ws, (m) => m.type === 'match:matched', 3000);
    const matched2 = wsNextMatching(browser2.ws, (m) => m.type === 'match:matched', 3000);

    browser1.ws.send(JSON.stringify({ type: 'match:join' }));
    browser2.ws.send(JSON.stringify({ type: 'match:join' }));

    let matchId;
    try {
      const [m1, m2] = await Promise.all([
        withTimeout(matched1, 3000),
        withTimeout(matched2, 3000),
      ]);

      const p1 = m1.payload;
      const p2 = m2.payload;

      const side1 = p1.players?.[browser1.userId];
      const side2 = p1.players?.[browser2.userId];
      if (
        typeof p1?.matchId === 'number' &&
        p1.matchId === p2.matchId &&
        (side1 === 'left' || side1 === 'right') &&
        (side2 === 'left' || side2 === 'right') &&
        side1 !== side2
      ) {
        matchId = p1.matchId;
        pass(`match:join → match:matched received by both browsers (matchId: ${matchId})`);
      } else {
        fail('match:matched shape or matchId mismatch', JSON.stringify({ m1, m2 }));
      }
    } catch (err) {
      fail('match:join → match:matched', err.message);
    }

    // ── Test 3: match:cancel prevents match:matched ───────────────────────────
    let browser3;
    try {
      browser3 = await connectBrowser(token3);
      sockets.push(browser3.ws);
    } catch (err) {
      fail('browser3 authenticates', err.message);
      process.exitCode = 1;
      return;
    }

    // Send join then cancel without awaiting between — cancel must arrive before
    // a second player could pair with browser3.
    browser3.ws.send(JSON.stringify({ type: 'match:join' }));
    browser3.ws.send(JSON.stringify({ type: 'match:cancel' }));

    try {
      // Expect timeout — no match:matched should arrive for this user.
      await wsNextMatching(browser3.ws, (m) => m.type === 'match:matched', 500);
      fail('match:cancel — match:matched was received but should not have been');
    } catch {
      pass('match:cancel — no match:matched received after cancel (correct)');
    }

    // ── Test 4: match:rejected for an already-matched user ────────────────────
    // browser1 already has an active match from test 3.
    const rejectedPromise = wsNextMatching(
      browser1.ws,
      (m) => m.type === 'match:rejected',
      3000,
    );

    browser1.ws.send(JSON.stringify({ type: 'match:join' }));

    try {
      const rejected = await withTimeout(rejectedPromise, 3000);
      const rp = rejected.payload;
      // gateway-ws strips `to` before fan-out — browser receives without it.
      if (rp?.reason === 'already_in_match' && typeof rp?.message === 'string') {
        pass(`match:rejected received (reason: ${rp.reason})`);
      } else {
        fail('match:rejected shape invalid', JSON.stringify(rejected));
      }
    } catch (err) {
      fail('match:rejected not received within 3s', err.message);
    }

    // Assert browser1 was NOT re-enqueued: no match:matched should arrive.
    try {
      await wsNextMatching(browser1.ws, (m) => m.type === 'match:matched', 500);
      fail('match:rejected — browser1 was re-enqueued (match:matched received unexpectedly)');
    } catch {
      pass('match:rejected — browser1 was not re-enqueued (no match:matched after rejection)');
    }

    // ── Tests 5-6: guest match:join rejection ─────────────────────────────────
    let guestBrowser1, guestBrowser2;
    try {
      const [gt1, gt2] = await Promise.all([getGuestToken(), getGuestToken()]);
      guestBrowser1 = await connectBrowser(gt1);
      sockets.push(guestBrowser1.ws);
      guestBrowser2 = await connectBrowser(gt2);
      sockets.push(guestBrowser2.ws);
    } catch (err) {
      fail('guest browsers connect', err.message);
      process.exitCode = 1;
      return;
    }

    // Test 5: single guest match:join → match:rejected with reason guest_not_allowed.
    const guestRejected = wsNextMatching(
      guestBrowser1.ws,
      (m) => m.type === 'match:rejected',
      3000,
    );
    guestBrowser1.ws.send(JSON.stringify({ type: 'match:join' }));

    try {
      const rejected = await withTimeout(guestRejected, 3000);
      const rp = rejected.payload;
      if (rp?.reason === 'guest_not_allowed' && typeof rp?.message === 'string') {
        pass(`guest match:join → match:rejected (reason: ${rp.reason})`);
      } else {
        fail('guest match:rejected shape invalid', JSON.stringify(rejected));
      }
    } catch (err) {
      fail('guest match:join → match:rejected not received within 3s', err.message);
    }

    // Test 6: two guests joining back-to-back never produce match:matched.
    // Both are rejected before entering the queue, so pairing is impossible.
    const guestMatched1 = wsNextMatching(guestBrowser1.ws, (m) => m.type === 'match:matched', 500);
    const guestMatched2 = wsNextMatching(guestBrowser2.ws, (m) => m.type === 'match:matched', 500);

    guestBrowser2.ws.send(JSON.stringify({ type: 'match:join' }));

    let guestsPaired = false;
    try {
      await Promise.race([guestMatched1, guestMatched2]);
      guestsPaired = true;
    } catch {
      // Expected: both promises time out — no match:matched arrived.
    }

    if (guestsPaired) {
      fail('two guests joined and were paired — guest guard is not working');
    } else {
      pass('two guests joining back-to-back never produce match:matched (correct)');
    }

  } finally {
    // ── Test 7: clean shutdown ─────────────────────────────────────────────────
    const closePromises = sockets.map((ws) => {
      const p = wsClose(ws);
      ws.close(1000);
      return p;
    });
    await Promise.all(closePromises);
    pass('all sockets closed cleanly');
  }

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
