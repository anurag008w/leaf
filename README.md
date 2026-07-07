---
title: Zone
emoji: 📚
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-34D399?style=flat-square&labelColor=0A0D13" alt="Version"/>
  <img src="https://img.shields.io/badge/python-3.12+-38BDF8?style=flat-square&labelColor=0A0D13" alt="Python"/>
  <img src="https://img.shields.io/badge/FastAPI-0.115-34D399?style=flat-square&labelColor=0A0D13" alt="FastAPI"/>
  <img src="https://img.shields.io/badge/license-MIT-FBBF24?style=flat-square&labelColor=0A0D13" alt="License"/>
  <img src="https://img.shields.io/badge/HF%20Spaces-ready-38BDF8?style=flat-square&labelColor=0A0D13" alt="HF Spaces"/>
</p>

<p align="center">
  <strong>⚡ ZONE · Study Execution System</strong><br>
  <em>A self-hosted, production-grade Pomodoro-style study console with 6 themes, real-time analytics, exam countdowns, and cloud backup.</em>
</p>

---

## 🎯 Overview

**Zone** is a full-stack study productivity platform designed for serious exam preparation. It combines a **Pomodoro timer engine**, **multi-zone scheduling**, **session analytics**, **calendar management**, **exam countdowns**, and **wallpaper generation** into a single, beautiful interface — all running on your own server.

Built with **FastAPI** + **Vanilla JS** + **CSS custom properties**, it features **6 unique themes** with real-time particle effects, **Chart.js analytics**, **Hugging Face Spaces cloud sync**, and fully isolated **bcrypt-authenticated** user data.

---

## ✨ Features

### 🕐 Timer Engine
- ⏱ **Focus/Break/Buffer zones** — Customize durations, cycles, and time limits per zone
- 🔄 **Manual DONE + Skip** — Mark zones complete without timer, or skip blocks mid-session
- 📊 **Cycle tracking** — Named cycles with visual progress bars and block timeline
- 🎯 **Day completion system** — All zones must be completed for day to count as done
- 📈 **Activity log** — Full event timeline with start/pause/skip/complete/stop events

### 🎨 6 Themes
| Theme | Vibe | Accents |
|---|---|---|
| `💚 Hacker` | Matrix green terminal | `#34D399` · `#38BDF8` |
| `💜 Cyberpunk` | Neon purple/cyan | `#A78BFA` · `#22D3EE` |
| `💙 Midnight` | Glassmorphism deep blue | `#60A5FA` · `#818CF8` |
| `🧡 Amber` | Warm amber glow | `#FBBF24` · `#FB923C` |
| `💼 Corporate` | Clean business blue | `#58A6FF` · `#1F6FEB` |
| `✨ Platinum` | Premium gold/silver | `#D4AF37` · `#E8E8EE` |

Each theme has unique **ambient particle effects**:
- Hacker → ☔ Matrix rain (falling katakana columns)
- Cyberpunk → 🧬 Neon particle network with connecting lines
- Midnight → ⭐ Twinkling starfield with soft halos
- Amber → 🔥 Floating ember particles rising like fireflies
- Corporate, Platinum → Clean, minimal (no particles)

### 📈 Analytics Dashboard
- 📊 **14-day focus trend** line chart
- 🍩 **Zone distribution** doughnut chart
- 🎯 **Completion vs skips** comparison chart
- 🔥 **Weekly heatmap** grid with daily intensity
- 📋 **Daily progress table** grouped by month
- 📝 **Live activity log** for the current day
- 📐 **Zone breakdown** — per-zone session/skip/pause counts

### 📅 Calendar
- 🗓 **Monthly grid** with event dots and count badges
- 🟢 **Today highlight** with gradient glow
- ➕ **Add / Edit / Delete** custom events
- 🇮🇳 **Indian holidays & festivals** (optional toggle)
- 📤 **Export / Import** events as JSON
- 🔍 **Day detail modal** with all events listed

### ⏳ Exam Countdown
- 🎯 **Per-track exam dates** (JEE, NEET, UPSC, GATE, CA, BOARDS, CUSTOM)
- 🔵 **SVG ring countdown** with stopwatch-style display
- 🔄 **Live tick every second** — no full re-render
- ✏️ **Edit dates** via inline modal
- 📊 **Year progress** ring

