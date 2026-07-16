#!/bin/sh
set -e

# Resolve data directory (default: ./data relative to project root)
DATA_DIR="${ZONE_DATA_DIR:-data}"
mkdir -p "$DATA_DIR"

# Pre-flight checks
if [ -z "$ZONE_PASSWORD" ] && [ "$(ls -A "$DATA_DIR/users" 2>/dev/null | wc -l)" -eq 0 ]; then
  echo "WARNING: ZONE_PASSWORD is not set and no users exist. Signup will be the only way to log in."
fi

echo "DATA_DIR=$DATA_DIR"

python cronjob-keepalive-setup.py || echo "keepalive setup failed, continuing startup anyway"

# Use $PORT env var if set (Render, Fly.io, etc.), default to 7860
PORT="${PORT:-7860}"

# NOTE: Wildcard is required for HF Spaces (all traffic proxied through HF infra
# with dynamic IPs). For self-hosted deployments, override with a specific proxy IP:
#   FORWARDED_ALLOW_IPS=127.0.0.1 entrypoint.sh
# This avoids trusting X-Forwarded-For from arbitrary peers, which bypasses
# IP-based rate limiting.
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT" --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-0.0.0.0}"
