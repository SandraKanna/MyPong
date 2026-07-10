#!/usr/bin/env node
/**
 * game-service smoke test — isolated WS wiring.
 * Tests: game:assign, game:input, game:state.
 * Match completion (match:result / game:end) is covered by unit tests with fake timers.
 *
 * Requires:
 *   - Full stack running (make up) with migrations applied.
 *   - INTERNAL_SERVICE_SECRET set in the environment.
 *
 * Usage:
 *   INTERNAL_SERVICE_SECRET=<secret> node services/game-service/scripts/smoke-test.mjs [ws_url] [api_url]
 *
 *   ws_url   WebSocket base URL for gateway-ws  (default: ws://localhost:4500)
 *   api_url  HTTP base URL for gateway-api       (default: http://localhost:4010)
 *
 * On Mac with nxd occupying :4000, gateway-api is published on :4010.
 */

import { WebSocket } from 'ws';

const WS_URL  = process.argv[2] ?? 'ws://localhost:4500';
const API_URL = process.argv[3] ?? 'http://localhost:4010';

const SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET;
if (!SERVICE_SECRET) {
  console.error('INTERNAL_SERVICE_SECRET is not set.');
  console.error('Usage: INTERNAL_SERVICE_SECRET=<secret> node services/game-service/scripts/smoke-test.mjs');
  process.exit(1);
}

