#!/usr/bin/env python3
"""
Zone OS — Desktop Floating Timer (CustomTkinter) v3
═══════════════════════════════════════════════════════
Full hacker-style redesign with 3 overlay modes:
  FULL    — timer + controls + zone + progress + opacity
  COMPACT — timer + play/pause + progress bar
  GHOST   — just digits, 25% transparent, study-friendly

Connects to Zone OS server via API.

First run: auto-installs customtkinter if missing.
"""

# ── Auto-install dependencies (first-run bootstrap) ──
import subprocess, sys
def _ensure_deps():
    try:
        import customtkinter  # noqa: F401
    except ImportError:
        print("[Zone Timer] Installing customtkinter (one-time)...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", "customtkinter"])
        print("[Zone Timer] Done!")
_ensure_deps()

import json
import os
import threading
import time as _time
import urllib.request
import urllib.error
import http.cookiejar
import ssl
from pathlib import Path

import customtkinter as ctk
import tkinter as tk

# ══════════════════════════════════════════════════════════════
# THEME — hacker terminal aesthetic
# ══════════════════════════════════════════════════════════════
ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")

# ── Colors ──
BG          = "#0A0D13"
BG1         = "#0E1219"
BG2         = "#141A24"
BG3         = "#1A2230"
LINE        = "#222D3C"
LINE_BRIGHT = "#2A3A50"
TEXT        = "#E8ECF2"
TEXT_SEC    = "#94A0B0"
MUTED       = "#5C6878"
CYAN        = "#38BDF8"
CYAN_DIM    = "#1A3A50"
GREEN       = "#34D399"
RED         = "#F26B6B"
AMBER       = "#FBBF24"
PINK        = "#FB7185"

# ── Fonts ──
F  = "Segoe UI"
FM = "JetBrains Mono"

# ── Radii ──
R_CARD  = 12
R_PANEL = 16
R_BTN   = 8
R_SM    = 6


# ══════════════════════════════════════════════════════════════
# CREDENTIALS
# ══════════════════════════════════════════════════════════════
CONFIG_FILE = Path.home() / ".zone-timer-config.json"

def load_saved_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text())
        except Exception:
            pass
    return {}

def save_config(url: str, username: str, password: str):
    try:
        existing = load_saved_config()
        existing.update({"url": url, "username": username, "password": password})
        CONFIG_FILE.write_text(json.dumps(existing, indent=2))
    except Exception:
        pass

def save_overlay_settings(delay_s: float, hide_pct: float, speed: float):
    """Persist overlay fade settings so they survive restart."""
    try:
        existing = load_saved_config()
        existing["overlay"] = {"delay_s": delay_s, "hide_pct": hide_pct, "speed": speed}
        CONFIG_FILE.write_text(json.dumps(existing, indent=2))
    except Exception:
        pass

def load_overlay_settings() -> dict:
    """Load saved overlay settings, or defaults if none saved."""
    cfg = load_saved_config().get("overlay", {})
    return {
        "delay_s": cfg.get("delay_s", 3.0),
        "hide_pct": cfg.get("hide_pct", 85),
        "speed": cfg.get("speed", 0.5),
    }


# ══════════════════════════════════════════════════════════════
# API CLIENT
# ══════════════════════════════════════════════════════════════
class ZoneAPI:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.cookie_jar = http.cookiejar.CookieJar()
        self._ssl_ctx = ssl.create_default_context()
        self.username = ""
        https_handler = urllib.request.HTTPSHandler(context=self._ssl_ctx)
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookie_jar),
            https_handler,
        )

    def _request(self, method, path, data=None):
        url = self.base_url + path
        body = json.dumps(data).encode() if data is not None else None
        req = urllib.request.Request(
            url, data=body, method=method,
            headers={"Content-Type": "application/json"} if body else {},
        )
        try:
            resp = self._opener.open(req, timeout=10)
            return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 401:
                return {"error": "unauthorized"}
            try:
                return json.loads(e.read().decode())
            except Exception:
                return None
        except Exception:
            return None

    def login(self, username, password):
        return self._request("POST", "/api/login", {"username": username, "password": password})

    def get_timer_state(self):
        return self._request("GET", "/api/timer/state")

    def control(self, action):
        return self._request("POST", "/api/timer/control", {"action": action})


# ══════════════════════════════════════════════════════════════
# FADE SETTINGS
# ══════════════════════════════════════════════════════════════
_saved_ov_init = load_overlay_settings()
fade_settings = {
    "full_alpha": 0.92,
    "idle_alpha": round(1.0 - _saved_ov_init["hide_pct"] / 100.0, 2),
    "delay_ms": int(_saved_ov_init["delay_s"] * 1000),
    "fade_speed": 0.02 if _saved_ov_init["speed"] < 0.33 else (0.08 if _saved_ov_init["speed"] >= 0.66 else 0.04),
}


# ══════════════════════════════════════════════════════════════
# COLLAPSIBLE SECTION
# ══════════════════════════════════════════════════════════════
class CollapsibleSection:
    def __init__(self, parent, title, start_collapsed=True):
        self._collapsed = start_collapsed
        self._children = []
        self.frame = ctk.CTkFrame(parent, fg_color=BG1, corner_radius=R_CARD,
                                   border_width=1, border_color=LINE)
        self.header = ctk.CTkFrame(self.frame, fg_color="transparent", cursor="hand2")
        self.header.pack(fill="x", padx=10, pady=(8, 2))
        self.lbl_arrow = ctk.CTkLabel(self.header, text="▸", font=(F, 10),
                                       text_color=MUTED, width=14)
        self.lbl_arrow.pack(side="left")
        self.lbl_title = ctk.CTkLabel(self.header, text=title,
                                       font=(FM, 8), text_color=MUTED)
        self.lbl_title.pack(side="left")
        self.content = ctk.CTkFrame(self.frame, fg_color="transparent")
        for w in (self.header, self.lbl_arrow, self.lbl_title):
            w.bind("<Button-1>", lambda e: self.toggle())
        if start_collapsed:
            self._collapse()

    def toggle(self):
        if self._collapsed:
            self._expand()
        else:
            self._collapse()

    def _expand(self):
        self._collapsed = False
        self.lbl_arrow.configure(text="▾")
        self.content.pack(fill="x", padx=2, pady=(0, 4))

    def _collapse(self):
        self._collapsed = True
        self.lbl_arrow.configure(text="▸")
        self.content.pack_forget()