### 🏞 Wallpaper Studio
- 📱 **Mobile + Desktop** canvas preview
- 🎨 **10 visual style presets** (Mission Control, Motivational, Neon Cyberpunk, Retro Terminal, etc.)
- 📸 **Download as PNG** via html2canvas

### 🔐 Security
- **bcrypt** password hashing with automatic legacy migration
- **httpOnly, SameSite=Lax, Secure** session cookies
- **Per-user data isolation** — each user has separate directory
- **Rate limiting** — 10 attempts / 60s on auth endpoints
- **Security headers** — `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`

### ☁ Cloud Sync (HF Spaces)
- **Automatic backup** to private Hugging Face dataset
- **Change detection** via SHA-256 fingerprinting
- **Configurable interval** (default: 30 min)
- **Prune stale files** from remote automatically
- **One-click restore** on fresh container start

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Browser (Client-Side)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  Timer   │  │  Charts  │  │ Calendar │  │ Canvas   │  │
│  │  Engine  │  │(Chart.js)│  │  Events  │  │ Effects  │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
│         │             │             │             │        │
│    ┌─────────────────────────────────────────────────┐    │
│    │          localStorage + 5s sync to server        │    │
│    └─────────────────────────────────────────────────┘    │
│                          │                                 │
├──────────────────────────┼─────────────────────────────────┤
│  ════════════════════════╪══════════════════════ HTTP ═══  │
│                          ▼                                 │
│                   FastAPI Server (Python)                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  Auth    │  │   User   │  │  Config  │  │   Sync   │  │
│  │(bcrypt)  │  │   Data   │  │  Endpts  │  │   Hub    │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
│       │             │             │             │        │
├───────┼─────────────┼─────────────┼─────────────┼─────────┤
│       ▼             ▼             ▼             ▼         │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐    │
│  │sessions  │  │  users/  │  │  Hugging Face Dataset│    │
│  │.json     │  │{uname}/  │  │  (private, remote)   │    │
│  └──────────┘  └──────────┘  └──────────────────────┘    │
│                    data/                                   │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow
```
Login → Server validates → httpOnly cookie set
  ↓
Page load → Parallel: /api/auth-check + /api/config + /api/exam-tracks
  ↓
Frontend initializes → localStorage state → 5s auto-sync to server
  ↓
Timer runs client-side (setInterval) → session persisted to server
  ↓
HF Sync background loop (30min) → fingerprint → upload changed files → prune stale
```

---

## 🚀 Quick Start

### Local Development

```bash
# Clone
git clone https://github.com/your-username/zone-study-os.git
cd zone-study-os

# Install dependencies
pip install -r requirements.txt

# Set admin password
export ZONE_PASSWORD=your_secure_password

# Run with hot-reload
python -m uvicorn app.main:app --host 0.0.0.0 --port 7860 --reload
```

