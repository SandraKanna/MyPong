#!/usr/bin/env node
/**
 * ai-bot-service smoke test — isolated decision logic + WS wiring, no physics loop.
 * Tests: ai-bot:sessionStart/state produce the correct game:botInput direction,
 * ai-bot:sessionEnd tears down state, and state for an unknown matchId is a no-op.
 *
 * Ball/paddle positions are synthetic (hand-picked), not driven by a real game-service
 * physics tick — this proves ai-bot-service's own decisions and the WS message contract,
 * not the end-to-end effect of those decisions on a real match. For that, see
 * game-service's own smoke test (the guest PvE case) — see ai-bot-service/README.md's
 * Smoke test section for why that check has to live there instead of here.
 *
 * Requires:
 *   - Full stack running (make up) with the real game-service container STOPPED first:
 *       docker compose -p mypong stop game-service
 *     This frees its gateway-ws registration slot — see README.md's Setup step for why.
 *   - INTERNAL_SERVICE_SECRET set in the environment.
 *
 * This script does not start or stop any Docker container itself. Restarting
 * game-service afterward is a manual step — see README.md's Cleanup step.
 *
 * Usage:
 *   INTERNAL_SERVICE_SECRET=<secret> node services/ai-bot-service/scripts/smoke-test.mjs [ws_url]
 *
 *   ws_url   WebSocket base URL for gateway-ws (default: ws://localhost:4500)
 */

import { WebSocket } from 'ws';

const WS_URL = process.argv[2] ?? 'ws://localhost:4500';

const SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET;
if (!SERVICE_SECRET) {
  console.error('INTERNAL_SERVICE_SECRET is not set.');
  console.error('Usage: INTERNAL_SERVICE_SECRET=<secret> node services/ai-bot-service/scripts/smoke-test.mjs');
  process.exitCode = 1;
}

// Shared physics config for every session — values only need to be internally
// consistent across sessionStart/state, not to match a real game-service instance.
const PHYSICS_CONFIG = {
  fieldWidth:    800,
  fieldHeight:   600,
  ballRadius:    10,
  paddleHeight:  80,
  paddleXOffset: 20,
  paddleWidth:   12,
  paddleSpeed:   5,
};

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

// Resolves with the next message satisfying predicate, or rejects after timeoutMs.
// The listener attaches synchronously when this is CALLED, not when it's awaited —
// callers must call this before triggering the send that's expected to answer it.
// A rejection is treated as "nothing arrived" by callers that expect silence
// (sessionEnd teardown, unknown-matchId no-op).
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

function sessionStart(ws, matchId, difficulty = 'hard', botSide = 'right') {
  ws.send(JSON.stringify({
    type:    'ai-bot:sessionStart',
    payload: { matchId, difficulty, botSide, physicsConfig: PHYSICS_CONFIG },
  }));
}

function sendState(ws, matchId, ball, paddles = { leftY: 260, rightY: 260 }, score = { left: 0, right: 0 }) {
  ws.send(JSON.stringify({
    type:    'ai-bot:state',
    payload: { matchId, ball, paddles, score },
  }));
}

