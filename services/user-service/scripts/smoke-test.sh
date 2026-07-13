#!/usr/bin/env bash
# Usage: ./scripts/smoke-test.sh [base_url]
# Default: http://localhost:4010 (gateway-api)
#
# NOTE: user-service has no host port mapping — port 4002 is only reachable
# from other containers on the internal Docker network. Postgres also has no
# host port mapping, so a standalone native dev flow is not supported for this
# service. This smoke test always runs through gateway-api.
#
# A real login is performed via gateway-api after registration, and all
# user-service requests use the resulting Bearer token for authentication —
# this exercises the full JWT-validation path through gateway-api.
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

BASE_URL="${1:-http://localhost:4010}"
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

# For cases that need more than a status-code comparison — pass a single
# already-evaluated boolean condition ("true"/"false") so the case still
# counts as exactly one pass/fail, not one per sub-check.
assert() {
  local name="$1" condition="$2" response_body="${3:-}"
  if [[ "$condition" == "true" ]]; then
    echo "[PASS] $name"
    ((PASS++))
  else
    echo "[FAIL] $name"
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
# auth-service's /register response is { accessToken } (same shape as /login) —
# it doesn't return userId, so USER_ID is captured later from the PATCH /me
# response instead (case 4 below), which already returns it.
TEST_USERNAME="smokeuser_$$"

r=$(req POST "$BASE_URL/api/auth/login" "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}")
if [[ "$(status "$r")" != "200" ]]; then
  echo "[FATAL] Could not log in at $BASE_URL — is gateway-api up?"
  echo "        body: $(body "$r")"
  exit 1
fi
ACCESS_TOKEN=$(body "$r" | grep -o '"accessToken":"[^"]*"' | grep -o '"[^"]*"$' | tr -d '"')

echo "  test user registered"
echo "  access token obtained"
echo ""

# ── Tests ─────────────────────────────────────────────────────────────────────

# 1. DENY: GET /me without Authorization header → 401
r=$(req GET "$BASE_URL/api/users/me")
assert_status "GET /me — no Authorization header (deny)" "401" "$(status "$r")" "$(body "$r")"

# 2. DENY: PATCH /me without Authorization header → 401
r=$(req PATCH "$BASE_URL/api/users/me" "{\"username\":\"$TEST_USERNAME\"}")
assert_status "PATCH /me — no Authorization header (deny)" "401" "$(status "$r")" "$(body "$r")"

# 3. GET /me → 404 (no profile yet)
r=$(req GET "$BASE_URL/api/users/me" "" "Authorization: Bearer $ACCESS_TOKEN")
assert_status "GET /me — profile not found (404)" "404" "$(status "$r")" "$(body "$r")"

# 4. PATCH /me → 200 (creates profile)
r=$(req PATCH "$BASE_URL/api/users/me" "{\"username\":\"$TEST_USERNAME\"}" "Authorization: Bearer $ACCESS_TOKEN")
assert_status "PATCH /me — create profile (200)" "200" "$(status "$r")" "$(body "$r")"
# Response body is { userId, username, avatar_url } — same shape as GET /me.
# Captured here (not from /register, which no longer returns userId) for the
# id-scoped cases below (:id/stats, :id/matches, the batch lookup).
USER_ID=$(body "$r" | grep -o '"userId":[0-9]*' | grep -o '[0-9]*')
echo "  userId=$USER_ID"

# 5. GET /me → 200 (profile now exists)
r=$(req GET "$BASE_URL/api/users/me" "" "Authorization: Bearer $ACCESS_TOKEN")
assert_status "GET /me — profile exists (200)" "200" "$(status "$r")" "$(body "$r")"

# 6. DENY: PATCH /me with invalid username (spaces) → 400
r=$(req PATCH "$BASE_URL/api/users/me" "{\"username\":\"invalid name\"}" "Authorization: Bearer $ACCESS_TOKEN")
assert_status "PATCH /me — invalid username with spaces (400)" "400" "$(status "$r")" "$(body "$r")"

# 7. GET /:id/stats — user exists but has no matches → 200 with zeroed defaults
r=$(req GET "$BASE_URL/api/users/$USER_ID/stats" "" "Authorization: Bearer $ACCESS_TOKEN")
assert_status "GET /:id/stats — zero matches, zeroed defaults (200)" "200" "$(status "$r")" "$(body "$r")"

# 8. GET /:id/matches — user exists but has no matches → 200, empty array
r=$(req GET "$BASE_URL/api/users/$USER_ID/matches" "" "Authorization: Bearer $ACCESS_TOKEN")
assert_status "GET /:id/matches — zero matches, empty array (200)" "200" "$(status "$r")" "$(body "$r")"

# 9. DENY: GET /:id/matches?limit=51 → 400 (exceeds max)
r=$(req GET "$BASE_URL/api/users/$USER_ID/matches?limit=51" "" "Authorization: Bearer $ACCESS_TOKEN")
assert_status "GET /:id/matches — limit=51 exceeds max (deny 400)" "400" "$(status "$r")" "$(body "$r")"

# 10. DENY: GET /:id/stats — non-numeric id → 400
r=$(req GET "$BASE_URL/api/users/abc/stats" "" "Authorization: Bearer $ACCESS_TOKEN")
assert_status "GET /:id/stats — non-numeric id (deny 400)" "400" "$(status "$r")" "$(body "$r")"

# 11. DENY: GET /:id/stats — no Authorization header → 401
r=$(req GET "$BASE_URL/api/users/$USER_ID/stats")
assert_status "GET /:id/stats — no Authorization header (deny 401)" "401" "$(status "$r")" "$(body "$r")"

# 12. GET /?ids=... — batch lookup: 200, own id present in the body, unknown id (999999) omitted
r=$(req GET "$BASE_URL/api/users?ids=$USER_ID,999999" "" "Authorization: Bearer $ACCESS_TOKEN")
RESULT="false"
if [[ "$(status "$r")" == "200" ]] \
  && echo "$(body "$r")" | grep -q "\"userId\":$USER_ID" \
  && ! echo "$(body "$r")" | grep -q "999999"; then
  RESULT="true"
fi
assert "GET /?ids= — 200, own id present, unknown id 999999 omitted" "$RESULT" "$(body "$r")"

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "────────────────────────────────────────"
echo "Results: $PASS passed, $FAIL failed"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
