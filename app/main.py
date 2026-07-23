import asyncio
import json
import os
import secrets
import time
import logging
import re
import tempfile
import shutil
from typing import Any
from pathlib import Path
from contextlib import asynccontextmanager
from collections import defaultdict
from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import bcrypt

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("zone")

_APP_DIR = Path(__file__).resolve().parent          # app/
_PROJECT_ROOT = _APP_DIR.parent                     # project root

CONFIG_PATH = _APP_DIR / "config" / "zone-config.json"

# Load .env file if present
_env = _PROJECT_ROOT / ".env"
if _env.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(_env)
        log.info("loaded .env from %s", _env)
    except ImportError:
        pass
STATIC_DIR = _APP_DIR / "static"
DATA_DIR = Path(os.environ.get("ZONE_DATA_DIR", str(_PROJECT_ROOT / "data")))
ZONE_USERNAME = os.environ.get("ZONE_USERNAME", "").strip() or "admin"
ZONE_PASSWORD = os.environ.get("ZONE_PASSWORD", "").strip()
HF_TOKEN = os.environ.get("HF_TOKEN", "").strip()
try:
    SYNC_INTERVAL = max(60, int(os.environ.get("SYNC_INTERVAL", "1800") or "1800"))
except (ValueError, TypeError):
    SYNC_INTERVAL = 1800
SYNC_RESTORE = os.environ.get("SYNC_RESTORE", "true").strip().lower() in ("1", "true", "yes")
HUB_ENABLED = os.environ.get("HUB_ENABLED", "true").strip().lower() in ("1", "true", "yes")
HUB_URL = os.environ.get("HUB_URL", "").strip()
SPACE_ID = os.environ.get("SPACE_ID", "").strip()

_sync_task: asyncio.Task | None = None
_sync_last_fp: str | None = None
_sync_last_mm: tuple[int, int, int, str] | None = None

if HF_TOKEN:
    from app import sync as zone_sync

# GitHub sync — always importable (detects env at runtime)
from app import github_sync

_active_tokens = set()
_token_users: dict[str, str] = {}
_token_created: dict[str, float] = {}
COOKIE_NAME = "zone_session"
config_cache = {"data": None, "mtime": 0}
USERS_FILE = DATA_DIR / "users.json"
SESSIONS_FILE = DATA_DIR / "sessions.json"
GUEST_PREFIX = "guest_"
IS_LOCAL = SPACE_ID == ""
_server_restarted = True  # True until first successful auth — shows sync screen

# ── In-memory rate limiter ─────────────────────────
_login_attempts: dict[str, list[float]] = defaultdict(list)
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX = 10     # max attempts per window
TOKEN_EXPIRY_SECONDS = 86400 * 7  # 7 days
MAX_SESSIONS_TOTAL = 50           # global cap across all users

def rate_limit_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"

def check_rate_limit(key: str) -> None:
    now = time.time()
    window = RATE_LIMIT_WINDOW
    attempts = _login_attempts[key]
    while attempts and attempts[0] < now - window:
        attempts.pop(0)
    if len(attempts) >= RATE_LIMIT_MAX:
        log.warning("rate limit hit for %s", key)
        raise HTTPException(429, "too many requests — try again later")
    attempts.append(now)
    # NOTE: _login_attempts keys with empty lists are negligible memory (~70 bytes/IP).
    # Do NOT pop empty keys here — it would skip recording the attempt above.

def invalidate_user_sessions(username: str) -> None:
    for token, stored_uname in list(_token_users.items()):
        if stored_uname == username:
            _active_tokens.discard(token)
            del _token_users[token]
            _token_created.pop(token, None)
    save_sessions()

def expire_stale_tokens() -> None:
    now = time.time()
    stale = [t for t in list(_active_tokens) if _token_created.get(t, 0) < now - TOKEN_EXPIRY_SECONDS]
    for t in stale:
        _active_tokens.discard(t)
        _token_users.pop(t, None)
        _token_created.pop(t, None)


# ── Session persistence ────────────────────────────
def load_sessions() -> None:
    if not SESSIONS_FILE.exists():
        return
    try:
        saved = json.loads(SESSIONS_FILE.read_text())
        for token, uname in saved.get("token_users", {}).items():
            _active_tokens.add(token)
            _token_users[token] = uname
        for token, created in saved.get("token_created", {}).items():
            _token_created[token] = created
        for token in saved.get("guest_tokens", []):
            _active_tokens.add(token)
            if token not in _token_created:
                _token_created[token] = time.time()
        expire_stale_tokens()
        log.info("restored %d sessions", len(_active_tokens))
    except Exception as e:
        log.warning("failed to load sessions: %s", e)

def save_sessions() -> None:
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        guest_tokens = [t for t in _active_tokens if is_guest(t)]
        tmp = SESSIONS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps({
            "token_users": _token_users,
            "token_created": _token_created,
            "guest_tokens": guest_tokens,
        }))
        tmp.replace(SESSIONS_FILE)
    except Exception as e:
        log.warning("failed to save sessions: %s", e)

# ── Config ─────────────────────────────────────────
def load_config():
    if not CONFIG_PATH.exists():
        return {"identity": {}, "zones": []}
    mtime = CONFIG_PATH.stat().st_mtime
    if config_cache["mtime"] != mtime:
        with open(CONFIG_PATH) as f:
            config_cache["data"] = json.load(f)
        config_cache["mtime"] = mtime
    return config_cache["data"]

# ── User management ────────────────────────────────
_users_corrupted = False

def load_users() -> dict:
    global _users_corrupted
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if USERS_FILE.exists():
        try:
            raw = USERS_FILE.read_text()
            if not raw.strip():
                return {}
            data = json.loads(raw)
            _users_corrupted = False
            return data
        except (json.JSONDecodeError, OSError):
            log.warning("corrupted users file")
            _users_corrupted = True
            return {}
    return {}