# ══════════════════════════════════════════════════════════════
# MAIN APP
# ══════════════════════════════════════════════════════════════
app = ctk.CTk()
app.title("Zone Timer")
app.geometry("360x520")
app.configure(fg_color=BG)
app.resizable(False, False)

saved = load_saved_config()
api = ZoneAPI(saved.get("url", ""))

server_state = {
    "connected": False,
    "session": {},
    "zones": [],
    "polling": False,
}

compact_mode = True

scroll = ctk.CTkScrollableFrame(app, fg_color=BG, scrollbar_fg_color=BG,
                                scrollbar_button_color=BG3,
                                scrollbar_button_hover_color=LINE,
                                corner_radius=0)
scroll.pack(fill="both", expand=True)


# ══════════════════════════════════════════════════════════════
# LOGIN SCREEN
# ══════════════════════════════════════════════════════════════
login_frame = ctk.CTkFrame(scroll, fg_color=BG1, corner_radius=R_PANEL,
                           border_width=1, border_color=LINE)
login_frame.pack(padx=20, pady=30, fill="x")

_ctk_title = ctk.CTkLabel(login_frame, text="ZONE", font=(FM, 24, "bold"),
                           text_color=CYAN)
_ctk_title.pack(pady=(24, 0))
ctk.CTkLabel(login_frame, text="TIMER", font=(FM, 10),
             text_color=MUTED).pack(pady=(0, 2))
ctk.CTkLabel(login_frame, text="Connect to your Zone OS",
             font=(F, 10), text_color=MUTED).pack(pady=(0, 16))

for label_text, default_val, key in [
    ("Server", "", "url"),
    ("Username", "", "username"),
    ("Password", "", "password"),
]:
    ctk.CTkLabel(login_frame, text=label_text, font=(FM, 9),
                 text_color=MUTED).pack(anchor="w", padx=20)
    ent = ctk.CTkEntry(login_frame, height=32, font=(F, 11),
                       fg_color=BG2, border_width=1, border_color=LINE,
                       text_color=TEXT, corner_radius=R_SM,
                       placeholder_text_color=MUTED)
    ent.pack(padx=20, pady=(3, 8), fill="x")
    if key == "password":
        ent.configure(show="*")
        if saved.get(key):
            ent.insert(0, saved[key])
        ent_pass = ent
    elif key == "username":
        if saved.get(key):
            ent.insert(0, saved[key])
        ent_user = ent
    else:
        ent.insert(0, saved.get(key, default_val))
        ent_url = ent

lbl_login_err = ctk.CTkLabel(login_frame, text="", font=(F, 9), text_color=RED)
lbl_login_err.pack(pady=(0, 6))

btn_login = ctk.CTkButton(login_frame, text="CONNECT", font=(FM, 11, "bold"),
                           fg_color=CYAN, hover_color="#2ba8dd", text_color=BG,
                           height=36, corner_radius=R_BTN, command=None)
btn_login.pack(padx=20, pady=(0, 22), fill="x")


# ══════════════════════════════════════════════════════════════
# TIMER VIEW
# ══════════════════════════════════════════════════════════════
timer_frame = ctk.CTkFrame(scroll, fg_color="transparent")

# ─── Top bar ───
top_bar = ctk.CTkFrame(timer_frame, fg_color="transparent")
top_bar.pack(fill="x", padx=16, pady=(12, 2))

lbl_title = ctk.CTkLabel(top_bar, text="ZONE", font=(FM, 12, "bold"),
                           text_color=CYAN)
lbl_title.pack(side="left")

_right_frame = ctk.CTkFrame(top_bar, fg_color="transparent")
_right_frame.pack(side="right")

lbl_conn = ctk.CTkLabel(_right_frame, text="●", font=(F, 10),
                         text_color=GREEN, width=12)
lbl_conn.pack(side="left", padx=(0, 4))

btn_mode = ctk.CTkButton(_right_frame, text="▾", font=(F, 10),
                           fg_color="transparent", hover_color=BG2,
                           text_color=MUTED, width=22, height=22,
                           corner_radius=R_SM, command=None)
btn_mode.pack(side="left", padx=(0, 4))

btn_logout = ctk.CTkButton(_right_frame, text="✕", font=(F, 10),
                            fg_color="transparent", hover_color=BG2,
                            text_color=RED, width=22, height=22,
                            corner_radius=R_SM, command=None)
btn_logout.pack(side="left")

lbl_user = ctk.CTkLabel(timer_frame, text="", font=(F, 9), text_color=MUTED)
lbl_user.pack(anchor="w", padx=16)

# ─── Timer card ───
timer_card = ctk.CTkFrame(timer_frame, fg_color=BG1, corner_radius=R_CARD,
                           border_width=1, border_color=LINE)
timer_card.pack(padx=16, pady=(6, 4), fill="x")

lbl_status = ctk.CTkLabel(timer_card, text="IDLE",
                           font=(FM, 9), text_color=MUTED)
lbl_status.pack(pady=(10, 2))

