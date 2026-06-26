#!/usr/bin/env bash
# Usage: ./nginx/scripts/smoke-test.sh [base_url]
# Default: https://localhost (:443, self-signed cert — -k is applied to every request).
#
# Requires: full stack running (make up), migrations applied, nginx up.
# Tests the Public Edge end-to-end: TLS redirect, SPA serving, and
# REST proxy through nginx → gateway-api → auth-service.
#
# NOTE: each run registers a new user (email unique by PID) in the users
# table. These rows are NOT cleaned up automatically — acceptable for dev,
# but expect the table to accumulate smoke-test entries over time.
set -uo pipefail

BASE_URL="${1:-https://localhost}"
HTTP_URL="http://localhost"
PASS=0
FAIL=0

COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT

# ── Helpers ───────────────────────────────────────────────────────────────────

# Plain HTTPS request (no cookie jar). Output: body on line 1, HTTP status on line 2.
req() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  if [[ -n "$data" ]]; then
    curl -sk -w "\n%{http_code}" -X "$method" \
      -H "Content-Type: application/json" \
      -d "$data" \
      "${BASE_URL}${path}"
  else
    curl -sk -w "\n%{http_code}" -X "$method" \
      "${BASE_URL}${path}"
  fi
}

# Request that reads and writes the cookie jar.
req_jar() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  if [[ -n "$data" ]]; then
    curl -sk -w "\n%{http_code}" -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
      -X "$method" \
      -H "Content-Type: application/json" \
      -d "$data" \
      "${BASE_URL}${path}"
  else
    curl -sk -w "\n%{http_code}" -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
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

assert_not_status() {
  local name="$1"
  local forbidden="$2"
  local actual="$3"
  local response_body="${4:-}"
  if [[ "$actual" != "$forbidden" ]]; then
    echo "[PASS] $name (got HTTP $actual)"
    ((PASS++))
  else
    echo "[FAIL] $name — got HTTP $actual (must not be $forbidden)"
    [[ -n "$response_body" ]] && echo "       body: $response_body"
    ((FAIL++))
  fi
}

assert_contains() {
  local name="$1"
  local pattern="$2"
  local actual="$3"
  if echo "$actual" | grep -q "$pattern"; then
    echo "[PASS] $name"
    ((PASS++))
  else
    echo "[FAIL] $name — pattern '$pattern' not found in response"
    ((FAIL++))
  fi
}

# ── Tests ─────────────────────────────────────────────────────────────────────

TEST_EMAIL="smoketest_$$@example.com"
TEST_PASS="password123"

echo ""
echo "Running smoke tests against $BASE_URL"
echo "────────────────────────────────────────"

# 1. HTTP → HTTPS redirect
# Also serves as the regression guard for the default.conf bug: if the base
# image's default.conf coexisted with ours (two server blocks on :80), nginx
# could respond 200 instead of 301. This case catches that regression.
HTTP_STATUS=$(curl -sk -o /dev/null -w "%{http_code}" --max-redirs 0 "${HTTP_URL}/")
REDIRECT_URL=$(curl -sk -o /dev/null -w "%{redirect_url}" --max-redirs 0 "${HTTP_URL}/")
assert_status "GET http://localhost/ — 301 redirect" "301" "$HTTP_STATUS"
assert_contains "GET http://localhost/ — Location is https://" "^https://" "$REDIRECT_URL"

# 2. HTTPS SPA — confirms nginx serves the Vite build, not the base image default
SPA_BODY=$(curl -sk "${BASE_URL}/")
assert_contains "GET https://localhost/ — serves SPA (div#root present)" "<div id=\"root\">" "$SPA_BODY"

# 3. Register — confirms /api/ proxy works end-to-end: nginx → gateway-api → auth-service
r=$(req POST /api/auth/register "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}")
assert_status "POST /api/auth/register — new user" "201" "$(status "$r")" "$(body "$r")"

# 4. Login — cookie jar captures the refreshToken Set-Cookie from auth-service via nginx
r=$(req_jar POST /api/auth/login "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}")
assert_status "POST /api/auth/login — valid credentials" "200" "$(status "$r")" "$(body "$r")"

# 5. Refresh — jar sends cookie, jar captures rotated cookie
r=$(req_jar POST /api/auth/refresh)
assert_status "POST /api/auth/refresh — valid token" "200" "$(status "$r")" "$(body "$r")"

# 6. Logout
r=$(req_jar DELETE /api/auth/session)
assert_status "DELETE /api/auth/session — logout" "204" "$(status "$r")" "$(body "$r")"

# 7. DENY: refresh after logout — cookie was revoked; must not authenticate.
# Asserting "not 200" rather than a specific error code: the exact status
# (401, 403) is an implementation detail of gateway-api/auth-service that
# can change without being a real regression. What matters is that the
# revoked cookie does not grant access.
r=$(req_jar POST /api/auth/refresh)
assert_not_status "POST /api/auth/refresh — after logout (deny)" "200" "$(status "$r")" "$(body "$r")"

# ── Summary ───────────────────────────────────────────────────────────────────

echo "────────────────────────────────────────"
echo "Results: $PASS passed, $FAIL failed"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
