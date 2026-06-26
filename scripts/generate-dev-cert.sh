#!/usr/bin/env bash
set -e

CERT_DIR="$(dirname "$0")/../nginx/certs"
CERT_FILE="$CERT_DIR/cert.pem"
KEY_FILE="$CERT_DIR/key.pem"
FORCE=false

for arg in "$@"; do
  if [ "$arg" = "--force" ]; then
    FORCE=true
  fi
done

if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ] && [ "$FORCE" = false ]; then
  echo "Certs already exist, skipping. Use --force to regenerate."
  exit 0
fi

mkdir -p "$CERT_DIR"

echo ""
echo "Generating self-signed TLS certificate for local development."
echo "WARNING: This certificate is NOT trusted by browsers."
echo "         You will see a security warning — this is expected in dev."
echo "         Never use this certificate in production."
echo ""

openssl req -x509 \
  -newkey rsa:2048 \
  -nodes \
  -days 365 \
  -keyout "$KEY_FILE" \
  -out "$CERT_FILE" \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  2>/dev/null

echo "Generated:"
echo "  cert: $CERT_FILE"
echo "  key:  $KEY_FILE"