lbl_time = ctk.CTkLabel(timer_card, text="00:00",
                           font=(FM, 42, "bold"), text_color=CYAN)
lbl_time.pack(pady=(0, 4))

pbar = ctk.CTkProgressBar(timer_card, width=300, height=5,
                           fg_color=BG3, progress_color=CYAN, corner_radius=3)
pbar.pack(pady=(0, 4))
pbar.set(0)

zone_info = ctk.CTkFrame(timer_card, fg_color="transparent")
zone_info.pack(fill="x", padx=16, pady=(0, 10))

lbl_zone_name = ctk.CTkLabel(zone_info, text="No zone loaded",
                               font=(F, 10, "bold"), text_color=TEXT)
lbl_zone_name.pack(side="left")

lbl_zone_sub = ctk.CTkLabel(zone_info, text="",
                             font=(F, 9), text_color=MUTED)
lbl_zone_sub.pack(side="right")

# ─── Control buttons ───
ctrl = ctk.CTkFrame(timer_frame, fg_color=BG1, corner_radius=R_CARD,
                     border_width=1, border_color=LINE)
ctrl.pack(padx=16, pady=4, fill="x")

btns = {}

def mk_btn(parent, text, fg, cmd, is_primary=False):
    if is_primary:
        bg, tc, hov = fg, BG, "#2ba8dd"
    else:
        bg, tc, hov = BG2, TEXT_SEC, BG3
    return ctk.CTkButton(parent, text=text, font=(FM, 10),
                          fg_color=bg, hover_color=hov, text_color=tc,
                          border_width=1, border_color=LINE,
                          height=32, corner_radius=R_BTN, command=cmd)

btns["toggle"] = mk_btn(ctrl, "▶ START", CYAN, lambda: _toggle_start_pause(), True)
btns["toggle"].grid(row=0, column=0, columnspan=2, sticky="ew", padx=8, pady=(8, 3))
btns["skip"] = mk_btn(ctrl, "SKIP", CYAN, lambda: send_control("skip"))
btns["skip"].grid(row=1, column=0, sticky="ew", padx=(8, 3), pady=(3, 8))
btns["stop"] = mk_btn(ctrl, "RESET", RED, lambda: send_control("stop"))
btns["stop"].grid(row=1, column=1, sticky="ew", padx=(3, 8), pady=(3, 8))

ctrl.grid_columnconfigure(0, weight=1)
ctrl.grid_columnconfigure(1, weight=1)

# ─── Overlay toggle ───
btn_ov = ctk.CTkButton(timer_frame, text="Show Floating Timer",
                         font=(FM, 9, "bold"),
                         fg_color=BG1, hover_color=BG2,
                         text_color=GREEN, height=30, corner_radius=R_BTN,
                         border_width=1, border_color=LINE, command=None)
btn_ov.pack(padx=16, pady=(6, 4), fill="x")

# ─── Expandable sections ───
expandable_frame = ctk.CTkFrame(timer_frame, fg_color="transparent")

sec_log = CollapsibleSection(expandable_frame, "SYNC LOG", start_collapsed=True)
log_box = ctk.CTkTextbox(sec_log.content, height=60, font=("Consolas", 9),
                           fg_color=BG2, text_color=MUTED,
                           corner_radius=R_SM, border_width=0,
                           wrap="word", state="disabled")
log_box.pack(fill="x", padx=8, pady=(0, 4))

sec_overlay = CollapsibleSection(expandable_frame, "OVERLAY SETTINGS", start_collapsed=True)
ov_cfg = ctk.CTkFrame(sec_overlay.content, fg_color="transparent")
ov_cfg.pack(fill="x", padx=8, pady=(4, 4))

# ─── Overlay settings functions ───
def _apply_overlay_settings_live(*_):
    fade_settings["delay_ms"] = int(slider_delay.get() * 1000)
    hide_pct = slider_hide.get()
    fade_settings["idle_alpha"] = round(1.0 - hide_pct / 100.0, 2)
    spd = slider_speed.get()
    fade_settings["fade_speed"] = 0.02 if spd < 0.33 else (0.08 if spd >= 0.66 else 0.04)
    # Save to config so it persists across restarts
    save_overlay_settings(slider_delay.get(), slider_hide.get(), slider_speed.get())
    # Update preview text
    _update_preview()
    if overlay_visible:
        # If overlay is already shrunk, apply new alpha + speed immediately
        if not _overlay_expanded:
            _fade_to(fade_settings["idle_alpha"])
        # Reset shrink timer with new delay
        _reset_fade_timer()

def _on_delay_changed(v):
    lbl_delay_val.configure(text=f"{float(v):.1f}s")
    _apply_overlay_settings_live()

def _on_hide_changed(v):
    lbl_hide_val.configure(text=f"{int(float(v))}%")
    _apply_overlay_settings_live()

def _on_speed_changed(v):
    v = float(v)
    if v < 0.33: lbl_speed_val.configure(text="Slow")
    elif v < 0.66: lbl_speed_val.configure(text="Med")
    else: lbl_speed_val.configure(text="Fast")
    _apply_overlay_settings_live()

def _update_preview():
    d = slider_delay.get()
    h = int(slider_hide.get())
    spd = "Slow" if slider_speed.get() < 0.33 else ("Fast" if slider_speed.get() >= 0.66 else "Med")
    lbl_preview.configure(text=f"Fade {d:.1f}s · {h}% hidden · {spd}")

_saved_ov = load_overlay_settings()

ctk.CTkLabel(ov_cfg, text="Hide after", font=(F, 10),
             text_color=MUTED).grid(row=0, column=0, sticky="w", pady=4)
