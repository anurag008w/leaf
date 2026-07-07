#!/usr/bin/env python3
"""Create or reuse a cron-job.org job that keeps the Zone Console Space awake.

Adapted for the zone-console project — talks to the cron-job.org REST API
directly (https://docs.cron-job.org/rest-api.html) so you don't have to
click through the cron-job.org dashboard by hand. Safe to run repeatedly
(e.g. on every container start): it deletes any stale job it previously
created for the same URL before creating a fresh one.

Token setup : cron-job.org -> Console -> Settings -> API -> Generate Key
API docs    : https://docs.cron-job.org/rest-api.html

Env vars consumed:
  CRONJOB_API_KEY   — cron-job.org API key. Required for auto-setup; if
                      missing, this script no-ops (exit 0) so it's safe to
                      call unconditionally from the Dockerfile.
  KEEPALIVE_ENABLED — Set to 'true' to actually create/refresh the job.
  KEEPALIVE_CRON    — Standard 5-field cron expression.
                      Default: */10 * * * * (every 10 minutes).
  KEEPALIVE_URL     — Override ping target entirely.
                      Default: https://{SPACE_HOST}/keepalive?token={CRON_TOKEN}
                      (falls back to .../health if CRON_TOKEN is not set).
  CRON_TOKEN        — Same token server.js checks on /keepalive. Only used
                      here to build the default KEEPALIVE_URL.
  SPACE_HOST / SPACE_AUTHOR_NAME + SPACE_REPO_NAME
                    — Auto-injected by Hugging Face Spaces; used to build
                      the default ping target. See:
                      https://huggingface.co/docs/hub/en/spaces-overview#built-in-environment-variables

Status is written to KEEPALIVE_STATUS_FILE so you can sanity-check setup
from container logs instead of digging through the cron-job.org dashboard.
"""

from __future__ import annotations

import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API_BASE = "https://api.cron-job.org"
KEEPALIVE_STATUS_FILE = Path("/tmp/zone-console-keepalive-status.json")
JOB_TITLE_PREFIX = "Zone Console KeepAlive"


# ── HTTP helper ──────────────────────────────────────────────────────────────

def cj_request(
    method: str,
    path: str,
    token: str,
    body: bytes | None = None,
) -> dict:
    """Make a cron-job.org API request with up to 3 retries on transient errors."""
    last_error: Exception | None = None
    for attempt in range(1, 4):
        req = urllib.request.Request(
            f"{API_BASE}{path}",
            data=body,
            method=method,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw.strip() else {}
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"cron-job.org API HTTP {e.code}: {detail[:300]}")
        except (urllib.error.URLError, TimeoutError, ssl.SSLError, ConnectionError) as err:
            last_error = err
            if attempt == 3:
                break
            print(
                f"cron-job.org API {method} {path} failed transiently "
                f"({err}); retrying {attempt}/2...",
                file=sys.stderr,
            )
            time.sleep(1.5 * attempt)
    raise RuntimeError(f"cron-job.org API request failed after 3 attempts: {last_error}")


# ── Cron expression → cron-job.org schedule ──────────────────────────────────
# cron-job.org's JobSchedule fields (hours/mdays/minutes/months/wdays) each
# take a list of ints, with [-1] meaning "every value" for that field.
# Reference: https://docs.cron-job.org/rest-api.html#jobschedule

def _parse_field(field: str, lo: int, hi: int) -> list[int]:
    """Parse one field of a 5-field cron expression into cron-job.org's list format."""
    field = field.strip()
    if field == "*":
        return [-1]

    # */step  →  every `step` values starting at `lo`
    m = re.fullmatch(r"\*/(\d+)", field)
    if m:
        step = int(m.group(1))
        if step < 1:
            return [-1]
        return list(range(lo, hi + 1, step))

    # start-end/step  or  start-end
    m = re.fullmatch(r"(\d+)-(\d+)(?:/(\d+))?", field)
    if m:
        start, end = int(m.group(1)), int(m.group(2))
        step = int(m.group(3)) if m.group(3) else 1
        return list(range(max(start, lo), min(end, hi) + 1, max(step, 1)))

    # comma-separated values
    if "," in field:
        vals = []
        for part in field.split(","):
            part = part.strip()
            if part.isdigit():
                vals.append(int(part))
        return vals if vals else [-1]

    # Single value
    if field.isdigit():
        return [int(field)]

    # Unrecognised — treat as wildcard
    return [-1]


def cron_to_schedule(expr: str) -> dict:
    """
    Convert a standard 5-field cron expression to a cron-job.org schedule dict.
    Unsupported / malformed expressions fall back to every 10 minutes.
    """
    parts = expr.strip().split()
    if len(parts) != 5:
        print(
            f"Warning: cannot parse cron expression '{expr}' — "
            "defaulting to */10 * * * * (every 10 minutes).",
            file=sys.stderr,
        )
        return _default_schedule()

    minute_f, hour_f, mday_f, month_f, wday_f = parts
    return {
        "timezone": "UTC",
        "expiresAt": 0,
        "minutes": _parse_field(minute_f, 0, 59),
        "hours":   _parse_field(hour_f,   0, 23),
        "mdays":   _parse_field(mday_f,   1, 31),
        "months":  _parse_field(month_f,  1, 12),
        "wdays":   _parse_field(wday_f,   0, 6),
    }


def _default_schedule() -> dict:
    return {
        "timezone": "UTC",
        "expiresAt": 0,
        "minutes": [0, 10, 20, 30, 40, 50],
        "hours": [-1],
        "mdays": [-1],
        "months": [-1],
        "wdays": [-1],
    }


# ── Space host / target URL helpers ──────────────────────────────────────────

