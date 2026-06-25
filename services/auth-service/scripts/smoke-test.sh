#!/usr/bin/env bash
# Usage: ./scripts/smoke-test.sh [base_url]
# Default: gateway-api at :4010 (cookie path /api/auth only matches via gateway).
# Requires: auth-service + gateway-api running, Postgres up, migrations applied.
set -uo pipefail

BASE_URL="${1:-http://localhost:4010}"
PASS=0
FAIL=0

# Temp file for the curl cookie jar — cleaned up on exit.
COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT

# ── Helpers ───────────────────────────────────────────────────────────────────

# Plain request (no cookie jar). Output: body on line 1, HTTP status on line 2.
req() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  if [[ -n "$data" ]]; then
    curl -s -w "\n%{http_code}" -X "$method" \
      -H "Content-Type: application/json" \
      -d "$data" \
      "${BASE_URL}${path}"
  else
    curl -s -w "\n%{http_code}" -X "$method" \
      "${BASE_URL}${path}"
  fi
}

# Request that reads and writes the cookie jar.
req_jar() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  if [[ -n "$data" ]]; then
    curl -s -w "\n%{http_code}" -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
      -X "$method" \
      -H "Content-Type: application/json" \
      -d "$data" \
      "${BASE_URL}${path}"
  else
    curl -s -w "\n%{http_code}" -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
      -X "$method" \
      "${BASE_URL}${path}"
  fi
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

TEST_EMAIL="smoketest_$$@example.com"
TEST_PASS="password123"

echo ""
echo "Running smoke tests against $BASE_URL"
echo "────────────────────────────────────────"

# 1. Register
r=$(req POST /api/auth/register "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}")
assert_status "POST /api/auth/register — new user" "201" "$(status "$r")" "$(body "$r")"

# 2. Duplicate email → 409
r=$(req POST /api/auth/register "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}")
assert_status "POST /api/auth/register — duplicate email" "409" "$(status "$r")" "$(body "$r")"

# 3. Invalid input (bad email + short password) → 400
r=$(req POST /api/auth/register '{"email":"notanemail","password":"123"}')
assert_status "POST /api/auth/register — invalid input" "400" "$(status "$r")" "$(body "$r")"

# 4. Login — cookie jar captures the refreshToken Set-Cookie
r=$(req_jar POST /api/auth/login "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}")
assert_status "POST /api/auth/login — valid credentials" "200" "$(status "$r")" "$(body "$r")"
ACCESS=$(body "$r" | jq -r '.accessToken')

# 5. Wrong password → 401 (same message as unknown user — no enumeration)
r=$(req POST /api/auth/login "{\"email\":\"$TEST_EMAIL\",\"password\":\"wrongpassword\"}")
assert_status "POST /api/auth/login — wrong password" "401" "$(status "$r")" "$(body "$r")"

# Capture the current cookie value before case 6 rotates it
OLD_REFRESH=$(awk '/refreshToken/{print $NF}' "$COOKIE_JAR")

# 6. Refresh — jar sends cookie, jar captures rotated cookie
r=$(req_jar POST /api/auth/refresh)
assert_status "POST /api/auth/refresh — valid token" "200" "$(status "$r")" "$(body "$r")"

# 7. Old refresh token (already rotated) → 401 — send the pre-rotation value
#    explicitly so we test the revoked token, not the fresh one in the jar.
r=$(curl -s -w "\n%{http_code}" -X POST \
  -b "refreshToken=$OLD_REFRESH" \
  "${BASE_URL}/api/auth/refresh")
assert_status "POST /api/auth/refresh — rotated token rejected" "401" "$(status "$r")" "$(body "$r")"

# 8. Logout — jar sends remaining cookie (the one from case 6, now revoked in DB),
#    gateway returns 204 and clears the cookie in the jar.
r=$(req_jar DELETE /api/auth/session)
assert_status "DELETE /api/auth/session — logout" "204" "$(status "$r")" "$(body "$r")"

# 9. Refresh after logout → 401 — jar cookie was cleared, gateway sees no cookie.
r=$(req_jar POST /api/auth/refresh)
assert_status "POST /api/auth/refresh — after logout" "401" "$(status "$r")" "$(body "$r")"

# 10. Refresh with no cookie at all → 401 (deny: guard rejects cookieless request)
r=$(req POST /api/auth/refresh)
assert_status "POST /api/auth/refresh — no cookie (deny)" "401" "$(status "$r")" "$(body "$r")"

# ── Summary ───────────────────────────────────────────────────────────────────

echo "────────────────────────────────────────"
echo "Results: $PASS passed, $FAIL failed"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