def save_users(users: dict) -> None:
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        tmp = USERS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(users, indent=2))
        tmp.replace(USERS_FILE)
    except OSError as e:
        log.warning("failed to save users: %s", e)
        raise

def validate_password_length(pw: str) -> None:
    """Raise if password exceeds bcrypt's 72-byte limit."""
    if len(pw.encode("utf-8")) > 72:
        raise HTTPException(400, "password too long (bcrypt limit is 72 bytes; use fewer characters or shorter passphrase)")

def hash_password(pw: str) -> str:
    validate_password_length(pw)
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def check_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        log.warning("password check failed", exc_info=True)
        return False

def is_guest(token: str) -> bool:
    return token.startswith(GUEST_PREFIX)

def user_dir(username: str) -> Path:
    return DATA_DIR / "users" / username

def _read_json(p: Path) -> Any:
    if p.exists():
        try:
            raw = p.read_text()
            if not raw.strip():
                return {}
            return json.loads(raw)
        except (json.JSONDecodeError, OSError):
            log.warning("corrupted json file: %s", p)
            return {}
    return {}

def _write_json(p: Path, data) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2))
    tmp.replace(p)

def resolve_username(token: str) -> str | None:
    if is_guest(token):
        return None
    return _token_users.get(token)

USER_DATA_KEYS = frozenset({"stats", "tracking", "events", "settings", "session", "examTrack", "examDates", "examStartDate", "onboarded", "todos", "diary"})

# Default values per key — prevents _read_json returning {} for list-valued keys
# when the file is missing/empty/corrupt (which crashes the JS spread operator).
USER_DATA_DEFAULTS: dict[str, Any] = {
    "events": [],
    "examDates": [],
    "todos": [],
}

def read_user_data(uname: str) -> dict:
    if not uname:
        return {}
    d = user_dir(uname)
    out = {}
    for k in USER_DATA_KEYS:
        p = d / f"{k}.json"
        if p.exists():
            out[k] = _read_json(p)
            # Enforce expected type — fall back to default if file held wrong shape
            if k in USER_DATA_DEFAULTS and type(out[k]) is not type(USER_DATA_DEFAULTS[k]):
                out[k] = USER_DATA_DEFAULTS[k]
    return out

def write_user_data(uname: str, key: str, value: Any) -> None:
    if not uname or key not in USER_DATA_KEYS:
        return
    p = user_dir(uname) / f"{key}.json"
    _write_json(p, value)

# ── Pydantic models ────────────────────────────────
class LoginBody(BaseModel):
    username: str
    password: str

class SignupBody(BaseModel):
    username: str
    password: str

class ResetPasswordBody(BaseModel):
    username: str
    admin_password: str
    new_password: str

RESET_KEYS_FILE = DATA_DIR / "reset-keys.json"

def load_reset_keys() -> list:
    if RESET_KEYS_FILE.exists():
        try:
            return json.loads(RESET_KEYS_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            log.warning("corrupted reset keys file, returning empty list")
            return []
    return []

def save_reset_keys(keys: list) -> None:
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        tmp = RESET_KEYS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(keys, indent=2))
        tmp.replace(RESET_KEYS_FILE)
    except OSError as e:
        log.warning("failed to save reset keys: %s", e)
        raise

def make_secure_cookie(resp, token: str) -> None:
    resp.set_cookie(
        COOKIE_NAME, token,
        max_age=86400 * 7,
        httponly=True,
        samesite="lax",
        secure=not IS_LOCAL,
    )

def make_session(username: str) -> str:
    MAX_SESSIONS_PER_USER = 4

    # Get existing sessions for this user, sorted oldest first
    user_sessions = sorted(
        [(t, _token_created.get(t, 0)) for t, u in _token_users.items() if u == username],
        key=lambda x: x[1]
    )

    # If already at max (or over), evict oldest to make room
    while len(user_sessions) >= MAX_SESSIONS_PER_USER:
        oldest_token, _ = user_sessions.pop(0)
        _active_tokens.discard(oldest_token)
        _token_users.pop(oldest_token, None)
        _token_created.pop(oldest_token, None)

    token = secrets.token_hex(32)
    _active_tokens.add(token)
    _token_users[token] = username
    _token_created[token] = time.time()

    # Global cap to prevent unbounded growth
    if len(_active_tokens) > MAX_SESSIONS_TOTAL:
        by_age = sorted(_active_tokens, key=lambda t: _token_created.get(t, 0))
        for old_token in by_age[:len(_active_tokens) - MAX_SESSIONS_TOTAL]:
            _active_tokens.discard(old_token)
            _token_users.pop(old_token, None)
            _token_created.pop(old_token, None)

    save_sessions()
    return token

def ensure_user_dir(uname: str):
    u_dir = user_dir(uname)
    u_dir.mkdir(parents=True, exist_ok=True)
    cfg_file = u_dir / "config.json"
    if not cfg_file.exists():
        _write_json(cfg_file, load_config())

