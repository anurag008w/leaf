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
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from cryptography.fernet import Fernet

app = FastAPI(title="Zone Study OS")

CONFIG_PATH = Path(__file__).parent / "config" / "zone-config.json"
STATIC_DIR = Path(__file__).parent / "static"
DATA_DIR = Path(__file__).parent.parent / "data"
ZONE_USERNAME = os.environ.get("ZONE_USERNAME", "").strip() or "admin"
ZONE_PASSWORD = os.environ.get("ZONE_PASSWORD", "").strip()
SYNC_HF_TOKEN = os.environ.get("HF_TOKEN", "").strip()
SYNC_DATASET = os.environ.get("SYNC_DATASET", "").strip()

_active_tokens = set()
_token_users = {}  # token -> username
COOKIE_NAME = "zone_session"
config_cache = {"data": None, "mtime": 0}
USERS_FILE = DATA_DIR / "users.json"
SESSIONS_FILE = DATA_DIR / "sessions.json"
GUEST_PREFIX = "guest_"
SECRET_KEY = os.environ.get("ZONE_SECRET", "").strip()

def load_sessions() -> None:
    """Restore active sessions from disk so a container restart doesn't log everyone out."""
    if not SESSIONS_FILE.exists():
        return
    try:
        saved = json.loads(SESSIONS_FILE.read_text())
        for token, uname in saved.get("token_users", {}).items():
            _active_tokens.add(token)
            _token_users[token] = uname
        for token in saved.get("guest_tokens", []):
            _active_tokens.add(token)
    except Exception:
        pass

def save_sessions() -> None:
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        guest_tokens = [t for t in _active_tokens if is_guest(t)]
        SESSIONS_FILE.write_text(json.dumps({
            "token_users": _token_users,
            "guest_tokens": guest_tokens,
        }, indent=2))
    except Exception:
        pass

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

def load_config():
    mtime = CONFIG_PATH.stat().st_mtime
    if config_cache["mtime"] != mtime:
        with open(CONFIG_PATH) as f:
            config_cache["data"] = json.load(f)
        config_cache["mtime"] = mtime
    return config_cache["data"]

def load_users() -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if USERS_FILE.exists():
        return json.loads(USERS_FILE.read_text())
    return {}

