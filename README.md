---
title: Zone
emoji: 📚
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# Zone Study OS

A self-hosted, production-grade **Pomodoro‑style study console** with authentication, per‑user data isolation, cloud sync, and encryption at rest. Designed to run on **Hugging Face Spaces** (or any Linux server).

---

## Features

- **Timer‑based zone tracking** — Focus/break/buffer blocks with cycle names, manual DONE, and skip
- **Exam tracks** — Prebuilt schedules for JEE, NEET, UPSC, GATE, CA, Boards, Custom
- **Schedule editor** — Drag‑free editor with per‑zone color picker, cycle names, time limits
- **Calendar** — Built‑in calendar with Indian holidays, custom events
- **Statistics** — Per‑zone session counts, focus minutes, skip tracking
- **Wallpaper generator** — Client‑side poster builder (html2canvas)
- **Authentication** — Login/signup/guest with httpOnly cookies
- **User isolation** — Each user gets `data/users/{username}/` with encrypted files
- **Password hashing** — bcrypt with plaintext fallback migration
- **Encryption at rest** — Fernet (AES‑128‑CBC) per‑user key derived from `ZONE_SECRET` + HMAC‑SHA256
- **HF Spaces cloud sync** — Automatic 30‑min backup to a private Hugging Face dataset with change‑detection
- **Keep‑awake** — cron‑job.org integration prevents HF Spaces from spinning down
- **Admin features** — Reset‑key generation for forgot‑password flow
- **Guest mode** — All data stored in browser localStorage only, no server writes

---

## Quick Start

### 1. Clone & install

```bash
git clone https://github.com/your-username/zone-study-os.git
cd zone-study-os
pip install -r requirements.txt
```

### 2. Set environment variables (minimum)

```bash
export ZONE_PASSWORD=changeme
```

### 3. Run

```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port 7860
```

Open `http://localhost:7860` — sign up or log in.

---

## Environment Variables

### Authentication (at least one required)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ZONE_USERNAME` | No | `admin` | Admin username for login |
| `ZONE_PASSWORD` | No | — | Admin password. If unset, only signup works |

### Security

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ZONE_SECRET` | No | auto‑generated | 64‑char hex key for encrypting user data. If not set, a key is generated and saved to `data/secret.key`. **Warning**: if `data/` is not persistent, the key is lost on restart and all data becomes undecryptable |

### Storage

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ZONE_DATA_DIR` | No | `app/../data` | Directory for all user data. On HF Spaces, **must be `/data`** (the only persistent volume) |

### HF Sync (optional — cloud backup)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HF_TOKEN` | No | — | Hugging Face write token. Enables cloud backup |
| `SYNC_DATASET` | No | auto‑created | Dataset name (`username/dataset-name`). If unset, auto‑creates `{hf_username}/zone-study-os-data` |
| `SYNC_INTERVAL` | No | `1800` | Auto‑sync interval in seconds |

### Keep‑Awake (optional — prevents HF Spaces spin‑down)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CRON_TOKEN` | No | — | Secret token for authenticating `/keepalive` pings |
| `CRONJOB_API_KEY` | No | — | cron‑job.org API key. If set, auto‑creates a ping job on startup |
| `KEEPALIVE_ENABLED` | No | `true` | Set to `false` to disable |
| `KEEPALIVE_CRON` | No | `*/5 * * * *` | Cron expression for ping frequency |
| `KEEPALIVE_URL` | No | auto‑detected | Ping target URL. Auto‑built from `SPACE_HOST` (injected by HF Spaces) |

### HF Spaces (auto‑injected — do not set manually)

| Variable | Description |
|----------|-------------|
| `SPACE_ID` | Auto‑injected by Spaces runtime |
| `SPACE_HOST` | Used by keep‑alive to build the ping URL |
| `SPACE_AUTHOR_NAME` | Used to derive `SPACE_HOST` |
| `SPACE_REPO_NAME` | Used to derive `SPACE_HOST` |

---

## HF Spaces Deployment

### One‑click deploy