# ── Lifespan ───────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    load_config()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    load_sessions()
    if not ZONE_PASSWORD:
        log.warning("ZONE_PASSWORD is not set — signup still works, but admin login is disabled")

    restore_ok = True
    if HF_TOKEN and SYNC_RESTORE:
        try:
            restore_ok = await asyncio.to_thread(zone_sync.restore)
            if not restore_ok:
                log.warning("HF restore returned False — skipping sync loop to prevent wiping remote backup")
        except Exception as exc:
            restore_ok = False
            log.warning("HF restore failed: %s — skipping sync loop to prevent wiping remote backup", exc)

    if HF_TOKEN and restore_ok:
        global _sync_task, _sync_last_fp, _sync_last_mm
        _sync_task = asyncio.create_task(_sync_loop())

    # ── GitHub sync startup ─────────────────────────
    gh_sync_task: asyncio.Task | None = None
    if github_sync.GITHUB_SYNC_ENABLED != "false":
        try:
            gh_status = await asyncio.to_thread(github_sync.detect_environment)
            if gh_status.gh_authenticated:
                log.info("GitHub sync: authenticated as %s", gh_status.gh_username)
                if gh_status.repo_exists:
                    # Auto-pull if local data is empty
                    if not gh_status.data_dir_exists:
                        log.info("GitHub sync: local data empty, pulling from GitHub...")
                        result = await asyncio.to_thread(github_sync.pull_data)
                        if result.success:
                            log.info("GitHub sync: %s", result.message)
                        else:
                            log.warning("GitHub sync pull failed: %s", result.message)
                    # Start auto-sync background task
                    gh_sync_task = asyncio.create_task(_gh_sync_loop())
                else:
                    log.info("GitHub sync: repo '%s' not found. Use /api/github-sync/push to create.", github_sync.REPO_NAME)
            else:
                log.info("GitHub sync: not available (gh CLI not authenticated)")
        except Exception as exc:
            log.warning("GitHub sync init failed: %s", exc)

    yield

    # ── Shutdown ────────────────────────────────────
    if gh_sync_task is not None:
        gh_sync_task.cancel()
        try:
            await gh_sync_task
        except asyncio.CancelledError:
            pass

    if HF_TOKEN and _sync_task is not None:
        _sync_task.cancel()
        try:
            await _sync_task
        except asyncio.CancelledError:
            pass
        try:
            _sync_last_fp, _sync_last_mm = await asyncio.to_thread(zone_sync.sync_once, _sync_last_fp, _sync_last_mm)
        except Exception as exc:
            log.warning("final sync failed: %s", exc)
    save_sessions()
    log.info("sessions saved, shutting down")

async def _sync_loop():
    global _sync_last_fp, _sync_last_mm
    await asyncio.sleep(30)
    while True:
        try:
            _sync_last_fp, _sync_last_mm = await asyncio.to_thread(zone_sync.sync_once, _sync_last_fp, _sync_last_mm)
        except Exception as exc:
            log.warning("sync failed: %s", exc)
        await asyncio.sleep(SYNC_INTERVAL)

async def _gh_sync_loop():
    """Auto-push data to GitHub every 40 seconds (only if data changed)."""
    await asyncio.sleep(30)  # initial delay
    while True:
        try:
            if DATA_DIR.exists() and any(DATA_DIR.iterdir()):
                if github_sync.has_data_changed():
                    result = await asyncio.to_thread(github_sync.push_data)
                    if result.success:
                        github_sync.mark_pushed()
                        log.info("GitHub auto-sync: %s", result.message)
                    else:
                        log.warning("GitHub auto-sync failed: %s", result.message)
                else:
                    log.debug("GitHub auto-sync: no changes detected, skipping")
        except Exception as exc:
            log.warning("GitHub auto-sync error: %s", exc)
        await asyncio.sleep(github_sync.GITHUB_SYNC_INTERVAL)

# ── App creation ──────────────────────────────────
app = FastAPI(title="Zone Study OS", version="1.0.0", lifespan=lifespan)

# ── Security headers middleware ───────────────────
@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    resp.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com 'unsafe-inline'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://hf.space https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; frame-src 'none'; object-src 'none'"
    return resp

# ── Auth middleware ───────────────────────────────
@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    exempt = {"/health", "/keepalive", "/login.html", "/api/login", "/api/guest-login", "/api/signup", "/api/reset-password", "/api/sync/status", "/api/github-sync/status", "/api/sync-screen", "/api/sync-screen/push", "/api/sync-screen/pull"}
    if path in exempt:
        return await call_next(request)
    if path.startswith("/api/"):
        token = request.cookies.get(COOKIE_NAME, "")
        if not token or token not in _active_tokens:
            return JSONResponse({"error": "unauthorized"}, 401)
        if not is_guest(token) and _token_created.get(token, 0) < time.time() - TOKEN_EXPIRY_SECONDS:
            _active_tokens.discard(token)
            _token_users.pop(token, None)
            _token_created.pop(token, None)
            save_sessions()
            return JSONResponse({"error": "session expired"}, 401)
        request.state.token = token
        request.state.username = resolve_username(token)
        return await call_next(request)
    else:
        token = request.cookies.get(COOKIE_NAME, "")
        if token and token in _active_tokens:
            request.state.token = token
            request.state.username = resolve_username(token)

    resp = await call_next(request)
    ct = resp.headers.get("content-type", "")
    if "text/html" in ct or "javascript" in ct or "text/css" in ct:
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return resp

# ── Auth endpoints ────────────────────────────────
@app.post("/api/signup")
async def signup(body: SignupBody, request: Request):
    check_rate_limit(rate_limit_key(request))
    uname = body.username.strip()
    if not uname or len(uname) < 2 or len(uname) > 32 or not re.match(r"^[a-zA-Z0-9_-]+$", uname):
        raise HTTPException(400, "invalid signup data")
    if not body.password or len(body.password) < 8:
        raise HTTPException(400, "invalid signup data")
    if uname == ZONE_USERNAME:
        raise HTTPException(409, "username taken")
    users = load_users()
    if _users_corrupted:
        raise HTTPException(500, "user database corrupted — contact admin")
    if uname in users:
        raise HTTPException(409, "username taken")
    ensure_user_dir(uname)
    users[uname] = hash_password(body.password)
    save_users(users)
    token = make_session(uname)
    resp = JSONResponse({"token": token, "username": uname})
    make_secure_cookie(resp, token)
    log.info("user signed up: %s", uname)
    return resp