lbl_delay_val = ctk.CTkLabel(ov_cfg, text=f"{_saved_ov['delay_s']:.1f}s", font=(FM, 9, "bold"),
                              text_color=TEXT, width=34)
lbl_delay_val.grid(row=0, column=2, sticky="e", pady=4)
slider_delay = ctk.CTkSlider(ov_cfg, from_=0, to=10, number_of_steps=20,
                              width=120, height=12, corner_radius=R_SM,
                              fg_color=BG3, progress_color=CYAN,
                              button_color=CYAN, button_hover_color="#2ba8dd",
                              command=_on_delay_changed)
slider_delay.grid(row=0, column=1, sticky="e", pady=4, padx=(6, 6))
slider_delay.set(_saved_ov["delay_s"])

ctk.CTkLabel(ov_cfg, text="Hide %", font=(F, 10),
             text_color=MUTED).grid(row=1, column=0, sticky="w", pady=4)
lbl_hide_val = ctk.CTkLabel(ov_cfg, text=f"{int(_saved_ov['hide_pct'])}%", font=(FM, 9, "bold"),
                             text_color=TEXT, width=34)
lbl_hide_val.grid(row=1, column=2, sticky="e", pady=4)
slider_hide = ctk.CTkSlider(ov_cfg, from_=10, to=95, number_of_steps=17,
                             width=120, height=12, corner_radius=R_SM,
                             fg_color=BG3, progress_color=CYAN,
                             button_color=CYAN, button_hover_color="#2ba8dd",
                             command=_on_hide_changed)
slider_hide.grid(row=1, column=1, sticky="e", pady=4, padx=(6, 6))
slider_hide.set(_saved_ov["hide_pct"])

ctk.CTkLabel(ov_cfg, text="Speed", font=(F, 10),
             text_color=MUTED).grid(row=2, column=0, sticky="w", pady=4)
_init_spd_label = "Slow" if _saved_ov["speed"] < 0.33 else ("Fast" if _saved_ov["speed"] >= 0.66 else "Med")
lbl_speed_val = ctk.CTkLabel(ov_cfg, text=_init_spd_label, font=(FM, 9, "bold"),
                              text_color=TEXT, width=34)
lbl_speed_val.grid(row=2, column=2, sticky="e", pady=4)
slider_speed = ctk.CTkSlider(ov_cfg, from_=0, to=1, number_of_steps=20,
                              width=120, height=12, corner_radius=R_SM,
                              fg_color=BG3, progress_color=CYAN,
                              button_color=CYAN, button_hover_color="#2ba8dd",
                              command=_on_speed_changed)
slider_speed.grid(row=2, column=1, sticky="e", pady=4, padx=(6, 6))
slider_speed.set(_saved_ov["speed"])

ov_cfg.columnconfigure(0, weight=1)

lbl_preview = ctk.CTkLabel(sec_overlay.content, text="", font=(F, 8), text_color=MUTED)
lbl_preview.pack(padx=8, pady=(0, 6))
_update_preview()


# ══════════════════════════════════════════════════════════════
# COMPACT / FULL MODE TOGGLE (main window)
# ══════════════════════════════════════════════════════════════
def toggle_compact():
    global compact_mode
    compact_mode = not compact_mode
    if compact_mode:
        expandable_frame.pack_forget()
        btn_mode.configure(text="▾")
        sec_log._collapse()
        sec_overlay._collapse()
        app.after(50, lambda: app.geometry("360x520"))
    else:
        expandable_frame.pack(padx=16, pady=(4, 12), fill="x", after=btn_ov)
        sec_log.frame.pack(fill="x", pady=3)
        sec_overlay.frame.pack(fill="x", pady=3)
        btn_mode.configure(text="▴")
        app.after(50, lambda: app.geometry("380x620"))

btn_mode.configure(command=toggle_compact)


# ══════════════════════════════════════════════════════════════
# FLOATING OVERLAY — Circular Ring Timer
# ══════════════════════════════════════════════════════════════
# EXPANDED: big circle ring + digits + status + controls
# SHRUNK:   auto-shrinks to rounded pill (just digits, transparent)
# Hover expands back. Ring depletes clockwise in real-time.
# ══════════════════════════════════════════════════════════════

_overlay_expanded = True
_user_opacity = 0.92
_current_alpha = 0.92
_hovered = False
_fade_after_id = None
_shrink_after_id = None
_fade_tick_id = None
overlay_visible = False
_ov_timer_text = "00:00"
_ov_label_text = "IDLE"
_ov_color = CYAN

# ── Fixed sizes (no runtime guessing) ──
_FULL_W, _FULL_H   = 220, 260     # full ring mode (window)
_PILL_W, _PILL_H   = 110, 42      # shrunk pill mode (window)
_RING_R            = 68           # ring radius
_RING_W            = 6            # ring stroke width

# ── Create overlay window (deferred to avoid Linux startup hang) ──
ov = None
ov_canvas = None
ov_btns_frame = None
ov_b_toggle = None
ov_b_skip = None
ov_b_stop = None
_OV_CH_FULL = 190
_OV_CH_PILL = 26

