import json
import os
import secrets
import time
import asyncio
import base64
import hmac
import hashlib
import tempfile
import shutil
import logging
import re
from pathlib import Path
from contextlib import asynccontextmanager
from collections import defaultdict
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from cryptography.fernet import Fernet
import bcrypt

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("zone")

CONFIG_PATH = Path(__file__).parent / "config" / "zone-config.json"
STATIC_DIR = Path(__file__).parent / "static"
DATA_DIR = Path(os.environ.get("ZONE_DATA_DIR", str(Path(__file__).parent.parent / "data")))
ZONE_USERNAME = os.environ.get("ZONE_USERNAME", "").strip() or "admin"
ZONE_PASSWORD = os.environ.get("ZONE_PASSWORD", "").strip()
SYNC_HF_TOKEN = os.environ.get("HF_TOKEN", "").strip()
SYNC_DATASET = os.environ.get("SYNC_DATASET", "").strip()

_active_tokens = set()
_token_users: dict[str, str] = {}
COOKIE_NAME = "zone_session"
config_cache = {"data": None, "mtime": 0}
USERS_FILE = DATA_DIR / "users.json"
SESSIONS_FILE = DATA_DIR / "sessions.json"
GUEST_PREFIX = "guest_"
SECRET_KEY = os.environ.get("ZONE_SECRET", "").strip()
IS_LOCAL = os.environ.get("SPACE_ID", "").strip() == ""

# ── In-memory rate limiter ─────────────────────────
_login_attempts: dict[str, list[float]] = defaultdict(list)
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX = 10     # max attempts per window

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

# ── Session persistence ────────────────────────────
def load_sessions() -> None:
    if not SESSIONS_FILE.exists():
        return
    try:
        saved = json.loads(SESSIONS_FILE.read_text())
        for token, uname in saved.get("token_users", {}).items():
            _active_tokens.add(token)
            _token_users[token] = uname
        for token in saved.get("guest_tokens", []):
            _active_tokens.add(token)
        log.info("restored %d sessions", len(_active_tokens))
    except Exception as e:
        log.warning("failed to load sessions: %s", e)

def save_sessions() -> None:
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        guest_tokens = [t for t in _active_tokens if is_guest(t)]
        SESSIONS_FILE.write_text(json.dumps({
            "token_users": _token_users,
            "guest_tokens": guest_tokens,
        }, indent=2))
    except Exception as e:
        log.warning("failed to save sessions: %s", e)

# ── Encryption ─────────────────────────────────────
def get_secret() -> bytes:
    global SECRET_KEY
    if SECRET_KEY:
        return SECRET_KEY.encode()
    sk = DATA_DIR / "secret.key"
    if sk.exists():
        SECRET_KEY = sk.read_text().strip()
    else:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        SECRET_KEY = secrets.token_hex(32)
        sk.write_text(SECRET_KEY)
    return SECRET_KEY.encode()

def user_fernet(username: str) -> Fernet:
    key = base64.urlsafe_b64encode(
        hmac.new(get_secret(), username.encode(), hashlib.sha256).digest()
    )
    return Fernet(key)

def encrypt_write(p: Path, data, username: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    plain = json.dumps(data, indent=2).encode()
    encrypted = user_fernet(username).encrypt(plain)
    p.write_bytes(encrypted)

def decrypt_read(p: Path, username: str):
    if not p.exists():
        return {}
    try:
        raw = p.read_bytes()
        plain = user_fernet(username).decrypt(raw)
        return json.loads(plain)
    except Exception:
        return {}

# ── Config ─────────────────────────────────────────
def load_config():
    mtime = CONFIG_PATH.stat().st_mtime
    if config_cache["mtime"] != mtime:
        with open(CONFIG_PATH) as f:
            config_cache["data"] = json.load(f)
        config_cache["mtime"] = mtime
    return config_cache["data"]

# ── User management ────────────────────────────────
def load_users() -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if USERS_FILE.exists():
        return json.loads(USERS_FILE.read_text())
    return {}

def save_users(users: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    USERS_FILE.write_text(json.dumps(users, indent=2))

def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def check_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return pw == hashed  # fallback for legacy plaintext

def is_guest(token: str) -> bool:
    return token.startswith(GUEST_PREFIX)

def user_dir(username: str) -> Path:
    return DATA_DIR / "users" / username

def _read_json(p: Path) -> dict:
    if p.exists():
        return json.loads(p.read_text())
    return {}

def _write_json(p: Path, data) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2))