@app.post("/api/login")
async def login(body: LoginBody, request: Request):
    global _server_restarted
    check_rate_limit(rate_limit_key(request))
    uname = body.username.strip()
    if ZONE_PASSWORD and uname == ZONE_USERNAME and secrets.compare_digest(body.password, ZONE_PASSWORD):
        ensure_user_dir(uname)
        token = make_session(uname)
        resp = JSONResponse({"token": token, "username": uname})
        make_secure_cookie(resp, token)
        _server_restarted = False
        log.info("admin login: %s", uname)
        return resp
    users = load_users()
    if _users_corrupted:
        raise HTTPException(500, "user database corrupted — contact admin")
    if uname in users and check_password(body.password, users[uname]):
        ensure_user_dir(uname)
        token = make_session(uname)
        resp = JSONResponse({"token": token, "username": uname})
        make_secure_cookie(resp, token)
        _server_restarted = False
        log.info("user login: %s", uname)
        return resp
    raise HTTPException(401, "invalid credentials")

@app.post("/api/guest-login")
async def guest_login(request: Request):
    check_rate_limit(rate_limit_key(request))
    token = GUEST_PREFIX + secrets.token_hex(16)
    _active_tokens.add(token)
    _token_created[token] = time.time()
    save_sessions()
    resp = JSONResponse({"token": token, "guest": True})
    make_secure_cookie(resp, token)
    return resp

@app.post("/api/logout")
async def logout(request: Request):
    token = request.cookies.get(COOKIE_NAME, "")
    _active_tokens.discard(token)
    _token_users.pop(token, None)
    _token_created.pop(token, None)
    save_sessions()
    resp = JSONResponse({"status": "ok"})
    resp.set_cookie(COOKIE_NAME, "", max_age=0)
    return resp

@app.post("/api/reset-password")
async def reset_password(body: ResetPasswordBody, request: Request):
    check_rate_limit(rate_limit_key(request))
    if not ZONE_PASSWORD:
        raise HTTPException(400, "no auth configured")
    keys = load_reset_keys()
    key_used = any(secrets.compare_digest(body.admin_password, k) for k in keys)
    valid = secrets.compare_digest(body.admin_password, ZONE_PASSWORD) or key_used
    if not valid:
        raise HTTPException(403, "invalid admin password")
    uname = body.username.strip()
    if not re.match(r'^[a-zA-Z0-9_-]+$', uname) or len(uname) > 32:
        raise HTTPException(400, "invalid username format")
    users = load_users()
    if uname not in users:
        raise HTTPException(404, "user not found")
    if not body.new_password or len(body.new_password) < 8:
        raise HTTPException(400, "new password too short (minimum 8 characters)")
    users[uname] = hash_password(body.new_password)
    save_users(users)
    if key_used:
        keys = [k for k in keys if not secrets.compare_digest(body.admin_password, k)]
        save_reset_keys(keys)
    invalidate_user_sessions(uname)
    log.info("password reset for: %s", uname)
    return {"status": "ok", "message": "password reset for " + uname}

@app.post("/api/admin/generate-reset-key")
async def generate_reset_key(request: Request):
    uname = getattr(request.state, "username", None)
    if uname != ZONE_USERNAME:
        raise HTTPException(403, "only admin can generate reset keys")
    key = secrets.token_hex(8)
    keys = load_reset_keys()
    keys.append(key)
    save_reset_keys(keys)
    return {"key": key, "keys": keys, "note": "Share this key with users so they can reset their passwords."}

@app.get("/api/admin/reset-keys")
async def list_reset_keys(request: Request):
    uname = getattr(request.state, "username", None)
    if uname != ZONE_USERNAME:
        raise HTTPException(403, "only admin can view reset keys")
    return {"keys": load_reset_keys()}

class DeleteResetKeyBody(BaseModel):
    key: str

@app.post("/api/admin/delete-reset-key")
async def delete_reset_key(body: DeleteResetKeyBody, request: Request):
    uname = getattr(request.state, "username", None)
    if uname != ZONE_USERNAME:
        raise HTTPException(403, "only admin can delete reset keys")
    keys = load_reset_keys()
    keys = [k for k in keys if not secrets.compare_digest(body.key, k)]
    save_reset_keys(keys)
    return {"keys": keys, "status": "ok"}

@app.get("/api/auth-check")
async def auth_check(request: Request):
    token = getattr(request.state, "token", "")
    uname = getattr(request.state, "username", None)
    guest = is_guest(token)
    return {"authed": not guest, "guest": guest, "username": uname, "isAdmin": uname == ZONE_USERNAME}

class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str

@app.post("/api/change-password")
async def change_password(body: ChangePasswordBody, request: Request):
    check_rate_limit(rate_limit_key(request))
    uname = getattr(request.state, "username", None)
    if not uname:
        raise HTTPException(401, "not authenticated")
    users = load_users()
    if _users_corrupted:
        raise HTTPException(500, "user database corrupted — contact admin")
    if uname not in users:
        raise HTTPException(404, "user not found")
    if not check_password(body.current_password, users[uname]):
        raise HTTPException(403, "current password is incorrect")
    if not body.new_password or len(body.new_password) < 8:
        raise HTTPException(400, "new password too short (minimum 8 characters)")
    users[uname] = hash_password(body.new_password)
    save_users(users)
    invalidate_user_sessions(uname)
    new_token = make_session(uname)
    resp = JSONResponse({"status": "ok", "token": new_token})
    make_secure_cookie(resp, new_token)
    log.info("password changed for: %s", uname)
    return resp

class ChangeUsernameBody(BaseModel):
    new_username: str