def _init_overlay():
    """Create overlay window AFTER main window is shown (avoids Linux hang)."""
    global ov, ov_canvas, ov_btns_frame
    global ov_b_toggle, ov_b_skip, ov_b_stop
    if ov is not None:
        return
    ov = ctk.CTkToplevel(app)
    ov.title("Zone")
    ov.overrideredirect(True)
    ov.attributes("-topmost", True)
    ov.configure(fg_color="#0A0D13")
    ov.geometry(f"{_FULL_W}x{_FULL_H}+120+120")
    ov.withdraw()

    try:
        ov.attributes("-alpha", _current_alpha)
    except Exception:
        pass

    # ── Canvas (ring + text) ──
    ov_canvas = tk.Canvas(ov, highlightthickness=0, bg="#0A0D13",
                           width=_OV_CH_FULL, height=_OV_CH_FULL)
    ov_canvas.pack(padx=10, pady=(10, 4), fill="both", expand=True)

    # ── Controls frame (packed only in expanded mode) ──
    ov_btns_frame = ctk.CTkFrame(ov, fg_color="transparent")

    # ── Overlay control buttons (must be created inside _init_overlay) ──
    ov_b_toggle = _mk_small_btn(ov_btns_frame, "▶",  CYAN,     lambda: _toggle_start_pause(), "#0d1e2a")
    ov_b_skip   = _mk_small_btn(ov_btns_frame, "⏭",  TEXT_SEC,  lambda: send_control("skip"))
    ov_b_stop   = _mk_small_btn(ov_btns_frame, "↺",  RED,       lambda: send_control("stop"), "#200e12")
    ov_b_toggle.pack(side="left", padx=4)
    ov_b_skip.pack(side="left", padx=4)
    ov_b_stop.pack(side="left", padx=4)

def _mk_small_btn(parent, text, fg, cmd, hover_bg=BG3):
    return ctk.CTkButton(parent, text=text, font=(FM, 10),
                          fg_color="transparent", hover_color=hover_bg,
                          text_color=fg, width=30, height=22,
                          corner_radius=6, command=cmd)


# ══════════════════════════════════════════════════════════════
# DRAW RING — uses fixed dimensions, no winfo_width() dependency
# ══════════════════════════════════════════════════════════════
def _draw_ring(progress_pct, color, time_str, label_str, expanded, zone_txt=""):
    ov_canvas.delete("all")

    # Use actual canvas size (50ms delay ensures layout is settled)
    cw = ov_canvas.winfo_width()
    ch = ov_canvas.winfo_height()
    # Fallback for first render before layout
    if cw < 20:
        cw = _FULL_W if expanded else _PILL_W
    if ch < 10:
        ch = _OV_CH_FULL if expanded else _OV_CH_PILL

    cx, cy = cw // 2, ch // 2

    if expanded:
        r = min(cx, cy) - 15  # ring radius fits inside canvas with padding

        # Background ring (dim) — create_oval draws outline only (no fill = ring)
        ov_canvas.create_oval(cx - r, cy - r, cx + r, cy + r,
                               outline=BG3, width=_RING_W)
        # Progress arc — use create_arc for partial ring (clockwise from top)
        extent = -(max(0.0, min(1.0, progress_pct)) * 360)
        if abs(extent) > 0.5:
            ov_canvas.create_arc(cx - r, cy - r, cx + r, cy + r,
                                  outline=color, width=_RING_W,
                                  style="arc", start=90, extent=extent)
        # Glow (subtle thinner outer arc)
        if abs(extent) > 0.5:
            ov_canvas.create_arc(cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3,
                                  outline=color, width=1, style="arc",
                                  start=90, extent=extent)
        # Timer digits (centered)
        ov_canvas.create_text(cx, cy - 6, text=time_str,
                               fill=color, font=(FM, 32, "bold"))
        # Status label
        ov_canvas.create_text(cx, cy + 22, text=label_str,
                               fill=color, font=(FM, 8, "bold"))
        # Zone + cycle
        if zone_txt:
            ov_canvas.create_text(cx, cy + 36, text=zone_txt,
                                   fill=MUTED, font=(F, 7))
    else:
        # PILL MODE — just digits, centered in actual canvas
        ov_canvas.create_text(cx, cy, text=time_str,
                               fill=color, font=(FM, 16, "bold"),
                               anchor="center")


def _redraw():
    """Redraw canvas based on current state."""
    d = get_session_data()
    remaining = d["remaining"]
    total = d["total"]
    progress = (remaining / total) if total > 0 else 0

    # Color based on block type
    global _ov_color
    if d["block_type"] == "focus":
        _ov_color = CYAN
    elif d["block_type"] == "break":
        _ov_color = AMBER
    else:
        _ov_color = GREEN
    if d["day_complete"]:
        _ov_color = GREEN

    label = "FOCUS" if d["block_type"] == "focus" else "BREAK"
    if d["day_complete"]:
        label = "COMPLETE"
    status = "RUNNING" if d["running"] else ("OVERTIME" if d["block_complete"] else "PAUSED")

    global _ov_timer_text, _ov_label_text
    _ov_timer_text = fmt_time(remaining)
    _ov_label_text = f"{label} · {status}"
    zone_txt = f"Z{d['zone_idx']+1}/{d['total_zones']} · C{d['cycle']+1}/4"

    _draw_ring(progress, _ov_color, _ov_timer_text, _ov_label_text,
               _overlay_expanded, zone_txt)

    # Update toggle button text/icon based on running state
    if ov_b_toggle is not None:
        if d["running"]:
            ov_b_toggle.configure(text="⏸", fg_color="#1a1520",
                                  hover_color="#2a1d30")
        else:
            ov_b_toggle.configure(text="▶", fg_color="#0d1e2a",
                                  hover_color="#132a3a")


# ══════════════════════════════════════════════════════════════
# EXPAND / SHRINK
# ══════════════════════════════════════════════════════════════
def _shrink_to_pill():
    global _overlay_expanded
    if not _overlay_expanded or _hovered or not overlay_visible:
        return
    _overlay_expanded = False
    ov_btns_frame.pack_forget()
    ov_canvas.configure(height=_OV_CH_PILL)
    ov.geometry(f"{_PILL_W}x{_PILL_H}")
    _fade_to(fade_settings["idle_alpha"])
    ov.after(50, _redraw)  # delayed draw so geometry settles first