def resolve_username(token: str) -> str | None:
    if is_guest(token):
        return None
    return _token_users.get(token)

USER_DATA_KEYS = ("stats", "tracking", "events", "settings", "session")

def read_user_data(uname: str) -> dict:
    d = user_dir(uname)
    out = {}
    for k in USER_DATA_KEYS:
        p = d / f"{k}.json"
        if p.exists():
            if is_encrypted(uname):
                out[k] = decrypt_read(p, uname)
            else:
                out[k] = _read_json(p)
    return out

def write_user_data(uname: str, key: str, value) -> None:
    if key not in USER_DATA_KEYS:
        return
    p = user_dir(uname) / f"{key}.json"
    if is_encrypted(uname):
        encrypt_write(p, value, uname)
    else:
        _write_json(p, value)

def is_encrypted(uname: str) -> bool:
    return (user_dir(uname) / ".encrypted").exists()

def mark_encrypted(uname: str) -> None:
    (user_dir(uname) / ".encrypted").write_text("1")

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
        return json.loads(RESET_KEYS_FILE.read_text())
    return []

def save_reset_keys(keys: list) -> None:
    RESET_KEYS_FILE.write_text(json.dumps(keys, indent=2))

def make_secure_cookie(resp, token: str) -> None:
    resp.set_cookie(
        COOKIE_NAME, token,
        max_age=86400 * 30,
        httponly=True,
        samesite="lax",
        secure=not IS_LOCAL,
    )

def make_session(username: str) -> str:
    token = secrets.token_hex(32)
    _active_tokens.add(token)
    _token_users[token] = username
    save_sessions()
    return token

def ensure_user_dir(uname: str):
    u_dir = user_dir(uname)
    u_dir.mkdir(parents=True, exist_ok=True)
    cfg_file = u_dir / "config.json"
    if not cfg_file.exists():
        _write_json(cfg_file, load_config())

def migrate_to_encrypted(uname: str):
    if is_encrypted(uname):
        return
    u_dir = user_dir(uname)
    for k in USER_DATA_KEYS:
        p = u_dir / f"{k}.json"
        if p.exists():
            try:
                data = _read_json(p)
                encrypt_write(p, data, uname)
            except Exception:
                pass
    mark_encrypted(uname)

# ── Lifespan ───────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup
    load_config()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    load_sessions()
    if not SECRET_KEY:
        get_secret()
        log.warning(
            "ZONE_SECRET is not set. Generated key saved to %s/secret.key. "
            "If that path isn't persistent, data will become undecryptable on restart.",
            DATA_DIR,
        )
    if not ZONE_PASSWORD:
        log.warning("ZONE_PASSWORD is not set — signup still works, but admin login is disabled")
    if not SYNC_HF_TOKEN:
        log.info("HF_TOKEN not set — HF sync disabled")
    else:
        ds = SYNC_DATASET or "<auto>"
        log.info("HF sync configured — dataset: %s", ds)
        asyncio.create_task(auto_sync_loop())

    yield

    # shutdown
    save_sessions()
    log.info("sessions saved, shutting down")

# ── App creation ──────────────────────────────────
app = FastAPI(title="Zone Study OS", version="1.0.0", lifespan=lifespan)

# ── Security headers middleware ───────────────────
@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["X-XSS-Protection"] = "1; mode=block"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return resp

