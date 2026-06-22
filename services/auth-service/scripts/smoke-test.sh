#!/usr/bin/env bash
# Usage: ./scripts/smoke-test.sh [base_url]
# Assumes auth-service is already running and Postgres is up.
set -uo pipefail

BASE_URL="${1:-http://localhost:4001}"
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

# 1. Register
r=$(req POST /register "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}")
assert_status "POST /register — new user" "201" "$(status "$r")" "$(body "$r")"

# 2. Duplicate email → 409
r=$(req POST /register "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}")
assert_status "POST /register — duplicate email" "409" "$(status "$r")" "$(body "$r")"

# 3. Invalid input (bad email + short password) → 400
r=$(req POST /register '{"email":"notanemail","password":"123"}')
assert_status "POST /register — invalid input" "400" "$(status "$r")" "$(body "$r")"

# 4. Login
r=$(req POST /login "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}")
assert_status "POST /login — valid credentials" "200" "$(status "$r")" "$(body "$r")"
ACCESS=$(body "$r" | jq -r '.accessToken')
REFRESH=$(body "$r" | jq -r '.refreshToken')

# 5. Wrong password → 401 (same message as unknown user — no enumeration)
r=$(req POST /login "{\"email\":\"$TEST_EMAIL\",\"password\":\"wrongpassword\"}")
assert_status "POST /login — wrong password" "401" "$(status "$r")" "$(body "$r")"

# 6. Refresh — get new token pair
r=$(req POST /refresh "{\"refreshToken\":\"$REFRESH\"}")
assert_status "POST /refresh — valid token" "200" "$(status "$r")" "$(body "$r")"
NEW_REFRESH=$(body "$r" | jq -r '.refreshToken')

# 7. Old refresh token (already rotated) → 401
r=$(req POST /refresh "{\"refreshToken\":\"$REFRESH\"}")
assert_status "POST /refresh — rotated token rejected" "401" "$(status "$r")" "$(body "$r")"

# 8. Logout with the new refresh token → 204
r=$(req DELETE /session "{\"refreshToken\":\"$NEW_REFRESH\"}")
assert_status "DELETE /session — logout" "204" "$(status "$r")" "$(body "$r")"

# 9. Refresh after logout → 401
r=$(req POST /refresh "{\"refreshToken\":\"$NEW_REFRESH\"}")
assert_status "POST /refresh — after logout" "401" "$(status "$r")" "$(body "$r")"

# ── Summary ───────────────────────────────────────────────────────────────────

echo "────────────────────────────────────────"
echo "Results: $PASS passed, $FAIL failed"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