def _expand_overlay():
    global _overlay_expanded
    if _overlay_expanded:
        # Already expanded — just reset shrink timer
        _reset_shrink_timer()
        return
    _overlay_expanded = True
    ov.geometry(f"{_FULL_W}x{_FULL_H}")
    ov_canvas.configure(height=_OV_CH_FULL)
    ov_btns_frame.pack(fill="x", padx=8, pady=(0, 8))
    _fade_to(_user_opacity)
    ov.after(50, _redraw)
    _reset_shrink_timer()

def _reset_shrink_timer():
    global _shrink_after_id
    if _shrink_after_id:
        try:
            ov.after_cancel(_shrink_after_id)
        except Exception:
            pass
        _shrink_after_id = None
    if overlay_visible:
        _shrink_after_id = ov.after(fade_settings["delay_ms"], _shrink_to_pill)

# Alias — overlay settings calls this name
def _reset_fade_timer():
    _reset_shrink_timer()


# ══════════════════════════════════════════════════════════════
# ALPHA + FADE ANIMATION
# ══════════════════════════════════════════════════════════════
def _set_alpha(val):
    global _current_alpha
    _current_alpha = max(0.05, min(1.0, val))
    try:
        ov.attributes("-alpha", _current_alpha)
    except Exception:
        pass

_fade_anim_id = None

def _fade_to(target_alpha, step=None):
    """Gradually fade from current alpha to target using fade_settings speed."""
    global _fade_anim_id
    if step is None:
        step = fade_settings["fade_speed"]
    if _fade_anim_id:
        try:
            ov.after_cancel(_fade_anim_id)
        except Exception:
            pass
        _fade_anim_id = None
    diff = target_alpha - _current_alpha
    if abs(diff) < step:
        _set_alpha(target_alpha)
        return
    _set_alpha(_current_alpha + (step if diff > 0 else -step))
    _fade_anim_id = ov.after(30, _fade_to, target_alpha, step)


# ══════════════════════════════════════════════════════════════
# DRAG
# ══════════════════════════════════════════════════════════════
def _start_drag(e):
    ov._dx = e.x_root - ov.winfo_x()
    ov._dy = e.y_root - ov.winfo_y()

def _do_drag(e):
    x = e.x_root - ov._dx
    y = e.y_root - ov._dy
    ov.geometry(f"+{x}+{y}")

def _bind_all_drag():
    for w in [ov, ov_canvas]:
        w.bind("<Button-1>", _start_drag)
        w.bind("<B1-Motion>", _do_drag)
    for w in ov_btns_frame.winfo_children():
        w.bind("<Button-1>", _start_drag)
        w.bind("<B1-Motion>", _do_drag)


# ══════════════════════════════════════════════════════════════
# HOVER — expand on enter, schedule shrink on leave
# ══════════════════════════════════════════════════════════════
def _on_enter(e):
    global _hovered, _fade_after_id
    _hovered = True
    if _fade_after_id:
        try:
            ov.after_cancel(_fade_after_id)
        except Exception:
            pass
        _fade_after_id = None
    # Cancel any in-progress fade animation
    global _fade_anim_id
    if _fade_anim_id:
        try:
            ov.after_cancel(_fade_anim_id)
        except Exception:
            pass
        _fade_anim_id = None
    _expand_overlay()

def _on_leave(e):
    global _hovered, _fade_after_id
    _hovered = False
    _reset_shrink_timer()
    _fade_after_id = ov.after(fade_settings["delay_ms"], _do_idle_fade)

def _do_idle_fade():
    if not _hovered and not _overlay_expanded:
        _fade_to(fade_settings["idle_alpha"])

def _bind_all_hover():
    for w in [ov, ov_canvas]:
        try:
            w.bind("<Enter>", _on_enter)
            w.bind("<Leave>", _on_leave)
        except Exception:
            pass
    for w in ov_btns_frame.winfo_children():
        try:
            w.bind("<Enter>", _on_enter)
            w.bind("<Leave>", _on_leave)
        except Exception:
            pass


# ══════════════════════════════════════════════════════════════
# DOUBLE-CLICK & RIGHT-CLICK
# ══════════════════════════════════════════════════════════════
def _ov_double_click(e):
    if _overlay_expanded:
        d = get_session_data()
        if d["running"]:
            send_control("pause")
        else:
            send_control("start")
    else:
        _expand_overlay()

def _ov_right_click(e):
    if not _overlay_expanded:
        _expand_overlay()

# Bind after send_control is defined (done in toggle_overlay)

# ══════════════════════════════════════════════════════════════
# SHOW / HIDE TOGGLE
# ══════════════════════════════════════════════════════════════
def toggle_overlay():
    global overlay_visible, _overlay_expanded
    _init_overlay()  # create overlay on first use (not at startup)
    overlay_visible = not overlay_visible
    if overlay_visible:
        _overlay_expanded = True
        ov.geometry(f"{_FULL_W}x{_FULL_H}+120+120")
        ov_canvas.configure(height=_OV_CH_FULL)
        ov.deiconify()
        ov.attributes("-topmost", True)
        ov_btns_frame.pack(fill="x", padx=8, pady=(0, 8))
        _set_alpha(0.01)
        # Delayed draw + fade-in: ensures window is fully mapped
        def _show_after():
            _redraw()
            _fade_to(_user_opacity)
            _bind_all_drag()
            _bind_all_hover()
            # Bind click events
            ov.bind("<Double-Button-1>", _ov_double_click)
            ov_canvas.bind("<Double-Button-1>", _ov_double_click)
            ov.bind("<Button-3>", _ov_right_click)
            _reset_shrink_timer()
        ov.after(80, _show_after)
        btn_ov.configure(text="Hide Floating Timer", text_color=RED)
    else:
        ov.withdraw()
        global _shrink_after_id, _fade_after_id, _fade_anim_id
        if _shrink_after_id:
            try:
                ov.after_cancel(_shrink_after_id)
            except Exception:
                pass
            _shrink_after_id = None
        if _fade_after_id:
            try:
                ov.after_cancel(_fade_after_id)
            except Exception:
                pass
            _fade_after_id = None
        if _fade_anim_id:
            try:
                ov.after_cancel(_fade_anim_id)
            except Exception:
                pass
            _fade_anim_id = None
        btn_ov.configure(text="Show Floating Timer", text_color=GREEN)