# ── Auth middleware ───────────────────────────────
@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    exempt = {"/health", "/keepalive", "/login.html", "/api/login", "/api/guest-login", "/api/signup", "/api/reset-password"}
    if path in exempt:
        return await call_next(request)
    if path.startswith("/api/"):
        # api subroutes that aren't in exempt
        if not any(path.startswith(p) for p in ("/api/login", "/api/guest-login", "/api/signup", "/api/reset-password")):
            token = request.cookies.get(COOKIE_NAME, "")
            if not token or token not in _active_tokens:
                return JSONResponse({"error": "unauthorized"}, 401)
            request.state.token = token
            request.state.username = resolve_username(token)
            return await call_next(request)
    else:
        # non-api: static files, require auth
        token = request.cookies.get(COOKIE_NAME, "")
        if not token or token not in _active_tokens:
            resp = RedirectResponse(url="/login.html")
            resp.delete_cookie(COOKIE_NAME)
            return resp
        request.state.token = token
        request.state.username = resolve_username(token)

    resp = await call_next(request)
    ct = resp.headers.get("content-type", "")
    if "text/html" in ct:
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return resp

# ── Auth endpoints ────────────────────────────────
@app.post("/api/signup")
async def signup(body: SignupBody):
    check_rate_limit(body.username.strip())
    uname = body.username.strip()
    if not uname or len(uname) < 2:
        raise HTTPException(400, "username too short")
    if not re.match(r"^[a-zA-Z0-9_-]+$", uname):
        raise HTTPException(400, "username can only contain letters, numbers, hyphens and underscores")
    if not body.password or len(body.password) < 3:
        raise HTTPException(400, "password too short")
    users = load_users()
    if uname in users:
        raise HTTPException(409, "username taken")
    users[uname] = hash_password(body.password)
    save_users(users)
    ensure_user_dir(uname)
    mark_encrypted(uname)
    token = make_session(uname)
    resp = JSONResponse({"token": token, "username": uname})
    make_secure_cookie(resp, token)
    log.info("user signed up: %s", uname)
    return resp

@app.post("/api/login")
async def login(body: LoginBody):
    check_rate_limit(body.username.strip())
    uname = body.username.strip()
    if ZONE_PASSWORD and uname == ZONE_USERNAME and body.password == ZONE_PASSWORD:
        ensure_user_dir(uname)
        token = make_session(uname)
        migrate_to_encrypted(uname)
        resp = JSONResponse({"token": token, "username": uname})
        make_secure_cookie(resp, token)
        log.info("admin login: %s", uname)
        return resp
    users = load_users()
    if uname in users and check_password(body.password, users[uname]):
        ensure_user_dir(uname)
        token = make_session(uname)
        migrate_to_encrypted(uname)
        resp = JSONResponse({"token": token, "username": uname})
        make_secure_cookie(resp, token)
        log.info("user login: %s", uname)
        return resp
    raise HTTPException(401, "invalid credentials")

@app.get("/api/guest-login")
async def guest_login():
    token = GUEST_PREFIX + secrets.token_hex(16)
    _active_tokens.add(token)
    save_sessions()
    resp = JSONResponse({"token": token, "guest": True})
    make_secure_cookie(resp, token)
    return resp

@app.post("/api/logout")
async def logout(request: Request):
    token = request.cookies.get(COOKIE_NAME, "")
    _active_tokens.discard(token)
    _token_users.pop(token, None)
    save_sessions()
    resp = JSONResponse({"status": "ok"})
    resp.set_cookie(COOKIE_NAME, "", max_age=0)
    return resp

@app.post("/api/reset-password")
async def reset_password(body: ResetPasswordBody):
    check_rate_limit("reset-password")
    if not ZONE_PASSWORD:
        raise HTTPException(400, "no auth configured")
    keys = load_reset_keys()
    valid = body.admin_password == ZONE_PASSWORD or body.admin_password in keys
    if not valid:
        raise HTTPException(403, "invalid admin password")
    uname = body.username.strip()
    users = load_users()
    if uname not in users:
        raise HTTPException(404, "user not found")
    if not body.new_password or len(body.new_password) < 3:
        raise HTTPException(400, "new password too short")
    users[uname] = hash_password(body.new_password)
    save_users(users)
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
    return {"key": key, "note": "Share this key with users so they can reset their passwords."}

