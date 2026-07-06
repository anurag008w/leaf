#!/bin/sh
set -e

# Runs on every container start (fresh deploy, restart, redeploy).
# cronjob-keepalive-setup.py is safe to call unconditionally: it no-ops
# (exit 0) when KEEPALIVE_ENABLED / CRONJOB_API_KEY aren't set, and it
# cleans up its own stale jobs before creating a new one otherwise.
python cronjob-keepalive-setup.py || echo "keepalive setup failed, continuing startup anyway"

exec uvicorn app.main:app --host 0.0.0.0 --port 7860
