#!/usr/bin/env node
/**
 * gateway-ws smoke test.
 *
 * Requires the full stack running (make up) with migrations applied.
 *
 * Usage:
 *   node services/gateway-ws/scripts/smoke-test.mjs [ws_url] [api_url]
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
    ws.once('message', (data) => resolve(data.toString()));
  });
}

function wsClose(ws) {
  return new Promise((resolve) => {
    ws.once('close', (code) => resolve(code));
  });
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function getAccessToken() {
  const email    = `smoke-gw-ws-${process.pid}@test.invalid`;
  const password = 'SmokeTest123!';

  const reg = await fetch(`${API_URL}/api/auth/register`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email, password }),
  });
  if (!reg.ok && reg.status !== 409) {
    throw new Error(`Register failed: ${reg.status}`);
  }

  const login = await fetch(`${API_URL}/api/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email, password }),
  });
  if (!login.ok) throw new Error(`Login failed: ${login.status}`);

  const { accessToken } = await login.json();
  return accessToken;
}

// ── Test cases ────────────────────────────────────────────────────────────────

async function testValidToken(token) {
  const ws = await wsConnect(WS_URL);
  const closePromise = wsClose(ws);
  ws.send(JSON.stringify({ type: 'auth', payload: { token } }));

  let raw;
  try {
    raw = await Promise.race([
      wsNextMessage(ws),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
  } catch (err) {
    fail('valid token → connected message', err.message);
    ws.terminate();
    return;
  }

  ws.close(1000);
  await closePromise;

  let parsed;
  try { parsed = JSON.parse(raw); } catch { fail('valid token → message JSON parse error', raw); return; }

  if (parsed.type === 'connected' && typeof parsed.payload?.userId === 'string') {
    pass(`valid access token → connected (userId: ${parsed.payload.userId})`);
  } else {
    fail('valid token → unexpected message shape', raw);
  }
}

async function testInvalidToken() {
  const ws = await wsConnect(WS_URL);
  const code = wsClose(ws);
  ws.send(JSON.stringify({ type: 'auth', payload: { token: 'not.a.valid.jwt' } }));
  const closeCode = await code;
  if (closeCode === 4001) {
    pass('invalid token → close 4001 (deny)');
  } else {
    fail('invalid token → expected close 4001', `got ${closeCode}`);
  }
}

async function testNoAuth() {
  console.log('  … waiting for auth timeout (~5 s)…');
  const ws = await wsConnect(WS_URL);
  const code = await wsClose(ws);
  if (code === 4001) {
    pass('no auth sent → close 4001 after timeout (deny)');
  } else {
    fail('no auth sent → expected close 4001', `got ${code}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\ngateway-ws smoke test');
  console.log(`  WS:  ${WS_URL}`);
  console.log(`  API: ${API_URL}\n`);

  let token;
  try {
    token = await getAccessToken();
  } catch (err) {
    console.error(`Could not obtain access token: ${err.message}`);
    console.error('Is the stack running? (make up + migrations applied)');
    process.exit(1);
  }

  await testValidToken(token);
  await testInvalidToken();
  await testNoAuth();

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