@app.post("/api/change-username")
async def change_username(body: ChangeUsernameBody, request: Request):
    check_rate_limit(rate_limit_key(request))
    uname = getattr(request.state, "username", None)
    if not uname:
        raise HTTPException(401, "not authenticated")
    new_name = body.new_username.strip()
    if not new_name or len(new_name) < 2 or len(new_name) > 32:
        raise HTTPException(400, "username too short or too long (max 32)")
    if not re.match(r"^[a-zA-Z0-9_-]+$", new_name):
        raise HTTPException(400, "username can only contain letters, numbers, hyphens and underscores")
    if new_name == uname:
        return {"status": "ok", "username": uname}
    if uname == ZONE_USERNAME:
        raise HTTPException(400, "admin username cannot be changed")
    users = load_users()
    if _users_corrupted:
        raise HTTPException(500, "user database corrupted — contact admin")
    if new_name in users:
        raise HTTPException(409, "username taken")
    if new_name == ZONE_USERNAME:
        raise HTTPException(409, "username taken")
    old_dir = user_dir(uname)
    new_dir = user_dir(new_name)
    if new_dir.exists():
        raise HTTPException(409, "target data directory already exists")
    if old_dir.exists():
        try:
            old_dir.rename(new_dir)
        except OSError:
            raise HTTPException(500, "Failed to rename user data directory. Please try again in a few minutes.")
    else:
        ensure_user_dir(new_name)
    users[new_name] = users.pop(uname)
    save_users(users)
    for token, stored_uname in list(_token_users.items()):
        if stored_uname == uname:
            _token_users[token] = new_name
    save_sessions()
    log.info("username changed: %s -> %s", uname, new_name)
    return {"status": "ok", "username": new_name}

# ── Health ────────────────────────────────────────
_start_time = time.time()

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "uptime": round(time.time() - _start_time),
        "users": len(load_users()),
        "active_sessions": len(_active_tokens),
        "timestamp": time.time(),
    }

@app.get("/keepalive")
async def keepalive(request: Request):
    token = request.query_params.get("token", "")
    ct = os.environ.get("CRON_TOKEN", "")
    if ct and not secrets.compare_digest(token, ct):
        raise HTTPException(403, "invalid token")
    return {"status": "alive", "timestamp": time.time()}

# ── Config API ────────────────────────────────────
@app.get("/api/config")
async def get_config(request: Request):
    uname = getattr(request.state, "username", None)
    if uname:
        u_cfg = user_dir(uname) / "config.json"
        if u_cfg.exists():
            return _read_json(u_cfg)
    return load_config()

@app.put("/api/config")
async def update_config(data: dict, request: Request):
    if not data or not isinstance(data, dict):
        raise HTTPException(400, "config must be a non-empty object")
    uname = getattr(request.state, "username", None)
    if uname:
        _write_json(user_dir(uname) / "config.json", data)
        return {"status": "saved"}
    return {"status": "saved", "guest": True}

# ── User data API ─────────────────────────────────
@app.get("/api/user-data")
async def get_user_data(request: Request):
    uname = getattr(request.state, "username", None)
    if not uname:
        return {"guest": True}
    return read_user_data(uname)

class UserDataBody(BaseModel):
    key: str
    value: Any

@app.post("/api/user-data")
async def save_user_data(body: UserDataBody, request: Request):
    uname = getattr(request.state, "username", None)
    if not uname:
        return {"status": "ok", "guest": True}
    if body.key not in USER_DATA_KEYS:
        raise HTTPException(400, f"invalid key '{body.key}'")
    raw = json.dumps(body.value)
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(413, "data too large (max 5 MB)")
    # When browser saves session, protect desktop overlay controls.
    # If lastControl was recent (<10s), the browser's stale save would
    # overwrite the state change the desktop just made.
    if body.key == "session" and isinstance(body.value, dict):
        existing = _read_json(user_dir(uname) / "session.json")
        lc = existing.get("lastControl")
        if lc and isinstance(lc, dict):
            lc_ts = lc.get("ts", 0)
            age = time.time() - lc_ts
            if age < 10:
                action = lc.get("action", "")
                body.value["lastControl"] = lc
                # For any recent desktop control, preserve the full
                # zone state from the server (blockType, remaining, etc.)
                # — only let browser update non-timer fields.
                idx = existing.get("currentZoneIdx", 0)
                old_bz = existing.get("byZone", {})
                new_bz = body.value.get("byZone", {})
                if str(idx) in old_bz and str(idx) in new_bz:
                    # Keep desktop's state for this zone
                    new_bz[str(idx)] = old_bz[str(idx)]
                    body.value["byZone"] = new_bz
                if action == "start":
                    zs = body.value.get("byZone", {}).get(str(idx))
                    if zs:
                        zs["running"] = True
                        zs["lastTick"] = time.time() * 1000
            else:
                body.value["lastControl"] = lc
    write_user_data(uname, body.key, body.value)
    return {"status": "ok"}