const TEST_MATCH_ID  = 99001;
const TEST_MATCH_ID_2 = 99002;

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
// game:state frames arrive continuously at 16ms intervals.
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
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
    ),
  ]);
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function getAccessToken(label) {
  const email    = `smoke-game-${label}-${process.pid}@test.invalid`;
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
  console.log('\ngame-service smoke test');
  console.log(`  WS:  ${WS_URL}`);
  console.log(`  API: ${API_URL}\n`);

  const sockets = [];

  try {
    // Obtain tokens for two players and one outsider.
    let token1, token2, token3;
    try {
      [token1, token2, token3] = await Promise.all([
        getAccessToken('p1'),
        getAccessToken('p2'),
        getAccessToken('outsider'),
      ]);
    } catch (err) {
      console.error(`Could not obtain access tokens: ${err.message}`);
      console.error('Is the stack running? (make up + migrations applied)');
      process.exit(1);
    }

    // ── Test 1: browser1 authenticates ────────────────────────────────────────
    let browser1;
    try {
      browser1 = await connectBrowser(token1);
      sockets.push(browser1.ws);
      pass(`browser1 authenticates (userId: ${browser1.userId})`);
    } catch (err) {
      fail('browser1 authenticates', err.message);
      process.exit(1);
    }

    // ── Test 2: browser2 authenticates ────────────────────────────────────────
    let browser2;
    try {
      browser2 = await connectBrowser(token2);
      sockets.push(browser2.ws);
      pass(`browser2 authenticates (userId: ${browser2.userId})`);
    } catch (err) {
      fail('browser2 authenticates', err.message);
      process.exit(1);
    }

    // Outsider: connected to gateway-ws but NOT in the match's players map.
    let browser3;
    try {
      browser3 = await connectBrowser(token3);
      sockets.push(browser3.ws);
    } catch (err) {
      fail('outsider browser connects', err.message);
      process.exit(1);
    }

    // ── Test 3: internal connection registers as test-service ─────────────────
    let internalWs;
    try {
      internalWs = await wsConnect(WS_URL);
      sockets.push(internalWs);
      internalWs.send(JSON.stringify({
        type:    'service:register',
        service: 'test-service',
        token:   SERVICE_SECRET,
      }));
      const regMsg = await withTimeout(wsNextMessage(internalWs), 3000);
      if (regMsg.type !== 'registered') throw new Error(`unexpected: ${JSON.stringify(regMsg)}`);
      pass('internal connection registers as test-service');
    } catch (err) {
      fail('internal connection registers as test-service', err.message);
      process.exit(1);
    }

    // ── Tests 4-5: game:assign → both browsers receive game:state ─────────────
    // Listeners attached BEFORE sending so the very first tick is captured.
    const firstState1 = wsNextMessage(browser1.ws);
    const firstState2 = wsNextMessage(browser2.ws);

    internalWs.send(JSON.stringify({
      type:    'game:assign',
      payload: {
        matchId: TEST_MATCH_ID,
        players: {
          [String(browser1.userId)]: 'left',
          [String(browser2.userId)]: 'right',
        },
      },
    }));

    let initialState;
    try {
      const [s1, s2] = await Promise.all([
        withTimeout(firstState1, 500),
        withTimeout(firstState2, 500),
      ]);
      void s2; // both received; shape validation uses s1
      initialState = s1;
      pass('game:assign → both browsers receive game:state');
    } catch (err) {
      fail('game:assign → both browsers receive game:state', err.message);
      process.exit(1);
    }

    // Test 5: validate initial state shape.
    const p = initialState.payload;
    if (
      p?.matchId === TEST_MATCH_ID    &&
      typeof p?.ball?.x    === 'number' &&
      typeof p?.ball?.y    === 'number' &&
      typeof p?.paddles?.leftY  === 'number' &&
      typeof p?.paddles?.rightY === 'number' &&
      p?.score?.left  === 0 &&
      p?.score?.right === 0
    ) {
      pass('initial game:state has correct matchId, ball, paddles, and score 0–0');
    } else {
      fail('initial game:state shape invalid', JSON.stringify(initialState));
    }

    const initialLeftY  = p.paddles.leftY;
    const initialRightY = p.paddles.rightY;

    // ── Test 6: game:input 'up' from browser1 moves the left paddle ───────────
    // wsNextMatching scans the continuous game:state stream until leftY decreases.
    browser1.ws.send(JSON.stringify({
      type:    'game:input',
      payload: { matchId: TEST_MATCH_ID, direction: 'up' },
    }));

    try {
      const afterInput = await wsNextMatching(
        browser1.ws,
        (msg) => msg.type === 'game:state' && msg.payload?.paddles?.leftY < initialLeftY,
        300,
      );
      pass(`game:input 'up' moves left paddle (${initialLeftY} → ${afterInput.payload.paddles.leftY})`);
    } catch (err) {
      fail(`game:input 'up' from browser1 moves left paddle`, err.message);
    }

    // ── Test 7: outsider game:input is silently ignored ───────────────────────
    // browser3's userId is not in the match — no paddle should move.
    // Right player (browser2) never sent any input, so rightY stays at initialRightY.
    const afterOutsiderPromise = wsNextMessage(browser1.ws);
    browser3.ws.send(JSON.stringify({
      type:    'game:input',
      payload: { matchId: TEST_MATCH_ID, direction: 'up' },
    }));

    try {
      const afterOutsider = await withTimeout(afterOutsiderPromise, 200);
      const rightY = afterOutsider.payload?.paddles?.rightY;
      if (rightY === initialRightY) {
        pass(`outsider game:input ignored — right paddle unaffected (rightY = ${rightY})`);
      } else {
        fail('outsider game:input ignored', `rightY was ${rightY}, expected ${initialRightY}`);
      }
    } catch (err) {
      fail('outsider game:input ignored — no crash, right paddle unaffected', err.message);
    }

    // ── Test 8: forfeit by disconnect — disconnected player's opponent wins ──────
    // Fresh browser sockets (same tokens) + separate matchId to isolate from the
    // still-running TEST_MATCH_ID session above.
    let browser1b, browser2b;
    try {
      const [tokenA, tokenB] = await Promise.all([
        getAccessToken('p3'),
        getAccessToken('p4'),
      ]);
      browser1b = await connectBrowser(tokenA);
      sockets.push(browser1b.ws);
      browser2b = await connectBrowser(tokenB);
      sockets.push(browser2b.ws);
    } catch (err) {
      fail('forfeit test — browser connections', err.message);
      process.exit(1);
    }

    // Attach listeners BEFORE game:assign so no message is missed.
    // match:result (service→service) is covered by unit tests on both sides.
    // game:end (fan-out to browsers) is the end-to-end forfeit evidence here.
    const forfeitEnd = wsNextMatching(
      browser2b.ws,
      (m) => m.type === 'game:end' && m.payload?.matchId === TEST_MATCH_ID_2,
      12000,
    );

    // Confirm the session is live before triggering the disconnect.
    const firstState2b = wsNextMatching(browser2b.ws, (m) => m.type === 'game:state', 1000);

    internalWs.send(JSON.stringify({
      type:    'game:assign',
      payload: {
        matchId: TEST_MATCH_ID_2,
        players: {
          [String(browser1b.userId)]: 'left',
          [String(browser2b.userId)]: 'right',
        },
      },
    }));

    try {
      await withTimeout(firstState2b, 1000);
    } catch (err) {
      fail('forfeit test — session did not start (no game:state before disconnect)', err.message);
      process.exit(1);
    }

    // Closing browser1b triggers player:disconnect → game-service starts 5s grace timer.
    browser1b.ws.close(1000);

    try {
      const end = await forfeitEnd;
      const ep = end.payload;
      if (
        ep?.matchId  === TEST_MATCH_ID_2 &&
        ep?.winnerId === browser2b.userId
      ) {
        pass(`forfeit by disconnect — game:end received on surviving browser (winner: ${ep.winnerId})`);
      } else {
        fail('forfeit by disconnect — game:end shape invalid', JSON.stringify(end));
      }
    } catch (err) {
      fail('forfeit by disconnect — game:end not received on surviving browser within 12s', err.message);
    }

    // ── Tests 9-11: game:startAI — live PvE session with moving AI paddle ────────
    // Isolated browser so the PvE session has no overlap with the PvP sessions above.
    let pveBrowser;
    try {
      const tokenPvE = await getAccessToken('pve');
      pveBrowser = await connectBrowser(tokenPvE);
      sockets.push(pveBrowser.ws);
      pass(`PvE browser authenticates (userId: ${pveBrowser.userId})`);
    } catch (err) {
      fail('PvE browser authenticates', err.message);
      process.exit(1);
    }

    // Attach state collector before sending game:startAI so no frame is missed.
    const pveFrames = [];
    function pveStateCollector(data) {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.type === 'game:state') pveFrames.push(msg);
    }
    pveBrowser.ws.on('message', pveStateCollector);

    pveBrowser.ws.send(JSON.stringify({ type: 'game:startAI', payload: { difficulty: 'hard' } }));

    // Test 10: match:matched arrives immediately (before countdown) with PvE shape.
    // AI_BOT_USER_ID=0 is the reserved bot userId (never issued by Postgres serials).
    const AI_BOT_USER_ID = 0;
    try {
      const matched = await wsNextMatching(pveBrowser.ws, (m) => m.type === 'match:matched', 3000);
      const mp = matched.payload;
      if (
        typeof mp?.matchId  === 'number'  &&
        mp?.players?.[String(pveBrowser.userId)]   === 'left'  &&
        mp?.players?.[String(AI_BOT_USER_ID)]      === 'right' &&
        typeof mp?.startsAt === 'string'
      ) {
        pass(`game:startAI → match:matched (matchId: ${mp.matchId}, human: left, bot: right)`);
      } else {
        fail('game:startAI → match:matched shape invalid', JSON.stringify(matched));
      }
    } catch (err) {
      fail('game:startAI → no match:matched within 3s', err.message);
    }

    // Wait for the 3-second countdown + 8 seconds of live game time.
    // Hard bot: reactionDelayMs=0, updateIntervalMs=16ms — reacts on the first tick
    // after the game starts. With ~1.25s per rally and 50/50 initial ball direction,
    // P(ball never reaches the bot's side in 8s) ≈ 1.5%.
    await new Promise((resolve) => setTimeout(resolve, 11_500));

    pveBrowser.ws.removeListener('message', pveStateCollector);

    // Test 11: bot paddle actually moved — confirms ai-bot-service received
    // ai-bot:state frames, ran its prediction logic, and sent game:botInput
    // back through gateway-ws to game-service, which applied it to the physics.
    if (pveFrames.length === 0) {
      fail('PvE — no game:state frames received after countdown (ai-bot-service alive?)');
    } else {
      const firstRightY = pveFrames[0].payload.paddles.rightY;
      const botMoved    = pveFrames.some((f) => f.payload.paddles.rightY !== firstRightY);
      if (botMoved) {
        const lastRightY = pveFrames[pveFrames.length - 1].payload.paddles.rightY;
        pass(`PvE — AI paddle moved (${firstRightY} → ${lastRightY} over ${pveFrames.length} frames)`);
      } else {
        fail(`PvE — AI paddle static across ${pveFrames.length} frames — is ai-bot-service connected to gateway-ws?`);
      }
    }

    // ── Tests 12-13: game:startAI — guest PvE (no account, guest token) ─────────
    // Proves the cross-service wiring for unauthenticated play: auth-service issues
    // the guest token, gateway-ws accepts it, game-service creates the PvE session,
    // and the AI paddle moves — same end-to-end chain as the logged-in PvE case above.
    let guestBrowser;
    try {
      const guestToken = await getGuestToken();
      guestBrowser = await connectBrowser(guestToken);
      sockets.push(guestBrowser.ws);
      pass(`guest browser authenticates (userId: ${guestBrowser.userId}, negative = guest)`);
    } catch (err) {
      fail('guest browser authenticates', err.message);
      process.exit(1);
    }

    const guestFrames = [];
    function guestStateCollector(data) {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.type === 'game:state') guestFrames.push(msg);
    }
    guestBrowser.ws.on('message', guestStateCollector);

    guestBrowser.ws.send(JSON.stringify({ type: 'game:startAI', payload: { difficulty: 'hard' } }));

    try {
      const matched = await wsNextMatching(guestBrowser.ws, (m) => m.type === 'match:matched', 3000);
      const mp = matched.payload;
      const AI_BOT_USER_ID = 0;
      if (
        typeof mp?.matchId  === 'number'  &&
        mp?.players?.[String(guestBrowser.userId)] === 'left'  &&
        mp?.players?.[String(AI_BOT_USER_ID)]      === 'right' &&
        typeof mp?.startsAt === 'string'
      ) {
        pass(`guest game:startAI → match:matched (matchId: ${mp.matchId}, guest: left, bot: right)`);
      } else {
        fail('guest game:startAI → match:matched shape invalid', JSON.stringify(matched));
      }
    } catch (err) {
      fail('guest game:startAI → no match:matched within 3s', err.message);
    }

    // Wait for the 3-second countdown + 8 seconds of live game time.
    await new Promise((resolve) => setTimeout(resolve, 11_500));

    guestBrowser.ws.removeListener('message', guestStateCollector);

    // Test 13: AI paddle moved for the guest session — same assertion as the logged-in PvE case.
    if (guestFrames.length === 0) {
      fail('guest PvE — no game:state frames received after countdown (ai-bot-service alive?)');
    } else {
      const firstRightY = guestFrames[0].payload.paddles.rightY;
      const botMoved    = guestFrames.some((f) => f.payload.paddles.rightY !== firstRightY);
      if (botMoved) {
        const lastRightY = guestFrames[guestFrames.length - 1].payload.paddles.rightY;
        pass(`guest PvE — AI paddle moved (${firstRightY} → ${lastRightY} over ${guestFrames.length} frames)`);
      } else {
        fail(`guest PvE — AI paddle static across ${guestFrames.length} frames`);
      }
    }

  } finally {
    // ── Test 14: clean shutdown ────────────────────────────────────────────────
    const closePromises = sockets.map((ws) => {
      const p = wsClose(ws);
      ws.close(1000);
      return p;
    });
    await Promise.all(closePromises);
    pass('all sockets closed cleanly');
  }

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