btn_ov.configure(command=toggle_overlay)


# ══════════════════════════════════════════════════════════════
# LOGGING
# ══════════════════════════════════════════════════════════════
_log_lines = []

def add_log(msg: str):
    ts = _time.strftime("%H:%M:%S")
    line = f"[{ts}] {msg}"
    _log_lines.append(line)
    if len(_log_lines) > 50:
        _log_lines.pop(0)
    log_box.configure(state="normal")
    log_box.delete("1.0", "end")
    log_box.insert("end", "\n".join(_log_lines))
    log_box.see("end")
    log_box.configure(state="disabled")


# ══════════════════════════════════════════════════════════════
# FORMATTING
# ══════════════════════════════════════════════════════════════
def fmt_time(seconds: int) -> str:
    m, s = divmod(max(0, int(seconds)), 60)
    return f"{m:02d}:{s:02d}"

def get_session_data() -> dict:
    session = server_state.get("session", {})
    by_zone = session.get("byZone", {})
    idx = session.get("currentZoneIdx", 0)
    zs = by_zone.get(str(idx), {})
    zones = server_state.get("zones", [])
    zone_cfg = zones[idx] if idx < len(zones) else {}

    remaining = zs.get("remaining", 0)
    total = zs.get("total", 1500)
    running = zs.get("running", False)
    last_tick = zs.get("lastTick")

    if running and last_tick:
        try:
            elapsed_ms = (_time.time() * 1000) - float(last_tick)
            elapsed_sec = max(0, elapsed_ms / 1000)
            remaining = max(0, remaining - elapsed_sec)
        except (TypeError, ValueError):
            pass

    return {
        "remaining": remaining,
        "total": total,
        "running": running,
        "block_type": zs.get("blockType", "focus"),
        "cycle": zs.get("cycle", 0),
        "block_complete": zs.get("blockComplete", False),
        "overtime": zs.get("overtimeSeconds", 0),
        "zone_idx": idx,
        "total_zones": len(zones),
        "zone_title": zone_cfg.get("title", f"Zone {idx + 1}"),
        "focus_dur": zone_cfg.get("focusDuration", 25),
        "day_complete": session.get("dayComplete", False),
    }

def _touch_last_tick():
    session = server_state.get("session", {})
    by_zone = session.get("byZone", {})
    idx = session.get("currentZoneIdx", 0)
    zs = by_zone.get(str(idx))
    if zs is not None:
        zs["lastTick"] = str(int(_time.time() * 1000))


# ══════════════════════════════════════════════════════════════
# LOGIN / LOGOUT
# ══════════════════════════════════════════════════════════════
def do_login():
    url = ent_url.get().strip()
    user = ent_user.get().strip()
    pw = ent_pass.get().strip()
    if not url or not user or not pw:
        lbl_login_err.configure(text="All fields required")
        return
    btn_login.configure(text="CONNECTING...", state="disabled")
    lbl_login_err.configure(text="")

    def _login_thread():
        api.base_url = url.rstrip("/")
        result = api.login(user, pw)
        app.after(0, lambda: _on_login_result(result, user))

    threading.Thread(target=_login_thread, daemon=True).start()

def _on_login_result(result, username):
    btn_login.configure(text="CONNECT", state="normal")
    if not result or result.get("error"):
        err = (result or {}).get("error", "Connection failed")
        lbl_login_err.configure(text=str(err))
        add_log(f"Login failed: {err}")
        return
    server_state["connected"] = True
    server_state["username"] = username
    api.username = username
    add_log(f"Connected as {username}")
    save_config(api.base_url, username, ent_pass.get().strip())
    login_frame.pack_forget()
    timer_frame.pack(fill="both", expand=True)
    lbl_user.configure(text=f"Logged in as {username}")
    start_polling()

btn_login.configure(command=do_login)
ent_pass.bind("<Return>", lambda e: do_login())


def do_logout():
    server_state["connected"] = False
    server_state["polling"] = False
    server_state["session"] = {}
    server_state["zones"] = []
    try:
        CONFIG_FILE.unlink(missing_ok=True)
    except Exception:
        pass
    ent_user.delete(0, "end")
    ent_pass.delete(0, "end")
    timer_frame.pack_forget()
    expandable_frame.pack_forget()
    global compact_mode
    compact_mode = True
    btn_mode.configure(text="▾")
    login_frame.pack(padx=20, pady=30, fill="x")
    lbl_login_err.configure(text="")
    btn_login.configure(text="CONNECT", state="normal")
    add_log("Logged out")
    if overlay_visible:
        toggle_overlay()

btn_logout.configure(command=do_logout)


# ══════════════════════════════════════════════════════════════
# CONTROL API
# ══════════════════════════════════════════════════════════════
def _toggle_start_pause():
    """Single toggle button: sends start if paused, pause if running."""
    d = get_session_data()
    if d["running"]:
        send_control("pause")
    else:
        send_control("start")

def send_control(action):
    if not server_state["connected"]:
        add_log("Not connected")
        return
    def _send():
        result = api.control(action)
        app.after(0, lambda: _on_control_result(action, result))
    threading.Thread(target=_send, daemon=True).start()