# ── Exam tracks ───────────────────────────────────
TRACKS = [
    {"id": "JEE", "name": "JEE Main & Advanced", "zones": [
        {"id": 1, "title": "Morning Core", "subtitle": "Physics & Chemistry"},
        {"id": 2, "title": "Math Practice", "subtitle": "Problem solving"},
        {"id": 3, "title": "Revision", "subtitle": "Review & consolidate"},
        {"id": 4, "title": "Mock Test", "subtitle": "Simulated exam"},
        {"id": 5, "title": "Recovery Buffer", "subtitle": "Catch up"},
    ]},
    {"id": "NEET", "name": "NEET UG", "zones": [
        {"id": 1, "title": "Biology Core", "subtitle": "NCERT & concepts"},
        {"id": 2, "title": "Chemistry", "subtitle": "Physical & Organic"},
        {"id": 3, "title": "Physics", "subtitle": "Problem solving"},
        {"id": 4, "title": "Practice Test", "subtitle": "Mock questions"},
        {"id": 5, "title": "Recovery Buffer", "subtitle": "Catch up"},
    ]},
    {"id": "UPSC", "name": "UPSC Civil Services", "zones": [
        {"id": 1, "title": "Current Affairs", "subtitle": "Newspaper & magazines"},
        {"id": 2, "title": "Optional Subject", "subtitle": "Deep dive"},
        {"id": 3, "title": "GS Paper", "subtitle": "General studies"},
        {"id": 4, "title": "Answer Writing", "subtitle": "Practice"},
        {"id": 5, "title": "Recovery Buffer", "subtitle": "Catch up"},
    ]},
    {"id": "GATE", "name": "GATE", "zones": [
        {"id": 1, "title": "Core Subjects", "subtitle": "Technical depth"},
        {"id": 2, "title": "Aptitude", "subtitle": "Quant & reasoning"},
        {"id": 3, "title": "Previous Year", "subtitle": "PYQ practice"},
        {"id": 4, "title": "Mock Test", "subtitle": "Full length"},
        {"id": 5, "title": "Recovery Buffer", "subtitle": "Catch up"},
    ]},
    {"id": "CA", "name": "CA Foundation/Inter/Final", "zones": [
        {"id": 1, "title": "Accounts", "subtitle": "Financial accounting"},
        {"id": 2, "title": "Law", "subtitle": "Business laws"},
        {"id": 3, "title": "Taxation", "subtitle": "Direct & Indirect"},
        {"id": 4, "title": "Practice", "subtitle": "Problem solving"},
        {"id": 5, "title": "Recovery Buffer", "subtitle": "Catch up"},
    ]},
    {"id": "BOARDS", "name": "Board Exams", "zones": [
        {"id": 1, "title": "Subject 1", "subtitle": "Core topics"},
        {"id": 2, "title": "Subject 2", "subtitle": "Core topics"},
        {"id": 3, "title": "Subject 3", "subtitle": "Core topics"},
        {"id": 4, "title": "Revision", "subtitle": "Mixed practice"},
        {"id": 5, "title": "Recovery Buffer", "subtitle": "Catch up"},
    ]},
    {"id": "CUSTOM", "name": "Custom Track", "zones": [
        {"id": 1, "title": "Zone 1", "subtitle": "Morning session"},
        {"id": 2, "title": "Zone 2", "subtitle": "Deep work"},
        {"id": 3, "title": "Zone 3", "subtitle": "Afternoon session"},
        {"id": 4, "title": "Zone 4", "subtitle": "Practice"},
        {"id": 5, "title": "Zone 5", "subtitle": "Recovery buffer"},
    ]},
]

@app.get("/api/exam-tracks")
async def get_exam_tracks():
    return {"tracks": TRACKS}

# ── Timer sync API (desktop overlay) ──────────────
class TimerControlBody(BaseModel):
    action: str  # "start", "pause", "skip", "stop"

@app.get("/api/timer/state")
async def get_timer_state(request: Request):
    """Lightweight timer state for desktop overlay + cross-device sync."""
    uname = getattr(request.state, "username", None)
    if not uname:
        return {"guest": True}
    data = read_user_data(uname)
    session = data.get("session", {})
    config = _read_json(user_dir(uname) / "config.json") or load_config()
    # Extract zone titles for display
    zones = []
    for z in config.get("zones", []):
        zones.append({
            "title": z.get("title", "Zone"),
            "focusDuration": z.get("focusDuration", 25),
            "breakDurations": z.get("breakDurations", []),
        })
    return {
        "session": session,
        "zones": zones,
    }

@app.post("/api/timer/control")
async def timer_control(body: TimerControlBody, request: Request):
    """Remote timer control from desktop overlay."""
    uname = getattr(request.state, "username", None)
    if not uname:
        return {"status": "ok", "guest": True}
    if body.action not in ("start", "pause", "skip", "stop"):
        raise HTTPException(400, "invalid action")

    data = read_user_data(uname)
    session = data.get("session", {})
    by_zone = session.get("byZone", {})
    idx = session.get("currentZoneIdx", 0)
    zs = by_zone.get(str(idx))

    now = time.time()
    session["lastControl"] = {"action": body.action, "ts": now}

    if zs:
        if body.action == "start":
            zs["running"] = True
            zs["lastTick"] = now * 1000
        elif body.action == "pause":
            zs["running"] = False
        elif body.action == "stop":
            zs["running"] = False
            zs["remaining"] = zs.get("total", 25 * 60)
            zs["elapsed"] = 0
            zs["zoneElapsed"] = 0
            zs["blockComplete"] = False
            zs["overtimeSeconds"] = 0
        elif body.action == "skip":
            zs["running"] = False
            # If in overtime, log it
            if zs.get("blockComplete") and zs.get("overtimeSeconds", 0) > 0:
                zs["overtimeSeconds"] = 0
            if zs.get("blockType") == "focus":
                zs["blockType"] = "break"
                zs["remaining"] = 5 * 60
                zs["total"] = 5 * 60
            else:
                zs["cycle"] = zs.get("cycle", 0) + 1
                zs["blockType"] = "focus"
                # Reset to focus duration from config
                config = _read_json(user_dir(uname) / "config.json") or load_config()
                zones_cfg = config.get("zones", [])
                z_cfg = zones_cfg[idx] if idx < len(zones_cfg) else {}
                dur = (z_cfg.get("focusDuration", 25)) * 60
                zs["remaining"] = dur
                zs["total"] = dur
            zs["elapsed"] = 0
            zs["blockComplete"] = False
            zs["overtimeSeconds"] = 0
            zs["lastTick"] = now * 1000

    write_user_data(uname, "session", session)
    log.info("timer control from desktop: %s by %s", body.action, uname)
    return {"status": "ok", "session": session}