def save_users(users: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    USERS_FILE.write_text(json.dumps(users, indent=2))

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

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    exempt = ("/health", "/keepalive", "/login.html", "/api/login", "/api/guest-login", "/api/signup", "/api/reset-password")
    if path in exempt or any(path.startswith(p) for p in ("/api/login", "/api/guest-login", "/api/signup", "/api/reset-password")):
        return await call_next(request)
    token = request.cookies.get(COOKIE_NAME, "")
    if not token or token not in _active_tokens:
        if path.startswith("/api/"):
            return JSONResponse({"error": "unauthorized"}, 401)
        return FileResponse(str(STATIC_DIR / "login.html"))
    request.state.token = token
    request.state.username = resolve_username(token)
    return await call_next(request)

def make_session(username: str) -> str:
    token = secrets.token_hex(32)
    _active_tokens.add(token)
    _token_users[token] = username
    save_sessions()
    return token

def resp_with_token(token: str, data: dict):
    resp = JSONResponse(data)
    resp.set_cookie(COOKIE_NAME, token, max_age=86400 * 30, httponly=True, samesite="lax")
    return resp

def ensure_user_dir(uname: str):
    u_dir = user_dir(uname)
    u_dir.mkdir(parents=True, exist_ok=True)
    cfg_file = u_dir / "config.json"
    if not cfg_file.exists():
        _write_json(cfg_file, load_config())

@app.post("/api/signup")
async def signup(body: SignupBody):
    uname = body.username.strip()
    if not uname or len(uname) < 2:
        raise HTTPException(400, "username too short")
    if not body.password or len(body.password) < 3:
        raise HTTPException(400, "password too short")
    users = load_users()
    if uname in users:
        raise HTTPException(409, "username taken")
    users[uname] = body.password
    save_users(users)
    ensure_user_dir(uname)
    mark_encrypted(uname)
    # migrate existing plaintext data to encrypted
    u_dir = user_dir(uname)
    for k in USER_DATA_KEYS:
        p = u_dir / f"{k}.json"
        if p.exists() and not (u_dir / ".encrypted").exists():
            try:
                data = _read_json(p)
                encrypt_write(p, data, uname)
            except Exception:
                pass
    token = make_session(uname)
    return resp_with_token(token, {"token": token, "username": uname})

@app.post("/api/login")
async def login(body: LoginBody):
    uname = body.username.strip()
    # check env admin
    if ZONE_PASSWORD and uname == ZONE_USERNAME and body.password == ZONE_PASSWORD:
        ensure_user_dir(uname)
        token = make_session(uname)
        migrate_to_encrypted(uname)
        return resp_with_token(token, {"token": token, "username": uname})
    # check registered users (works even without ZONE_PASSWORD)
    users = load_users()
    if uname in users and users[uname] == body.password:
        ensure_user_dir(uname)
        token = make_session(uname)
        migrate_to_encrypted(uname)
        return resp_with_token(token, {"token": token, "username": uname})
    raise HTTPException(401, "invalid credentials")

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

@app.get("/api/guest-login")
async def guest_login():
    token = GUEST_PREFIX + secrets.token_hex(16)
    _active_tokens.add(token)
    save_sessions()
    resp = JSONResponse({"token": token, "guest": True})
    resp.set_cookie(COOKIE_NAME, token, max_age=86400 * 30, httponly=True, samesite="lax")
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
    users[uname] = body.new_password
    save_users(users)
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

@app.on_event("startup")
async def startup():
    load_config()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    load_sessions()
    if not os.environ.get("ZONE_SECRET", "").strip():
        get_secret()  # materialize/load secret.key now so the warning below is accurate
        print(
            "WARNING: ZONE_SECRET is not set. A key was generated and saved to "
            f"{DATA_DIR / 'secret.key'}. If that path isn't on persistent storage, "
            "it will be regenerated on next restart and ALL previously encrypted "
            "user data will become permanently undecryptable. Set ZONE_SECRET to "
            "a fixed value to avoid this."
        )
    asyncio.create_task(auto_sync_loop())

# ─── Sync state tracking ─────────────────────────
SYNC_STATE_FILE = "sync-state.json"

def sync_state_path(uname: str) -> Path:
    return user_dir(uname) / SYNC_STATE_FILE

def load_sync_state(uname: str) -> dict:
    p = sync_state_path(uname)
    if p.exists():
        return json.loads(p.read_text())
    return {}

def save_sync_state(uname: str, state: dict) -> None:
    sync_state_path(uname).write_text(json.dumps(state, indent=2))

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

def get_hf_rid() -> str:
    from huggingface_hub import HfApi
    api = HfApi(token=SYNC_HF_TOKEN)
    return f"{api.whoami()['name']}/{SYNC_DATASET}"

def ensure_hf_dataset(api, rid: str) -> None:
    try:
        api.repo_info(repo_id=rid, repo_type="dataset")
    except:
        api.create_repo(repo_id=rid, repo_type="dataset", private=True)

async def auto_sync_loop():
    while True:
        await asyncio.sleep(1800)
        try:
            if SYNC_HF_TOKEN and SYNC_DATASET:
                users = load_users()
                for uname in users:
                    try:
                        await sync_user_to_hf(uname)
                    except Exception:
                        pass
        except Exception:
            pass

async def sync_user_to_hf(uname: str):
    from huggingface_hub import HfApi
    changes, current = detect_changes(uname)
    if not changes:
        return
    api = HfApi(token=SYNC_HF_TOKEN)
    rid = get_hf_rid()
    ensure_hf_dataset(api, rid)
    u_dir = user_dir(uname)
    for key in changes.get("new", []) + changes.get("changed", []):
        p = u_dir / f"{key}.json"
        if p.exists():
            api.upload_file(
                path_or_fileobj=p.read_bytes(),
                path_in_repo=f"{uname}/{key}.json",
                repo_id=rid, repo_type="dataset",
                token=SYNC_HF_TOKEN
            )
    for key in changes.get("deleted", []):
        try:
            api.delete_file(
                path_in_repo=f"{uname}/{key}.json",
                repo_id=rid, repo_type="dataset",
                token=SYNC_HF_TOKEN
            )
        except Exception:
            pass
    # also upload config if changed
    cfg_p = u_dir / "config.json"
    if cfg_p.exists():
        cfg_hash = file_hash(cfg_p)
        state = load_sync_state(uname)
        if state.get("config") != cfg_hash:
            api.upload_file(
                path_or_fileobj=cfg_p.read_bytes(),
                path_in_repo=f"{uname}/config.json",
                repo_id=rid, repo_type="dataset",
                token=SYNC_HF_TOKEN
            )
            current["config"] = cfg_hash
    save_sync_state(uname, current)

async def sync_user_from_hf(uname: str) -> dict:
    from huggingface_hub import HfApi, snapshot_download
    api = HfApi(token=SYNC_HF_TOKEN)
    rid = get_hf_rid()
    tmp = Path(tempfile.mkdtemp(prefix="zone-restore-"))
    try:
        snapshot_download(repo_id=rid, repo_type="dataset",
                          local_dir=str(tmp), token=SYNC_HF_TOKEN,
                          allow_patterns=f"{uname}/*")
        remote_files = list((tmp / uname).iterdir()) if (tmp / uname).exists() else []
        changes = {"created": [], "updated": [], "deleted": []}
        remote_keys = set()
        for rf in remote_files:
            stem = rf.stem
            remote_keys.add(stem)
            raw = rf.read_bytes()
            # config is never encrypted on upload — only USER_DATA_KEYS files are
            if stem != "config" and is_encrypted(uname):
                try:
                    plain = user_fernet(uname).decrypt(raw)
                    data = json.loads(plain)
                except Exception:
                    raise RuntimeError(
                        f"Could not decrypt remote '{stem}' for user '{uname}'. "
                        "This usually means ZONE_SECRET changed (or was never set "
                        "and got regenerated on a restart) since this backup was "
                        "created. The data is not recoverable with the current key."
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
        for key in USER_DATA_KEYS:
            p = user_dir(uname) / f"{key}.json"
            if p.exists() and key not in remote_keys:
                p.unlink(missing_ok=True)
                changes["deleted"].append(key)
        shutil.rmtree(tmp, ignore_errors=True)
        return changes
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise

@app.get("/health")
async def health():
    return {"status": "healthy", "timestamp": time.time()}

@app.get("/keepalive")
async def keepalive():
    return {"status": "alive", "timestamp": time.time()}

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

@app.get("/api/exam-tracks")
async def get_exam_tracks():
    return {
        "tracks": [
            {"id": "JEE", "name": "JEE Main & Advanced", "zones": [
                {"id": 1, "title": "Morning Core", "subtitle": "Physics & Chemistry"},
                {"id": 2, "title": "Math Practice", "subtitle": "Problem solving"},
                {"id": 3, "title": "Revision", "subtitle": "Review & consolidate"},
                {"id": 4, "title": "Mock Test", "subtitle": "Simulated exam"},
                {"id": 5, "title": "Recovery Buffer", "subtitle": "Catch up"}
            ]},
            {"id": "NEET", "name": "NEET UG", "zones": [
                {"id": 1, "title": "Biology Core", "subtitle": "NCERT & concepts"},
                {"id": 2, "title": "Chemistry", "subtitle": "Physical & Organic"},
                {"id": 3, "title": "Physics", "subtitle": "Problem solving"},
                {"id": 4, "title": "Practice Test", "subtitle": "Mock questions"},
                {"id": 5, "title": "Recovery Buffer", "subtitle": "Catch up"}
            ]},
            {"id": "UPSC", "name": "UPSC Civil Services", "zones": [
                {"id": 1, "title": "Current Affairs", "subtitle": "Newspaper & magazines"},
                {"id": 2, "title": "Optional Subject", "subtitle": "Deep dive"},
                {"id": 3, "title": "GS Paper", "subtitle": "General studies"},
                {"id": 4, "title": "Answer Writing", "subtitle": "Practice"},
                {"id": 5, "title": "Recovery Buffer", "subtitle": "Catch up"}
            ]},
            {"id": "GATE", "name": "GATE", "zones": [
                {"id": 1, "title": "Core Subjects", "subtitle": "Technical depth"},
                {"id": 2, "title": "Aptitude", "subtitle": "Quant & reasoning"},
                {"id": 3, "title": "Previous Year", "subtitle": "PYQ practice"},
                {"id": 4, "title": "Mock Test", "subtitle": "Full length"},
                {"id": 5, "title": "Recovery Buffer", "subtitle": "Catch up"}
            ]},
            {"id": "CA", "name": "CA Foundation/Inter/Final", "zones": [
                {"id": 1, "title": "Accounts", "subtitle": "Financial accounting"},
                {"id": 2, "title": "Law", "subtitle": "Business laws"},
                {"id": 3, "title": "Taxation", "subtitle": "Direct & Indirect"},
                {"id": 4, "title": "Practice", "subtitle": "Problem solving"},
                {"id": 5, "title": "Recovery Buffer", "subtitle": "Catch up"}
            ]},
            {"id": "BOARDS", "name": "Board Exams", "zones": [
                {"id": 1, "title": "Subject 1", "subtitle": "Core topics"},
                {"id": 2, "title": "Subject 2", "subtitle": "Core topics"},
                {"id": 3, "title": "Subject 3", "subtitle": "Core topics"},
                {"id": 4, "title": "Revision", "subtitle": "Mixed practice"},
                {"id": 5, "title": "Recovery Buffer", "subtitle": "Catch up"}
            ]},
            {"id": "CUSTOM", "name": "Custom Track", "zones": [
                {"id": 1, "title": "Zone 1", "subtitle": "Morning session"},
                {"id": 2, "title": "Zone 2", "subtitle": "Deep work"},
                {"id": 3, "title": "Zone 3", "subtitle": "Afternoon session"},
                {"id": 4, "title": "Zone 4", "subtitle": "Practice"},
                {"id": 5, "title": "Zone 5", "subtitle": "Recovery buffer"}
            ]}
        ]
    }

@app.post("/api/wallpaper")
async def generate_wallpaper(data: dict):
    import base64 as b64mod
    from io import BytesIO
    from app.wallpaper import render_wallpaper
    config = load_config()
    img = render_wallpaper(config, data.get("type", "desktop"))
    buf = BytesIO()
    img.save(buf, format="PNG")
    b64 = b64mod.b64encode(buf.getvalue()).decode()
    return {"image": f"data:image/png;base64,{b64}"}

@app.get("/api/sync/export")
async def sync_export(request: Request):
    uname = getattr(request.state, "username", None)
    backup = {
        "config": load_config(),
        "exported_at": time.time()
    }
    if uname:
        backup["data"] = read_user_data(uname)
        cfg_file = user_dir(uname) / "config.json"
        if cfg_file.exists():
            backup["config"] = _read_json(cfg_file)
    return JSONResponse(content=backup, headers={
        "Content-Disposition": f"attachment; filename=zone-backup-{int(time.time())}.json"
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

@app.get("/api/sync/hf-upload")
async def sync_hf_upload(request: Request):
    if not SYNC_HF_TOKEN or not SYNC_DATASET:
        raise HTTPException(400, "HF_TOKEN and SYNC_DATASET env vars required")
    try:
        uname = getattr(request.state, "username", None)
        if not uname:
            raise HTTPException(400, "login required")
        changes, _ = detect_changes(uname)
        if not changes:
            return {"status": "ok", "message": "no changes detected"}
        await sync_user_to_hf(uname)
        return {"status": "ok", "changes": changes}
    except Exception as e:
        raise HTTPException(500, str(e))

@app.get("/api/sync/hf-download")
async def sync_hf_download(request: Request):
    if not SYNC_HF_TOKEN or not SYNC_DATASET:
        raise HTTPException(400, "HF_TOKEN and SYNC_DATASET env vars required")
    try:
        uname = getattr(request.state, "username", None)
        if not uname:
            raise HTTPException(400, "login required")
        changes = await sync_user_from_hf(uname)
        if changes:
            return {"status": "ok", "changes": changes}
        return {"status": "ok", "message": "no changes on remote"}
    except Exception as e:
        raise HTTPException(500, str(e))

app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