@app.get("/api/auth-check")
async def auth_check(request: Request):
    token = getattr(request.state, "token", "")
    uname = getattr(request.state, "username", None)
    return {"authed": True, "guest": is_guest(token), "username": uname, "isAdmin": uname == ZONE_USERNAME}

class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str

@app.post("/api/change-password")
async def change_password(body: ChangePasswordBody, request: Request):
    uname = getattr(request.state, "username", None)
    if not uname:
        raise HTTPException(401, "not authenticated")
    users = load_users()
    if uname not in users:
        raise HTTPException(404, "user not found")
    if not check_password(body.current_password, users[uname]):
        raise HTTPException(403, "current password is incorrect")
    if not body.new_password or len(body.new_password) < 3:
        raise HTTPException(400, "new password too short")
    users[uname] = hash_password(body.new_password)
    save_users(users)
    log.info("password changed for: %s", uname)
    return {"status": "ok"}

class ChangeUsernameBody(BaseModel):
    new_username: str

@app.post("/api/change-username")
async def change_username(body: ChangeUsernameBody, request: Request):
    uname = getattr(request.state, "username", None)
    if not uname:
        raise HTTPException(401, "not authenticated")
    new_name = body.new_username.strip()
    if not new_name or len(new_name) < 2:
        raise HTTPException(400, "username too short")
    if not re.match(r"^[a-zA-Z0-9_-]+$", new_name):
        raise HTTPException(400, "username can only contain letters, numbers, hyphens and underscores")
    if new_name == uname:
        return {"status": "ok", "username": uname}
    users = load_users()
    if new_name in users:
        raise HTTPException(409, "username taken")
    users[new_name] = users.pop(uname)
    save_users(users)
    old_dir = user_dir(uname)
    new_dir = user_dir(new_name)
    if old_dir.exists():
        old_dir.rename(new_dir)
    # Update all active sessions for this user
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
    if ct and token != ct:
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
    uname = getattr(request.state, "username", None)
    if uname:
        _write_json(user_dir(uname) / "config.json", data)
        config_cache["mtime"] = 0
        return {"status": "saved"}
    with open(CONFIG_PATH, "w") as f:
        json.dump(data, f, indent=2)
    config_cache["mtime"] = 0
    return {"status": "saved"}

# ── User data API ─────────────────────────────────
@app.get("/api/user-data")
async def get_user_data(request: Request):
    uname = getattr(request.state, "username", None)
    if not uname:
        return {"guest": True}
    return read_user_data(uname)

class UserDataBody(BaseModel):
    key: str
    value: dict

@app.post("/api/user-data")
async def save_user_data(body: UserDataBody, request: Request):
    uname = getattr(request.state, "username", None)
    if not uname:
        return {"status": "ok", "guest": True}
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

# ── Backup / sync ─────────────────────────────────
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
                write_user_data(uname, key, user_data[key])
            except Exception as e:
                errors.append(f"{key}: {e}")
    return {"status": "ok", "errors": errors}

# ── HF Sync ──────────────────────────────────────
SYNC_STATE_FILE = "sync-state.json"
SYNC_INTERVAL = int(os.environ.get("SYNC_INTERVAL", "1800"))
SYNC_RETRIES = 3
SYNC_BACKOFF = [5, 15, 30]

_hf_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
_hf_rid_cache: str | None = None
_hf_rid_cache_ts: float = 0
HF_API_TIMEOUT = 30

def sync_state_path(uname: str) -> Path:
    return user_dir(uname) / SYNC_STATE_FILE

def load_sync_state(uname: str) -> dict:
    p = sync_state_path(uname)
    if p.exists():
        return json.loads(p.read_text())
    return {}

def save_sync_state(uname: str, state: dict) -> None:
    p = sync_state_path(uname)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2))
    tmp.replace(p)