Open **[http://localhost:7860](http://localhost:7860)** — sign up or log in as `admin`.

### Using the helper script

```bash
chmod +x start.sh
./start.sh
```

---

## 🐳 Docker Deployment

### Build & Run

```bash
docker build -t zone-study-os .
docker run -d \
  -p 7860:7860 \
  -e ZONE_PASSWORD=your_secure_password \
  -v zone-data:/app/data \
  zone-study-os
```

### Docker Compose

```yaml
version: '3.8'
services:
  zone:
    build: .
    ports:
      - "7860:7860"
    environment:
      - ZONE_PASSWORD=your_secure_password
    volumes:
      - zone-data:/app/data
volumes:
  zone-data:
```

---

## ☁ Hugging Face Spaces Deployment

### One-Click Deploy

1. **Fork** this repo on GitHub
2. Go to **[hf.co/spaces](https://huggingface.co/spaces)** → **Create new Space**
3. Select **Docker** SDK → Connect your GitHub repo
4. Add these **Space Secrets** (Settings → Repository Secrets):

| Secret | Value |
|---|---|
| `ZONE_PASSWORD` | Strong admin password |
| `ZONE_DATA_DIR` | `/data` |
| `HF_TOKEN` | *(optional)* HF write token for cloud backup |

5. The Space builds and starts automatically

### Keep-Alive (prevent spin-down)

HF Spaces spin down after 30–60 min of inactivity. The built-in `cronjob-keepalive-setup.py` auto-creates a cron-job.org ping:

1. Create account at **[cron-job.org](https://cron-job.org)**
2. **Settings → API** → Generate API key
3. Add to Space secrets:

| Secret | Purpose |
|---|---|
| `CRONJOB_API_KEY` | Required for auto-setup |
| `CRON_TOKEN` | *(optional)* Secret for `/keepalive` endpoint |
| `KEEPALIVE_ENABLED` | `true` (default) |

The app auto-creates/refreshes a cron job on every container start.

---

## 🧩 API Reference

### Authentication

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `POST` | `/api/signup` | Create account `{username, password}` | ❌ |
| `POST` | `/api/login` | Log in `{username, password}` | ❌ |
| `POST` | `/api/guest-login` | Guest session (browser-local data only) | ❌ |
| `POST` | `/api/logout` | Clear session | ✅ |
| `GET` | `/api/auth-check` | Session info `{authed, guest, username, isAdmin}` | ✅ |
| `POST` | `/api/change-password` | Change password `{current_password, new_password}` | ✅ |
| `POST` | `/api/change-username` | Rename `{new_username}` (cannot rename admin) | ✅ |
| `POST` | `/api/reset-password` | Admin/reset-key password reset `{username, admin_password, new_password}` | ❌ |
| `POST` | `/api/admin/generate-reset-key` | Generate one-time reset key | ✅ Admin |

### Config

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/config` | Get default config (or per-user if logged in) | ✅ |
| `PUT` | `/api/config` | Update config (JSON body) | ✅ |
| `GET` | `/api/exam-tracks` | List all exam track presets | ✅ |

### User Data

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/user-data` | Get all user data (stats, tracking, events, settings, session) | ✅ |
| `POST` | `/api/user-data` | Save one data key `{key, value}` (valid keys: `stats`, `tracking`, `events`, `settings`, `session`) | ✅ |

### Backup & Sync

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/sync/export` | Download full backup as JSON | ✅ |
| `POST` | `/api/sync/import` | Upload & restore backup JSON | ✅ |
| `POST` | `/api/sync/trigger` | Force immediate HF sync | ✅ |
| `GET` | `/api/sync/status` | Sync status `{enabled, interval, last_fp}` | ❌ |

### Health

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/health` | Server health `{status, uptime, users, active_sessions}` | ❌ |
| `GET` | `/keepalive` | Ping endpoint (optional `?token=`) | ❌ |

---

## 🔧 Environment Variables

### Required

| Variable | Default | Description |
|---|---|---|
| `ZONE_PASSWORD` | — | Admin password. Must be set (or signup used) |

### Optional

| Variable | Default | Description |
|---|---|---|
| `ZONE_USERNAME` | `admin` | Admin login username |
| `ZONE_DATA_DIR` | `./data` | Directory for all persistent data |
| `ZONE_SECRET` | auto-generated | Encryption master key (64-char hex). **Keep stable in production** |
| `HF_TOKEN` | — | Hugging Face write token (enables cloud backup) |
| `HF_USERNAME` | auto-detected | HF username for dataset namespace |
| `SYNC_DATASET` | `myos-backup` | Dataset name for HF sync |
| `SYNC_INTERVAL` | `1800` | Auto-sync interval (seconds) |
| `SYNC_RESTORE` | `true` | Auto-restore from HF on fresh start |
| `HUB_ENABLED` | `true` | Enable hub dashboard endpoint |
| `CRONJOB_API_KEY` | — | cron-job.org API key for keepalive |
| `CRON_TOKEN` | — | Secret token for `/keepalive` auth |
| `KEEPALIVE_ENABLED` | `false` | Enable keep-awake cron setup |
| `KEEPALIVE_CRON` | `*/10 * * * *` | Ping frequency cron expression |
| `KEEPALIVE_URL` | auto-detected | Custom ping target URL |

---

## 📁 Project Structure

```
.
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI — 19 endpoints, auth, sync, config
│   ├── sync.py              # HF dataset sync — fingerprint, upload, prune, restore
│   ├── config/
│   │   └── zone-config.json # Default zone schedule & exam track definitions
│   └── static/
│       ├── index.html       # SPA shell (login page auto-served when unauthed)
│       ├── login.html       # Login / signup / guest / forgot UI
│       ├── css/
│       │   └── main.css     # 1470+ lines — 6 themes, responsive, animations
│       ├── js/
│       │   └── app.js       # 3030+ lines — IIFE module, all frontend logic
│       └── assets/
├── data/                    # Persistent data (gitignored)
│   ├── users.json           # bcrypt hashed passwords
│   ├── sessions.json        # Active token → username mappings
│   ├── reset-keys.json      # Admin-generated one-time reset keys
│   └── users/{username}/    # Per-user config + stats + tracking + events
├── Dockerfile               # Production container (python:3.12-slim)
├── entrypoint.sh            # Container entrypoint with keepalive setup
├── cronjob-keepalive-setup.py  # cron-job.org auto-configurator (358 lines)
├── requirements.txt         # fastapi, uvicorn, bcrypt, huggingface-hub, python-dotenv
├── .env.example             # Documented environment variables
├── start.sh                 # Local dev startup script
└── .github/workflows/
    └── deploy-to-hf-space.yml  # CI/CD to Hugging Face Spaces
```

---

## 📊 Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Python 3.12+, FastAPI 0.115, Uvicorn |
| **Auth** | bcrypt, httpOnly cookies, rate limiting |
| **Frontend** | Vanilla JS (IIFE module, ~3k lines) |
| **Charts** | Chart.js 4.4.7 |
| **Canvas Rendering** | html2canvas 1.4.1 |
| **Styling** | CSS Custom Properties, 6 themes |
| **Fonts** | Space Grotesk + JetBrains Mono |
| **Sync** | huggingface_hub (Hugging Face Datasets) |
| **Deploy** | Docker, HF Spaces |
| **Keepalive** | cron-job.org REST API |

---

## 🧠 Theme System

Each theme is defined by overriding CSS custom properties on `[data-theme="…"]`:

```
:root / [data-theme="hacker"]
  ├── Color palette (bg-base, bg-1/2/3, text-primary/secondary/muted)
  ├── Accent colors (solve, lecture, buffer, break, danger)
  ├── Border radii (r-lg, r-md, r-sm, r-card, r-panel, r-btn, r-badge)
  ├── Shadows (shadow-1, shadow-glow)
  ├── Typography (font, mono)
  └── Theme-specific overrides (panel styles, button styles, ambient effects)
```

Ambient effects are rendered on a **fixed canvas** (z-index: 0) with **requestAnimationFrame** — zero layout impact, pointer-events: none.

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/amazing`)
3. Commit changes (`git commit -m 'feat: add amazing feature'`)
4. Push to branch (`git push origin feat/amazing`)
5. Open a Pull Request

### Development Guidelines

- **JS**: All code in `app/static/js/app.js` (IIFE pattern, strict mode)
- **CSS**: All styles in `app/static/css/main.css` (custom properties for theming)
- **API**: New endpoints go in `app/main.py` with Pydantic models
- **Sync**: Changes to sync logic go in `app/sync.py`

---

## 🐛 Troubleshooting

### "Loading zone console…" stuck
→ Open browser console (F12). Likely: unauthenticated, stale JS cache, or server not running.

### Data not persisting on HF Spaces
→ Ensure `ZONE_DATA_DIR=/data` in Space secrets. Only `/data` is persistent.

### Changes lost after refresh
→ Timer state is saved to server every 5s. Guest mode uses localStorage only — data is lost if browser cache is cleared.

### Sync not working
→ Verify `HF_TOKEN` is set and has write permissions. Check server logs for `zone.sync` messages.

---

## 📄 License

**MIT** — Use freely, modify freely, share freely.

---

<p align="center">
  <strong>Built with ⚡ for focused study sessions</strong><br>
  <em>Zone · Study Execution System · v1.0.0</em>
</p>