def _on_control_result(action, result):
    if result and result.get("status") == "ok":
        add_log(f"→ {action.upper()}")
        if result.get("session"):
            server_state["session"] = result["session"]
            if action in ("pause", "stop"):
                _touch_last_tick()
            refresh_from_server()
    else:
        err = (result or {}).get("error", "Failed")
        add_log(f"✗ {action} failed: {err}")


# ══════════════════════════════════════════════════════════════
# POLLING
# ══════════════════════════════════════════════════════════════
def start_polling():
    server_state["polling"] = True
    _poll_once()

def _poll_once():
    if not server_state["polling"]:
        return
    def _fetch():
        try:
            data = api.get_timer_state()
            app.after(0, lambda: _on_poll_result(data))
        except Exception as e:
            app.after(0, lambda: _on_poll_error(str(e)))
    threading.Thread(target=_fetch, daemon=True).start()

def _on_poll_result(data):
    if data and not data.get("error") and not data.get("guest"):
        server_state["session"] = data.get("session", {})
        server_state["zones"] = data.get("zones", [])
        if not server_state.get("connected"):
            server_state["connected"] = True
            login_frame.pack_forget()
            timer_frame.pack(fill="both", expand=True)
            lbl_user.configure(text=f"Logged in as {api.username}")
        refresh_from_server()
    elif data and data.get("error") == "unauthorized":
        server_state["connected"] = False
        server_state["polling"] = False
        add_log("Session expired — reconnect")
        lbl_conn.configure(text="●", text_color=RED)
    app.after(2000, _poll_once)

def _on_poll_error(err):
    add_log(f"Poll error: {err}")
    app.after(3000, _poll_once)


# ══════════════════════════════════════════════════════════════
# REFRESH DISPLAY
# ══════════════════════════════════════════════════════════════
def refresh_from_server():
    d = get_session_data()
    if d["block_type"] == "focus":
        fg = CYAN
    elif d["block_type"] == "break":
        fg = AMBER
    else:
        fg = GREEN
    label = "FOCUS" if d["block_type"] == "focus" else "BREAK"
    if d["day_complete"]:
        label = "COMPLETE"
        fg = GREEN
    status = "RUNNING" if d["running"] else ("OVERTIME" if d["block_complete"] else "PAUSED")

    is_overtime = d["block_complete"] and d["overtime"] > 0

    # Main window
    lbl_zone_name.configure(text=d["zone_title"], text_color=fg)
    lbl_zone_sub.configure(text=f"Zone {d['zone_idx'] + 1}/{d['total_zones']}  ·  {d['focus_dur']}min")

    if is_overtime:
        # Show overtime with + prefix and red color
        ot_sec = int(d["overtime"])
        # Also compute live OT from last_tick if running
        if d["running"]:
            session = server_state.get("session", {})
            by_zone = session.get("byZone", {})
            zs = by_zone.get(str(d["zone_idx"]), {})
            last_tick = zs.get("lastTick")
            if last_tick:
                try:
                    live_ms = (_time.time() * 1000) - float(last_tick)
                    ot_sec += max(0, int(live_ms / 1000))
                except (TypeError, ValueError):
                    pass
        lbl_time.configure(text=f"+{fmt_time(ot_sec)}", text_color=RED)
        lbl_status.configure(text=f"{label}  ·  Cycle {d['cycle'] + 1}  ·  OVERTIME", text_color=RED)
        pbar.configure(progress_color=RED)
        pbar.set(0)  # no progress in overtime
    else:
        lbl_time.configure(text=fmt_time(d["remaining"]), text_color=fg)
        lbl_status.configure(text=f"{label}  ·  Cycle {d['cycle'] + 1}  ·  {status}", text_color=fg)
        pbar.configure(progress_color=fg)
        if d["total"] > 0:
            pbar.set(max(0, d["remaining"] / d["total"]))
        else:
            pbar.set(0)

    # Toggle button state
    if d["running"]:
        btns["toggle"].configure(text="⏸  PAUSE", fg_color="#1a1520", text_color=TEXT,
                                 hover_color="#2a1d30", border_color="#3a2a50")
    else:
        btns["toggle"].configure(text="▶  START", fg_color=CYAN, text_color=BG,
                                 hover_color="#2ba8dd", border_color=LINE)

    # Overlay — redraw ring
    if overlay_visible:
        _redraw()

    # Connection indicator
    if server_state["connected"]:
        lbl_conn.configure(text="●", text_color=GREEN)
    else:
        lbl_conn.configure(text="●", text_color=RED)

    # Window title
    if is_overtime:
        ot_sec = int(d["overtime"])
        app.title(f"+{fmt_time(ot_sec)} OVERTIME — {d['zone_title']}")
    elif d["remaining"] > 0:
        app.title(f"{fmt_time(d['remaining'])} — {d['zone_title']}")
    else:
        app.title("Zone Timer")


# ══════════════════════════════════════════════════════════════
# AUTO-REFRESH + START
# ══════════════════════════════════════════════════════════════
def auto_refresh():
    if server_state["connected"]:
        refresh_from_server()
    app.after(1000, auto_refresh)

refresh_from_server()
app.after(1000, auto_refresh)

# ══════════════════════════════════════════════════════════════
# TOUCHPAD SCROLL FIX (Linux)
# ══════════════════════════════════════════════════════════════
def _touchpad_scroll(e):
    if e.num == 4:
        scroll._parent_canvas.yview_scroll(-1, "units")
    elif e.num == 5:
        scroll._parent_canvas.yview_scroll(1, "units")
    return "break"

app.bind_all("<Button-4>", _touchpad_scroll)
app.bind_all("<Button-5>", _touchpad_scroll)

app.mainloop()