# ── Backup / sync ─────────────────────────────────
@app.post("/api/sync/trigger")
async def sync_trigger(request: Request):
    global _sync_last_fp, _sync_last_mm
    if not HF_TOKEN:
        raise HTTPException(400, "HF_TOKEN not configured")
    check_rate_limit(rate_limit_key(request))
    try:
        fp, mm = await asyncio.to_thread(zone_sync.sync_once, _sync_last_fp, _sync_last_mm)
        _sync_last_fp, _sync_last_mm = fp, mm
        return {"status": "ok"}
    except Exception as exc:
        raise HTTPException(500, str(exc))

@app.get("/api/sync/status")
async def sync_status():
    if not HF_TOKEN:
        return {"enabled": False}
    return {"enabled": True, "interval": SYNC_INTERVAL, "last_fp": _sync_last_fp is not None}

@app.get("/api/sync/export")
async def sync_export(request: Request):
    uname = getattr(request.state, "username", None)
    backup = {"config": load_config(), "exported_at": time.time()}
    if uname:
        backup["data"] = read_user_data(uname)
        cfg_file = user_dir(uname) / "config.json"
        if cfg_file.exists():
            backup["config"] = _read_json(cfg_file)
    return JSONResponse(content=backup, headers={
        "Content-Disposition": f"attachment; filename=zone-backup-{int(time.time())}.json",
    })

class SyncImportBody(BaseModel):
    data: dict

@app.post("/api/sync/import")
async def sync_import(body: SyncImportBody, request: Request):
    data = body.data
    uname = getattr(request.state, "username", None)
    errors = []
    if not uname:
        return {"status": "ok", "errors": ["guest users cannot import"]}
    if "config" in data:
        try:
            _write_json(user_dir(uname) / "config.json", data["config"])
            config_cache["mtime"] = 0
        except Exception as e:
            errors.append(f"config: {e}")
    user_data = data.get("data", data)
    for key in USER_DATA_KEYS:
        if key in user_data:
            try:
                raw = json.dumps(user_data[key])
                if len(raw) > 5 * 1024 * 1024:
                    errors.append(f"{key}: data too large (max 5 MB)")
                    continue
                write_user_data(uname, key, user_data[key])
            except Exception as e:
                errors.append(f"{key}: {e}")
    return {"status": "ok", "errors": errors}

# ── Pre-login Sync Screen ──────────────────────────
@app.get("/api/sync-screen")
async def sync_screen_status():
    """Check if sync screen should show (server restarted, data may be empty)."""
    global _server_restarted
    gh_status = await asyncio.to_thread(github_sync.detect_environment)
    has_users = USERS_FILE.exists() and USERS_FILE.stat().st_size > 2 if USERS_FILE.exists() else False
    has_data = DATA_DIR.exists() and any(DATA_DIR.iterdir()) if DATA_DIR.exists() else False
    return {
        "show": _server_restarted and gh_status.gh_authenticated,
        "gh_authenticated": gh_status.gh_authenticated,
        "gh_username": gh_status.gh_username,
        "repo_exists": gh_status.repo_exists,
        "repo_name": github_sync.REPO_NAME,
        "has_users": has_users,
        "has_data": has_data,
        "data_dir": str(github_sync.DATA_DIR),
    }

@app.post("/api/sync-screen/push")
async def sync_screen_push(request: Request):
    """Push from sync screen (admin only — requires admin password)."""
    global _server_restarted
    body = await request.json() if request.headers.get("content-type") == "application/json" else {}
    admin_pw = body.get("admin_password", "")
    if not ZONE_PASSWORD or not secrets.compare_digest(admin_pw, ZONE_PASSWORD):
        raise HTTPException(403, "admin password required")
    mode = body.get("mode", "normal")
    if mode not in ("normal", "force", "force-with-lease"):
        mode = "normal"
    result = await asyncio.to_thread(github_sync.push_data, force_mode=mode)
    if result.success:
        github_sync.mark_pushed()
        _server_restarted = False
    return {"success": result.success, "message": result.message,
            "direction": result.direction, "repo_url": result.repo_url,
            "files_affected": result.files_affected}

@app.post("/api/sync-screen/pull")
async def sync_screen_pull(request: Request):
    """Pull from sync screen (admin only — requires admin password)."""
    global _server_restarted
    body = await request.json() if request.headers.get("content-type") == "application/json" else {}
    admin_pw = body.get("admin_password", "")
    if not ZONE_PASSWORD or not secrets.compare_digest(admin_pw, ZONE_PASSWORD):
        raise HTTPException(403, "admin password required")
    mode = body.get("mode", "normal")
    if mode not in ("normal", "force", "force-with-lease"):
        mode = "normal"
    result = await asyncio.to_thread(github_sync.pull_data, force_mode=mode)
    if result.success:
        github_sync.mark_pushed()
        _server_restarted = False
        # Reload sessions after pull
        load_sessions()
    return {"success": result.success, "message": result.message,
            "direction": result.direction, "repo_url": result.repo_url,
            "files_affected": result.files_affected}

@app.post("/api/sync-screen/dismiss")
async def sync_screen_dismiss():
    """Dismiss sync screen — proceed to normal login."""
    global _server_restarted
    _server_restarted = False
    return {"ok": True}

# ── GitHub Data Sync (admin only) ───────────────────
def _require_admin(request: Request):
    """Check that the current user is the admin."""
    uname = getattr(request.state, "username", "")
    if uname != ZONE_USERNAME:
        raise HTTPException(403, "only admin can use GitHub sync")