function botInputMatching(ws, matchId, timeoutMs = 500) {
  return wsNextMatching(ws, (m) => m.type === 'game:botInput' && m.payload?.matchId === matchId, timeoutMs);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nai-bot-service smoke test');
  console.log(`  WS: ${WS_URL}\n`);

  let ws;

  try {
    // ── Registration: occupy the game-service slot ───────────────────────────
    // ai-bot:* messages route to ai-bot-service by prefix regardless of our own
    // registered name, but game:botInput (ai-bot-service's only reply) routes
    // only to whoever holds the game-service slot — see the file docstring.
    try {
      ws = await wsConnect(WS_URL);
      ws.send(JSON.stringify({
        type:    'service:register',
        service: 'game-service',
        token:   SERVICE_SECRET,
      }));
      const regMsg = await withTimeout(wsNextMessage(ws), 3000);
      if (regMsg.type !== 'registered') throw new Error(`unexpected: ${JSON.stringify(regMsg)}`);
      pass('internal connection registers as game-service (real container must be stopped first)');
    } catch (err) {
      fail('internal connection registers as game-service', err.message);
      console.error('Is the real game-service container stopped? (docker compose -p mypong stop game-service)');
      process.exitCode = 1;
      return;
    }

    // ── Test: ball above paddle center → bot moves up ─────────────────────────
    const MATCH_ID_UP = 88001;
    sessionStart(ws, MATCH_ID_UP, 'hard', 'right');
    const upInputPromise = botInputMatching(ws, MATCH_ID_UP, 1000);
    sendState(ws, MATCH_ID_UP, { x: 400, y: 50, vx: 5, vy: 0 }, { leftY: 260, rightY: 260 });
    try {
      const botInput = await upInputPromise;
      if (botInput.payload.direction === 'up') {
        pass('ball above paddle center → game:botInput direction: up');
      } else {
        fail('ball above paddle center → up', `got direction: ${botInput.payload.direction}`);
      }
    } catch (err) {
      fail('ball above paddle center → up', err.message);
    }

    // ── Test: ball below paddle center → bot moves down ───────────────────────
    // Fresh matchId — avoids any residual cachedTargetY from the previous session.
    const MATCH_ID_DOWN = 88002;
    sessionStart(ws, MATCH_ID_DOWN, 'hard', 'right');
    const downInputPromise = botInputMatching(ws, MATCH_ID_DOWN, 1000);
    sendState(ws, MATCH_ID_DOWN, { x: 400, y: 550, vx: 5, vy: 0 }, { leftY: 260, rightY: 260 });
    try {
      const botInput = await downInputPromise;
      if (botInput.payload.direction === 'down') {
        pass('ball below paddle center → game:botInput direction: down');
      } else {
        fail('ball below paddle center → down', `got direction: ${botInput.payload.direction}`);
      }
    } catch (err) {
      fail('ball below paddle center → down', err.message);
    }

    // ── Test: sessionEnd tears down state — no further game:botInput ──────────
    const noInputAfterEnd = botInputMatching(ws, MATCH_ID_DOWN, 500);
    ws.send(JSON.stringify({ type: 'ai-bot:sessionEnd', payload: { matchId: MATCH_ID_DOWN } }));
    sendState(ws, MATCH_ID_DOWN, { x: 400, y: 50, vx: 5, vy: 0 }, { leftY: 260, rightY: 260 });
    try {
      await noInputAfterEnd;
      fail('sessionEnd tears down state', 'game:botInput arrived after sessionEnd');
    } catch {
      pass('sessionEnd tears down state — no game:botInput for that matchId afterward');
    }

    // ── Test: state for a never-started matchId is a no-op ────────────────────
    const NEVER_STARTED_MATCH_ID = 999999;
    const noInputForUnknown = botInputMatching(ws, NEVER_STARTED_MATCH_ID, 500);
    sendState(ws, NEVER_STARTED_MATCH_ID, { x: 400, y: 50, vx: 5, vy: 0 });
    try {
      await noInputForUnknown;
      fail('state for never-started matchId ignored', 'game:botInput arrived for an unknown matchId');
    } catch {
      pass('state for never-started matchId ignored — no game:botInput, no crash');
    }

  } finally {
    // Guaranteed regardless of pass/fail/timeout above — mirrors game-service's own
    // smoke test's socket-cleanup finally block. This closes only our own WS socket;
    // it does not touch Docker in any way. Restarting the real game-service container
    // is a manual operator step — see README.md's Cleanup section.
    if (ws) {
      const closed = wsClose(ws);
      ws.close(1000);
      await closed;
    }
    pass('socket closed cleanly');
  }

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  console.error('  Reminder: restart the real game-service container now:');
  console.error('    docker compose -p mypong start game-service\n');
  process.exitCode = failed > 0 ? 1 : 0;
}

if (SERVICE_SECRET) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