def get_space_host() -> str:
    host = os.environ.get("SPACE_HOST", "").strip()
    if host:
        return host
    author = os.environ.get("SPACE_AUTHOR_NAME", "").strip()
    repo   = os.environ.get("SPACE_REPO_NAME",   "").strip()
    if author and repo:
        return f"{author}-{repo}.hf.space".lower()
    return ""


def default_target_url(space_host: str) -> str:
    """Prefer the token-gated /keepalive endpoint; fall back to /health
    (unauthenticated) if no CRON_TOKEN is configured."""
    cron_token = os.environ.get("CRON_TOKEN", "").strip()
    if cron_token:
        return f"https://{space_host}/keepalive?token={cron_token}"
    return f"https://{space_host}/health"


# ── Status file ───────────────────────────────────────────────────────────────

def write_status(payload: dict) -> None:
    payload = {
        **payload,
        "timestamp": payload.get("timestamp")
            or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    KEEPALIVE_STATUS_FILE.write_text(json.dumps(payload), encoding="utf-8")
    try:
        KEEPALIVE_STATUS_FILE.chmod(0o600)
    except OSError:
        pass


# ── cron-job.org job management ───────────────────────────────────────────────

def list_existing_jobs(token: str, target_url: str) -> list[int]:
    """
    Return job IDs that belong to Zone Console and ping `target_url`.
    Silently returns [] if the list call fails.
    """
    try:
        result = cj_request("GET", "/jobs", token)
        jobs = result.get("jobs", result) if isinstance(result, dict) else result
        if not isinstance(jobs, list):
            return []
        return [
            int(j["jobId"])
            for j in jobs
            if (
                j.get("url", "") == target_url
                and str(j.get("title", "")).startswith(JOB_TITLE_PREFIX)
            )
        ]
    except Exception as exc:
        print(f"Warning: could not list existing cron jobs: {exc}", file=sys.stderr)
        return []


def delete_job(token: str, job_id: int) -> None:
    try:
        cj_request("DELETE", f"/jobs/{job_id}", token)
        print(f"  Deleted stale cron job #{job_id}", file=sys.stderr)
    except Exception as exc:
        print(f"  Warning: failed to delete cron job #{job_id}: {exc}", file=sys.stderr)


def create_job(token: str, target_url: str, cron_expr: str) -> int:
    """Create a new cron job and return its jobId."""
    schedule = cron_to_schedule(cron_expr)
    title = f"{JOB_TITLE_PREFIX} — {target_url}"[:255]
    payload = json.dumps({
        "job": {
            "url": target_url,
            "enabled": True,
            "title": title,
            "saveResponses": False,
            "schedule": schedule,
        }
    }).encode()

    # cron-job.org uses PUT /jobs to create; response is {"jobId": <int>}
    result = cj_request("PUT", "/jobs", token, body=payload)

    job_id = (
        result.get("jobId")
        or (result.get("job") or {}).get("jobId")
    )
    if not job_id:
        raise RuntimeError(
            f"Unexpected cron-job.org create response (no jobId): "
            f"{json.dumps(result)[:200]}"
        )
    return int(job_id)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> int:
    enabled = os.environ.get("KEEPALIVE_ENABLED", "false").strip().lower()
    api_token = os.environ.get("CRONJOB_API_KEY", "").strip()

    if enabled not in {"1", "true", "yes", "on"}:
        write_status({
            "configured": False,
            "status": "disabled",
            "message": (
                "Keep-awake is disabled. "
                "Set KEEPALIVE_ENABLED=true and CRONJOB_API_KEY to enable."
            ),
        })
        return 0

    if not api_token:
        write_status({
            "configured": False,
            "status": "disabled",
            "message": "CRONJOB_API_KEY not set — keep-awake skipped.",
        })
        return 0

    space_host = get_space_host()
    if not space_host:
        write_status({
            "configured": False,
            "status": "skipped",
            "message": "SPACE_HOST not set — cannot determine ping target. Keep-awake skipped.",
        })
        return 0

    # Normalise host: strip protocol + trailing path
    space_host = (
        space_host
        .removeprefix("https://")
        .removeprefix("http://")
        .split("/")[0]
    )
    target_url = os.environ.get("KEEPALIVE_URL", "").strip() or default_target_url(space_host)
    cron_expr = os.environ.get("KEEPALIVE_CRON", "*/10 * * * *").strip()

    try:
        # Remove any stale jobs from previous starts (container restarts,
        # redeploys, etc.) so we don't accumulate duplicate keep-alive jobs.
        stale = list_existing_jobs(api_token, target_url)
        for jid in stale:
            delete_job(api_token, jid)

        print(
            f"Creating cron-job.org keep-awake job: "
            f"{target_url} @ '{cron_expr}'...",
            file=sys.stderr,
        )
        job_id = create_job(api_token, target_url, cron_expr)

        write_status({
            "configured": True,
            "status": "configured",
            "provider": "cron-job.org",
            "jobId": job_id,
            "targetUrl": target_url,
            "cron": cron_expr,
            "message": f"cron-job.org job #{job_id} pings {target_url} ({cron_expr}).",
        })
        print(
            f"Keep-awake active: job #{job_id} pings {target_url}",
            file=sys.stderr,
        )
        return 0

    except RuntimeError as exc:
        msg = str(exc)
        print(f"cron-job.org keep-awake setup failed: {msg}", file=sys.stderr)
        write_status({"configured": False, "status": "error", "message": msg})
        return 1
    except Exception as exc:
        msg = str(exc)
        print(f"cron-job.org keep-awake setup failed (unexpected): {msg}", file=sys.stderr)
        write_status({"configured": False, "status": "error", "message": msg})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