@app.get("/api/github-sync/status")
async def github_sync_status(request: Request):
    """Check GitHub sync environment and repo status (any logged-in user can read)."""
    return github_sync.sync_status()

@app.post("/api/github-sync/push")
async def github_sync_push(request: Request):
    """Push local data to GitHub. Admin only. mode=normal|force|force-with-lease"""
    _require_admin(request)
    check_rate_limit(rate_limit_key(request))
    body = await request.json() if request.headers.get("content-type") == "application/json" else {}
    mode = body.get("mode", "normal")
    if mode not in ("normal", "force", "force-with-lease"):
        mode = "normal"
    result = await asyncio.to_thread(github_sync.push_data, force_mode=mode)
    if result.success:
        github_sync.mark_pushed()
    return {"success": result.success, "message": result.message,
            "direction": result.direction, "repo_url": result.repo_url,
            "files_affected": result.files_affected}

@app.post("/api/github-sync/pull")
async def github_sync_pull(request: Request):
    """Pull data from GitHub to local. Admin only. mode=normal|force|force-with-lease"""
    _require_admin(request)
    check_rate_limit(rate_limit_key(request))
    body = await request.json() if request.headers.get("content-type") == "application/json" else {}
    mode = body.get("mode", "normal")
    if mode not in ("normal", "force", "force-with-lease"):
        mode = "normal"
    result = await asyncio.to_thread(github_sync.pull_data, force_mode=mode)
    if result.success:
        github_sync.mark_pushed()
    return {"success": result.success, "message": result.message,
            "direction": result.direction, "repo_url": result.repo_url,
            "files_affected": result.files_affected}

# ── Hub dashboard ────────────────────────────────────
@app.get("/api/hub")
async def hub_info():
    url = HUB_URL or (f"https://{SPACE_ID.replace('/', '-')}.hf.space" if SPACE_ID else "")
    if not HUB_ENABLED or not url:
        return {"enabled": False}
    return {"enabled": True, "url": url, "space_id": SPACE_ID}

# ── Diary Attachments ─────────────────────────────
MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024  # 100 MB
ALLOWED_ATTACHMENT_TYPES = {
    # images
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml", "image/bmp", "image/tiff",
    # video
    "video/mp4", "video/webm", "video/quicktime", "video/x-msvideo",
    # documents
    "application/pdf",
    # text / markdown
    "text/markdown", "text/plain", "text/x-markdown",
}
ALLOWED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".tiff",
    ".mp4", ".webm", ".mov", ".avi",
    ".pdf", ".md", ".txt",
}

def _diary_attach_dir(username: str) -> Path:
    d = user_dir(username) / "diary-attachments"
    d.mkdir(parents=True, exist_ok=True)
    return d

@app.post("/api/diary/upload")
async def diary_upload(request: Request, file: UploadFile = File(...)):
    """Upload a file attachment for diary entries. Max 100MB."""
    uname = getattr(request.state, "username", None)
    if not uname:
        raise HTTPException(401, "not authenticated")

    # Validate extension
    ext = Path(file.filename or "unknown").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"file type not allowed: {ext}")

    # Validate content type
    ct = file.content_type or "application/octet-stream"
    # Some browsers send wrong types; fall back to extension check
    if ct not in ALLOWED_ATTACHMENT_TYPES and ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"content type not allowed: {ct}")

    # Read + size check
    content = await file.read()
    if len(content) > MAX_ATTACHMENT_SIZE:
        raise HTTPException(413, f"file too large (max {MAX_ATTACHMENT_SIZE // (1024*1024)} MB)")

    # Unique filename: timestamp + original extension
    safe_name = f"{int(time.time()*1000)}_{secrets.token_hex(4)}{ext}"
    attach_dir = _diary_attach_dir(uname)
    dest = attach_dir / safe_name
    dest.write_bytes(content)

    log.info("diary attachment uploaded: %s by %s (%d bytes)", safe_name, uname, len(content))
    return {
        "ok": True,
        "fileId": safe_name,
        "originalName": file.filename,
        "size": len(content),
        "type": ct,
        "url": f"/api/diary/attachment/{safe_name}",
    }

@app.get("/api/diary/attachment/{filename}")
async def diary_serve(filename: str, request: Request):
    """Serve a diary attachment file."""
    uname = getattr(request.state, "username", None)
    if not uname:
        raise HTTPException(401, "not authenticated")

    attach_dir = _diary_attach_dir(uname)
    # Sanitize: prevent path traversal
    safe = Path(filename).name
    if safe != filename or ".." in filename:
        raise HTTPException(400, "invalid filename")

    fp = attach_dir / safe
    if not fp.exists():
        raise HTTPException(404, "file not found")

    # Determine media type from extension
    ext = fp.suffix.lower()
    media_map = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
        ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
        ".bmp": "image/bmp", ".tiff": "image/tiff",
        ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
        ".avi": "video/x-msvideo",
        ".pdf": "application/pdf",
        ".md": "text/markdown", ".txt": "text/plain",
    }
    media_type = media_map.get(ext, "application/octet-stream")
    return FileResponse(fp, media_type=media_type)

@app.delete("/api/diary/attachment/{filename}")
async def diary_delete_attachment(filename: str, request: Request):
    """Delete a diary attachment file."""
    uname = getattr(request.state, "username", None)
    if not uname:
        raise HTTPException(401, "not authenticated")

    safe = Path(filename).name
    if safe != filename or ".." in filename:
        raise HTTPException(400, "invalid filename")

    fp = _diary_attach_dir(uname) / safe
    if fp.exists():
        fp.unlink()
        log.info("diary attachment deleted: %s by %s", safe, uname)
    return {"ok": True}

# ── Static files ──────────────────────────────────
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
