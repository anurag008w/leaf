#!/bin/sh
set -e

# Pre-flight checks
if [ -z "$ZONE_PASSWORD" ] && [ "$(ls -A data/users 2>/dev/null | wc -l)" -eq 0 ]; then
  echo "WARNING: ZONE_PASSWORD is not set and no users exist. Signup will be the only way to log in."
fi

if [ -n "$ZONE_DATA_DIR" ]; then
  mkdir -p "$ZONE_DATA_DIR"
  echo "ZONE_DATA_DIR=$ZONE_DATA_DIR"
fi

python cronjob-keepalive-setup.py || echo "keepalive setup failed, continuing startup anyway"

# NOTE: Wildcard is required for HF Spaces (all traffic proxied through HF infra
# with dynamic IPs). For self-hosted deployments, override with a specific proxy IP:
#   FORWARDED_ALLOW_IPS=127.0.0.1 entrypoint.sh
# This avoids trusting X-Forwarded-For from arbitrary peers, which bypasses
# IP-based rate limiting.
exec uvicorn app.main:app --host 0.0.0.0 --port 7860 --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}"
