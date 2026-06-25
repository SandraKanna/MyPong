#!/usr/bin/env bash
# Usage: ./scripts/smoke-test.sh [base_url]
# Default base URL is gateway-api at port 4000.
# Pass an alternative if you're running gateway-api on a different port
# (e.g. ./scripts/smoke-test.sh http://localhost:4010 on a Mac with nxd).
#
# Scope: gateway-specific behaviour only.
#   - GET /health       — gateway's own route (not proxied)
#   - JWT middleware    — deny cases on a protected route (/api/users/me)
#                         middleware must reject BEFORE any proxy attempt
#
# Auth flow (register/login/refresh/logout) is covered by the auth-service
# smoke test, which already runs end-to-end through this gateway at :4010.
#
# Prerequisites:
#   1. gateway-api running:
#        cd services/gateway-api && set -a && source .env && set +a && npm run dev
set -uo pipefail

BASE_URL="${1:-http://localhost:4000}"
PASS=0
FAIL=0

# ── Helpers ───────────────────────────────────────────────────────────────────

# Run curl, output body on line 1 and HTTP status on line 2.
# $1 method  $2 path  $3 Authorization header value (optional)
req() {
  local method="$1"
  local path="$2"
  local auth_header="${3:-}"
  local curl_args=(-s -w "\n%{http_code}" -X "$method")
  [[ -n "$auth_header" ]] && curl_args+=(-H "Authorization: $auth_header")
  curl "${curl_args[@]}" "${BASE_URL}${path}"
}

body()   { echo "$1" | head -n 1; }
status() { echo "$1" | tail -n 1; }

assert_status() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  local response_body="${4:-}"
  if [[ "$actual" == "$expected" ]]; then
    echo "[PASS] $name"
    ((PASS++))
  else
    echo "[FAIL] $name — expected HTTP $expected, got HTTP $actual"
    [[ -n "$response_body" ]] && echo "       body: $response_body"
    ((FAIL++))
  fi
}

# ── Tests ─────────────────────────────────────────────────────────────────────

echo ""
echo "Running smoke tests against $BASE_URL"
echo "────────────────────────────────────────"

# 1. Health check — gateway's own route, public (no JWT required)
r=$(req GET /health)
assert_status "GET /health — public route" "200" "$(status "$r")" "$(body "$r")"

# ── JWT middleware deny cases ─────────────────────────────────────────────────
# /api/users/me does not exist yet (user-service is Phase 2).
# These cases verify the JWT middleware rejects bad tokens BEFORE any proxy
# attempt. If middleware is broken, the gateway would try to proxy and return
# 502 instead of 401.

# 2. Protected route — no Authorization header → 401
r=$(req GET /api/users/me)
assert_status "GET /api/users/me — no Authorization header" "401" "$(status "$r")" "$(body "$r")"

# 3. Protected route — malformed Bearer token → 401
r=$(req GET /api/users/me "Bearer token-malformado")
assert_status "GET /api/users/me — malformed Bearer token" "401" "$(status "$r")" "$(body "$r")"

# 4. Protected route — missing "Bearer " prefix → 401
r=$(req GET /api/users/me "sinprefijo-bearer-aqui")
assert_status "GET /api/users/me — no Bearer prefix" "401" "$(status "$r")" "$(body "$r")"

# ── Summary ───────────────────────────────────────────────────────────────────

echo "────────────────────────────────────────"
echo "Results: $PASS passed, $FAIL failed"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
