#!/usr/bin/env bash
# Usage: ./scripts/smoke-test.sh [base_url]
# Default base URL is gateway-api at port 4000.
# Pass an alternative if you're running gateway-api on a different port
# (e.g. ./scripts/smoke-test.sh http://localhost:4010 on a Mac with nxd).
#
# Prerequisites:
#   1. make up — postgres + auth-service running (applies only those two services)
#   2. Migrations applied:
#        docker compose -p mypong exec auth-service npx node-pg-migrate up
#   3. gateway-api running:
#        cd services/gateway-api && set -a && source .env && set +a && npm run dev
set -uo pipefail

BASE_URL="${1:-http://localhost:4000}"
PASS=0
FAIL=0

# ── Helpers ───────────────────────────────────────────────────────────────────

check_deps() {
  if ! command -v jq &>/dev/null; then
    echo "Error: jq is required. Install with: brew install jq"
    exit 1
  fi
}

# Run curl, output body on line 1 and HTTP status on line 2.
# $1 method  $2 path  $3 JSON body (optional)  $4 Authorization header value (optional)
req() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local auth_header="${4:-}"
  local curl_args=(-s -w "\n%{http_code}" -X "$method")
  [[ -n "$auth_header" ]] && curl_args+=(-H "Authorization: $auth_header")
  if [[ -n "$data" ]]; then
    curl_args+=(-H "Content-Type: application/json" -d "$data")
  fi
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

check_deps

TEST_EMAIL="smoketest_$$@example.com"
TEST_PASS="password123"

echo ""
echo "Running smoke tests against $BASE_URL"
echo "────────────────────────────────────────"

# 1. Register — proxied to auth-service, returns 201
r=$(req POST /api/auth/register "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}")
assert_status "POST /api/auth/register — new user" "201" "$(status "$r")" "$(body "$r")"

# 2. Login — proxied to auth-service, returns 200 + token pair
r=$(req POST /api/auth/login "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}")
assert_status "POST /api/auth/login — valid credentials" "200" "$(status "$r")" "$(body "$r")"
ACCESS=$(body "$r" | jq -r '.accessToken')
REFRESH=$(body "$r" | jq -r '.refreshToken')

# 3. Refresh — get new token pair (rotation: old token is revoked)
r=$(req POST /api/auth/refresh "{\"refreshToken\":\"$REFRESH\"}")
assert_status "POST /api/auth/refresh — valid token" "200" "$(status "$r")" "$(body "$r")"
NEW_REFRESH=$(body "$r" | jq -r '.refreshToken')

# 4. Logout — proxied DELETE to auth-service, returns 204
r=$(req DELETE /api/auth/session "{\"refreshToken\":\"$NEW_REFRESH\"}")
assert_status "DELETE /api/auth/session — logout" "204" "$(status "$r")" "$(body "$r")"

# 5. Health check — gateway-api own route, public (no JWT required)
r=$(req GET /health)
assert_status "GET /health — public route" "200" "$(status "$r")" "$(body "$r")"

# ── JWT middleware deny cases ─────────────────────────────────────────────────
# /api/users/me does not exist yet (user-service is Phase 2).
# These cases verify the JWT middleware rejects bad tokens BEFORE any proxy
# attempt. If middleware is broken, the gateway would try to proxy and return
# 502 instead of 401.

# 6. Protected route — no Authorization header → 401
r=$(req GET /api/users/me)
assert_status "GET /api/users/me — no Authorization header" "401" "$(status "$r")" "$(body "$r")"

# 7. Protected route — malformed Bearer token → 401
r=$(req GET /api/users/me "" "Bearer token-malformado")
assert_status "GET /api/users/me — malformed Bearer token" "401" "$(status "$r")" "$(body "$r")"

# 8. Protected route — missing "Bearer " prefix → 401
r=$(req GET /api/users/me "" "sinprefijo-bearer-aqui")
assert_status "GET /api/users/me — no Bearer prefix" "401" "$(status "$r")" "$(body "$r")"

# ── Summary ───────────────────────────────────────────────────────────────────

echo "────────────────────────────────────────"
echo "Results: $PASS passed, $FAIL failed"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
