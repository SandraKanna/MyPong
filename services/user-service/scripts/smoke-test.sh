#!/usr/bin/env bash
# Usage: ./scripts/smoke-test.sh [base_url]
# Default: http://localhost:4002 (user-service direct, no gateway-api)
#
# NOTE: This smoke test bypasses gateway-api and injects x-user-id manually
# with -H to simulate what gateway-api does after JWT validation. This is
# intentional for this PR — end-to-end verification through the full proxy
# path (nginx → gateway-api → user-service) arrives in feat/gateway-user-proxy.
#
# Requires:
#   - Full stack running: make up
#   - auth-service migrations applied (for the users table FK):
#       docker compose -p mypong exec auth-service npx node-pg-migrate up --migrations-table pgmigrations_auth
#   - user-service migrations applied:
#       docker compose -p mypong exec user-service npx node-pg-migrate up --migrations-table pgmigrations_user
#
# Each run registers a new user in the users table (unique email by PID).
# Rows are NOT cleaned up automatically — acceptable in dev.
set -uo pipefail

BASE_URL="${1:-http://localhost:4002}"
AUTH_URL="http://localhost:4001"
PASS=0
FAIL=0

# ── Helpers ───────────────────────────────────────────────────────────────────

req() {
  local method="$1"
  local url="$2"
  local data="${3:-}"
  local extra_headers="${4:-}"
  if [[ -n "$data" ]]; then
    curl -s -w "\n%{http_code}" -X "$method" \
      -H "Content-Type: application/json" \
      ${extra_headers:+-H "$extra_headers"} \
      -d "$data" \
      "$url"
  else
    curl -s -w "\n%{http_code}" -X "$method" \
      ${extra_headers:+-H "$extra_headers"} \
      "$url"
  fi
}

body()   { echo "$1" | head -n 1; }
status() { echo "$1" | tail -n 1; }

assert_status() {
  local name="$1" expected="$2" actual="$3" response_body="${4:-}"
  if [[ "$actual" == "$expected" ]]; then
    echo "[PASS] $name"
    ((PASS++))
  else
    echo "[FAIL] $name — expected HTTP $expected, got HTTP $actual"
    [[ -n "$response_body" ]] && echo "       body: $response_body"
    ((FAIL++))
  fi
}

# ── Setup: register a user to satisfy FK constraint ───────────────────────────

TEST_EMAIL="smoketest_$$@example.com"
TEST_PASS="password123"

echo ""
echo "Running smoke tests against $BASE_URL"
echo "────────────────────────────────────────"

r=$(req POST "$AUTH_URL/register" "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}")
if [[ "$(status "$r")" != "201" ]]; then
  echo "[FATAL] Could not register test user at $AUTH_URL — is auth-service up and migrated?"
  echo "        body: $(body "$r")"
  exit 1
fi
USER_ID=$(body "$r" | grep -o '"userId":[0-9]*' | grep -o '[0-9]*')
TEST_USERNAME="smokeuser_$$"

echo "  test user registered — userId=$USER_ID"
echo ""

# ── Tests ─────────────────────────────────────────────────────────────────────

# 1. DENY: GET /me without x-user-id → 401
r=$(req GET "$BASE_URL/me")
assert_status "GET /me — no x-user-id header (deny)" "401" "$(status "$r")" "$(body "$r")"

# 2. DENY: PATCH /me without x-user-id → 401
r=$(req POST "$BASE_URL/me" "{\"username\":\"$TEST_USERNAME\"}")
assert_status "PATCH /me — no x-user-id header (deny)" "401" "$(status "$r")" "$(body "$r")"

# 3. GET /me → 404 (no profile yet)
r=$(req GET "$BASE_URL/me" "" "x-user-id: $USER_ID")
assert_status "GET /me — profile not found (404)" "404" "$(status "$r")" "$(body "$r")"

# 4. PATCH /me → 200 (creates profile)
r=$(req PATCH "$BASE_URL/me" "{\"username\":\"$TEST_USERNAME\"}" "x-user-id: $USER_ID")
assert_status "PATCH /me — create profile (200)" "200" "$(status "$r")" "$(body "$r")"

# 5. GET /me → 200 (profile now exists)
r=$(req GET "$BASE_URL/me" "" "x-user-id: $USER_ID")
assert_status "GET /me — profile exists (200)" "200" "$(status "$r")" "$(body "$r")"

# 6. DENY: PATCH /me with invalid username (spaces) → 400
r=$(req PATCH "$BASE_URL/me" "{\"username\":\"invalid name\"}" "x-user-id: $USER_ID")
assert_status "PATCH /me — invalid username with spaces (400)" "400" "$(status "$r")" "$(body "$r")"

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "────────────────────────────────────────"
echo "Results: $PASS passed, $FAIL failed"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