def file_hash(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()

def detect_changes(uname: str) -> tuple:
    current = {}
    state = load_sync_state(uname)
    u_dir = user_dir(uname)
    new_f, changed_f, deleted_f = [], [], []
    for key in USER_DATA_KEYS:
        p = u_dir / f"{key}.json"
        if p.exists():
            h = file_hash(p)
            current[key] = h
            if key not in state:
                new_f.append(key)
            elif state[key] != h:
                changed_f.append(key)
    for key in state:
        if key not in current:
            deleted_f.append(key)
    changes = {}
    if new_f: changes["new"] = new_f
    if changed_f: changes["changed"] = changed_f
    if deleted_f: changes["deleted"] = deleted_f
    return changes, current

async def _hf_call(func, *args, **kwargs) -> any:
    from huggingface_hub import HfApi
    kwargs.setdefault("token", SYNC_HF_TOKEN)
    last_err = None
    for attempt in range(SYNC_RETRIES):
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(func, *args, **kwargs),
                timeout=HF_API_TIMEOUT,
            )
        except Exception as e:
            last_err = e
            if attempt < SYNC_RETRIES - 1:
                backoff = SYNC_BACKOFF[attempt]
                log.warning("HF call failed (attempt %d/%d): %s — retrying in %ds", attempt + 1, SYNC_RETRIES, e, backoff)
                await asyncio.sleep(backoff)
    raise last_err  # type: ignore

async def get_hf_rid() -> str:
    global _hf_rid_cache, _hf_rid_cache_ts
    now = time.time()
    if _hf_rid_cache and now - _hf_rid_cache_ts < 300:
        return _hf_rid_cache
    from huggingface_hub import HfApi
    api = HfApi(token=SYNC_HF_TOKEN)
    me = await asyncio.to_thread(api.whoami)
    ds_name = SYNC_DATASET or f"{me['name']}/zone-study-os-data"
    _hf_rid_cache = ds_name
    _hf_rid_cache_ts = now
    return _hf_rid_cache

async def ensure_hf_dataset(api, rid: str) -> None:
    from huggingface_hub import HfApi
    try:
        await asyncio.to_thread(api.repo_info, repo_id=rid, repo_type="dataset")
    except Exception as e:
        if "404" in str(e) or "Not Found" in str(e):
            await asyncio.to_thread(api.create_repo, repo_id=rid, repo_type="dataset", private=True, token=SYNC_HF_TOKEN)
            log.info("created HF dataset: %s", rid)
        else:
            log.warning("HF dataset check failed (will retry): %s", e)
            raise

async def auto_sync_loop():
    while True:
        await asyncio.sleep(SYNC_INTERVAL)
        if not SYNC_HF_TOKEN:
            continue
        try:
            users = load_users()
        except Exception as e:
            log.warning("auto-sync: failed to load users: %s", e)
            continue
        for uname in users:
            try:
                async with _hf_locks[uname]:
                    changes, _ = detect_changes(uname)
                    if changes:
                        await sync_user_to_hf(uname, changes)
            except Exception as e:
                log.warning("auto-sync failed for %s: %s", uname, e)

async def sync_user_to_hf(uname: str, changes: dict | None = None):
    if changes is None:
        changes, _ = detect_changes(uname)
    if not changes:
        return
    from huggingface_hub import HfApi
    api = HfApi(token=SYNC_HF_TOKEN)
    rid = await get_hf_rid()
    await ensure_hf_dataset(api, rid)
    u_dir = user_dir(uname)
    for key in changes.get("new", []) + changes.get("changed", []):
        p = u_dir / f"{key}.json"
        if p.exists():
            await _hf_call(api.upload_file, path_or_fileobj=p.read_bytes(), path_in_repo=f"{uname}/{key}.json", repo_id=rid, repo_type="dataset")
    for key in changes.get("deleted", []):
        try:
            await _hf_call(api.delete_file, path_in_repo=f"{uname}/{key}.json", repo_id=rid, repo_type="dataset")
        except Exception as e:
            log.warning("failed to delete %s/%s from HF: %s", uname, key, e)
    cfg_p = u_dir / "config.json"
    if cfg_p.exists():
        cfg_hash = file_hash(cfg_p)
        state = load_sync_state(uname)
        if state.get("config") != cfg_hash:
            await _hf_call(api.upload_file, path_or_fileobj=cfg_p.read_bytes(), path_in_repo=f"{uname}/config.json", repo_id=rid, repo_type="dataset")
    save_sync_state(uname, {**load_sync_state(uname), **{k: file_hash(u_dir / f"{k}.json") for k in changes.get("new", []) + changes.get("changed", []) if (u_dir / f"{k}.json").exists()}})
    log.info("synced %s to HF: %s", uname, json.dumps(changes))