1. Fork this repo on GitHub
2. Go to [huggingface.co/spaces](https://huggingface.co/spaces) → **Create new Space**
3. Choose **Docker** as the Space SDK
4. Connect your GitHub repo
5. Add these **Secrets** (Space Settings → Repository Secrets):

| Secret | Value |
|--------|-------|
| `ZONE_PASSWORD` | A strong password |
| `ZONE_SECRET` | `openssl rand -hex 32` output |
| `ZONE_DATA_DIR` | `/data` |
| `HF_TOKEN` | *(optional)* Your HF write token for cloud backup |
| `CRONJOB_API_KEY` | *(optional)* For keep‑awake |

6. The Space builds and starts automatically

### Data persistence

HF Spaces only persists the `/data` directory across restarts. Set `ZONE_DATA_DIR=/data` in your Space secrets — the app will store all user data there.

### Keep‑awake (why)

HF Spaces spin down after 30–60 minutes of inactivity. Use the built‑in cron‑job.org integration to keep it alive:

1. Create an account at [cron‑job.org](https://cron-job.org)
2. Go to **Settings → API** and generate an API key
3. Add `CRONJOB_API_KEY` to your Space secrets
4. (Optional) Add `CRON_TOKEN` — a random string — to gate the `/keepalive` endpoint

On every container start, the app auto‑creates (or refreshes) a cron job that pings your Space every 5 minutes.

---

## API Endpoints

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/signup` | Create account (username, password) |
| POST | `/api/login` | Log in (sets httpOnly cookie) |
| GET | `/api/guest-login` | Guest session (no server data) |
| POST | `/api/logout` | Clear session |
| GET | `/api/auth-check` | Returns `{authed, guest, username, isAdmin}` |
| POST | `/api/change-password` | Change password (current_password, new_password) |
| POST | `/api/change-username` | Rename account (new_username) |
| POST | `/api/reset-password` | Admin or reset‑key password reset |
| POST | `/api/admin/generate-reset-key` | Generate one‑time reset key (admin only) |

### Config

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/config` | Get zone config |
| PUT | `/api/config` | Update zone config |
| GET | `/api/exam-tracks` | List available exam tracks |

### User Data

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/user-data` | Get all user data (stats, tracking, events, settings, session) |
| POST | `/api/user-data` | Save one data key `{key, value}` |

### Sync

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sync/export` | Download full backup JSON |
| POST | `/api/sync/import` | Upload backup JSON |
| GET | `/api/sync/hf-upload` | Push changes to HF dataset |
| GET | `/api/sync/hf-download` | Pull changes from HF dataset |

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | `{status, uptime, users, active_sessions}` |
| GET | `/keepalive` | Ping endpoint for keep‑awake (optional `?token=`) |

---

## Architecture

```
app/
├── main.py              # FastAPI app — auth, encryption, sync, all endpoints
├── static/
│   ├── index.html       # Main app shell
│   ├── login.html       # Login/signup/guest/forgot-password UI
│   ├── js/app.js        # Entire frontend (IIFE module, ~2500 lines)
│   └── css/main.css     # All styling
├── config/
│   └── zone-config.json # Default zone schedule + exam tracks
data/                     # User data (gitignored)
├── users.json            # bcrypt-hashed passwords
├── sessions.json         # Active token→username mappings
├── secret.key            # Auto-generated encryption master key
├── reset-keys.json       # Admin-generated one-time reset keys
└── users/
    └── {username}/
        ├── config.json   # Per-user zone config
        ├── stats.json    # Encrypted
        ├── tracking.json # Encrypted
        ├── events.json   # Encrypted
        ├── settings.json # Encrypted
        ├── session.json  # Encrypted
        ├── .encrypted    # Marker file
        └── sync-state.json # File hashes for HF change detection
```

### Data flow

1. **Login** → Server validates credentials, creates session token, sets httpOnly cookie
2. **Page load** → Frontend calls `/api/auth-check`, `/api/config`, `/api/exam-tracks` in parallel
3. **State** → Zone progress, stats, and settings stored in localStorage + synced to server every 5s
4. **Timer** → Runs client‑side (setInterval), syncs to server session for refresh survival
5. **Encryption** → All files in `data/users/{username}/` are encrypted with a per‑user Fernet key (HMAC‑SHA256 of ZONE_SECRET + username)
6. **HF Sync** → Background loop compares file hashes → uploads new/changed → deletes removed → updates sync-state.json

### Security

- **Passwords**: bcrypt‑hashed (with automatic migration from legacy plaintext)
- **Sessions**: httpOnly, SameSite=Lax, Secure cookies. Server‑side token→username mapping
- **Encryption**: Fernet (symmetric AES‑128‑CBC) with per‑user keys derived from master secret
- **Rate limiting**: In‑memory (10 attempts / 60s) on login, signup, and password reset
- **Headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`, `Referrer-Policy: strict-origin-when-cross-origin`

---

## Development

### Project structure

```bash
.
├── Dockerfile                    # Production container
├── entrypoint.sh                 # Container entrypoint
├── cronjob-keepalive-setup.py    # cron-job.org auto-setup
├── requirements.txt
├── .env.example                  # Documented env vars
├── .gitignore
├── .dockerignore
└── app/
    ├── main.py                   # FastAPI backend
    ├── static/
    │   ├── index.html
    │   ├── login.html
    │   ├── js/app.js
    │   └── css/main.css
    └── config/
        └── zone-config.json
```

### Running locally

```bash
export ZONE_PASSWORD=test
python -m uvicorn app.main:app --host 0.0.0.0 --port 7860 --reload
```

### Building the Docker image

```bash
docker build -t zone-study-os .
docker run -p 7860:7860 -e ZONE_PASSWORD=test zone-study-os
```

---

## Troubleshooting

### "Loading zone console…" stuck

The JS file failed to load or threw an error. Check the browser console (F12). Common causes:

- **Missing cookie** — You need to log in first. The app redirects `/` to `/login.html` if unauthenticated
- **Stale `skipZone` export** — If you pulled old code, there might be a `ReferenceError`. Clear cache and reload
- **Server not running** — Check `curl http://localhost:7860/health`

### Data not persisting across restarts (HF Spaces)

Set `ZONE_DATA_DIR=/data` in your Space secrets. HF Spaces only persist `/data`.

### "Could not decrypt" error during sync

Your `ZONE_SECRET` changed between backups. The old encrypted data cannot be decrypted with the new key. Keep your `ZONE_SECRET` stable.

### 422 on `/api/user-data`

The frontend sent a value with a type the server didn't expect. This is usually harmless (the error is caught silently). If persistent, check that `saveUserDataToServer()` passes valid JSON.

---

## License

MIT