async def sync_user_from_hf(uname: str) -> dict:
    from huggingface_hub import HfApi, snapshot_download
    api = HfApi(token=SYNC_HF_TOKEN)
    rid = await get_hf_rid()
    tmp = Path(tempfile.mkdtemp(prefix="zone-restore-"))
    changes = {"created": [], "updated": [], "deleted": []}
    try:
        snapshot_download(
            repo_id=rid, repo_type="dataset",
            local_dir=str(tmp), token=SYNC_HF_TOKEN,
            allow_patterns=f"{uname}/*",
        )
        remote_dir = tmp / uname
        if not remote_dir.exists() or not any(remote_dir.iterdir()):
            log.info("no remote data found for %s — skipping restore", uname)
            shutil.rmtree(tmp, ignore_errors=True)
            return changes
        remote_files = list(remote_dir.iterdir())
        remote_keys = set()
        for rf in remote_files:
            stem = rf.stem
            remote_keys.add(stem)
            raw = rf.read_bytes()
            if stem != "config" and is_encrypted(uname):
                try:
                    plain = user_fernet(uname).decrypt(raw)
                    data = json.loads(plain)
                except Exception:
                    raise RuntimeError(
                        f"Could not decrypt remote '{stem}' for user '{uname}'. "
                        "This usually means ZONE_SECRET changed since this backup was created."
                    )
            else:
                data = json.loads(raw)
            if stem == "config":
                local_p = user_dir(uname) / "config.json"
                local_existed = local_p.exists()
                if not local_existed or local_p.read_bytes() != raw:
                    _write_json(local_p, data)
                    changes["created" if not local_existed else "updated"].append(stem)
            elif stem in USER_DATA_KEYS:
                local_p = user_dir(uname) / f"{stem}.json"
                local_exists = local_p.exists()
                write_user_data(uname, stem, data)
                changes["created" if not local_exists else "updated"].append(stem)
        shutil.rmtree(tmp, ignore_errors=True)
        log.info("restored %s from HF: %s", uname, json.dumps(changes))
        return changes
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise

@app.get("/api/sync/hf-upload")
async def sync_hf_upload(request: Request):
    if not SYNC_HF_TOKEN:
        raise HTTPException(400, "HF_TOKEN env var required")
    try:
        uname = getattr(request.state, "username", None)
        if not uname:
            raise HTTPException(400, "login required")
        async with _hf_locks[uname]:
            changes, _ = detect_changes(uname)
            if not changes:
                return {"status": "ok", "message": "no changes detected"}
            await sync_user_to_hf(uname, changes)
            return {"status": "ok", "changes": changes}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))

@app.get("/api/sync/hf-download")
async def sync_hf_download(request: Request):
    if not SYNC_HF_TOKEN:
        raise HTTPException(400, "HF_TOKEN env var required")
    try:
        uname = getattr(request.state, "username", None)
        if not uname:
            raise HTTPException(400, "login required")
        async with _hf_locks[uname]:
            changes = await sync_user_from_hf(uname)
            if any(changes.values()):
                return {"status": "ok", "changes": changes}
            return {"status": "ok", "message": "no changes on remote"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))

# ── Static files ──────────────────────────────────
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
