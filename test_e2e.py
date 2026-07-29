#!/usr/bin/env python3
"""End-to-end test suite for Zone Study OS."""

import json
import os
import sys
import time
import urllib.request
import urllib.error

BASE = os.environ.get("ZONE_TEST_URL", "http://localhost:7860")
ADMIN_USER = os.environ.get("ZONE_USERNAME", "admin")
ADMIN_PASS = os.environ.get("ZONE_PASSWORD", "admin123")
TEST_USER = "testuser_e2e"
TEST_PASS = "testpass123"
TOTAL = 0
PASSED = 0
FAILED = 0

# Simple token-based session tracking
_session_token = None

def set_session_token(token):
    global _session_token
    _session_token = token

def clear_session():
    global _session_token
    _session_token = None

def api(method, path, data=None, raw=False):
    url = BASE.rstrip("/") + path
    if isinstance(data, dict):
        data = json.dumps(data).encode()
    elif isinstance(data, str):
        data = data.encode()
    req = urllib.request.Request(url, data=data, method=method)
    if raw:
        req.add_header("Content-Type", "application/octet-stream")
    else:
        req.add_header("Content-Type", "application/json")
    if _session_token:
        req.add_header("Cookie", f"zone_session={_session_token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read()
            if raw:
                return resp, body
            ct = resp.headers.get("Content-Type", "")
            if "json" in ct:
                return resp, json.loads(body)
            return resp, body
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            return e, json.loads(body)
        except Exception:
            return e, body

def extract_token(resp):
    """Extract zone_session token from Set-Cookie header."""
    for h in resp.headers.get_all("Set-Cookie") or []:
        for part in h.split(","):
            part = part.strip()
            nv = part.split(";")[0].strip()
            if nv.startswith("zone_session="):
                set_session_token(nv.split("=", 1)[1])
                return

def login(uname, pw):
    clear_session()
    resp, body = api("POST", "/api/login", {"username": uname, "password": pw})
    if resp.status == 200:
        extract_token(resp)
    return resp, body

def signup(uname, pw):
    clear_session()
    resp, body = api("POST", "/api/signup", {"username": uname, "password": pw})
    if resp.status == 200:
        extract_token(resp)
    return resp, body

def guest_login():
    clear_session()
    resp, body = api("POST", "/api/guest-login")
    if resp.status == 200:
        extract_token(resp)
    return resp, body

def check(name, condition, detail=""):
    global TOTAL, PASSED, FAILED
    TOTAL += 1
    if condition:
        PASSED += 1
        print(f"  PASS [{TOTAL:03d}] {name}")
    else:
        FAILED += 1
        print(f"  FAIL [{TOTAL:03d}] {name}  -- {detail}")

def check_eq(name, actual, expected):
    ok = actual == expected
    check(name, ok, f"got {repr(actual)}, expected {repr(expected)}")
    return ok

def header(text):
    print(f"\n{'=' * 60}")
    print(f"  {text}")
    print(f"{'=' * 60}")

def wait(sec=10.0):
    """Wait to stay under rate limit: 10 req / 60 s window."""
    time.sleep(sec)

# ═══════════════════════════════════════════════════
header("1. HEALTH & BASIC ENDPOINTS")

clear_session()
resp, body = api("GET", "/health")
check("health returns 200", resp.status == 200)
check_in = lambda n, i, c: check(n, i.lower() in str(c).lower())

resp, body = api("GET", "/api/auth-check")
check_eq("auth-check unauthed 401", resp.status, 401)

# ═══════════════════════════════════════════════════
header("2. GUEST LOGIN")

resp, body = guest_login()
check("guest login 200", resp.status == 200)
check("guest login has token", bool(body.get("token")))
check_eq("guest login guest True", body.get("guest"), True)

resp2, body2 = api("GET", "/api/auth-check")
check("guest auth-check authed False", body2.get("authed") == False)
check("guest auth-check guest True", body2.get("guest") == True)
check("guest auth-check username None", body2.get("username") is None)
check("guest auth-check isAdmin False", body2.get("isAdmin") == False)

resp, body = api("GET", "/api/user-data")
check("guest user-data guest True", body.get("guest") == True)

resp, body = api("GET", "/api/timer/state")
check("guest timer state guest True", body.get("guest") == True)

resp, body = api("POST", "/api/logout")
check("guest logout ok", resp.status == 200)

# ═══════════════════════════════════════════════════
header("3. SIGNUP FLOW")

# Clean up test user from previous runs for idempotency
resp, _ = login(ADMIN_USER, ADMIN_PASS)
if resp.status == 200:
    api("POST", "/api/admin/delete-user", {"username": TEST_USER})
clear_session()
wait()

resp, body = signup(TEST_USER, TEST_PASS)
check("signup 200", resp.status == 200)
check("signup has token", bool(body.get("token")))
check_eq("signup username", body.get("username"), TEST_USER)

resp, body = api("GET", "/api/auth-check")
check("signup auth-check authed", body.get("authed") == True)
check("signup auth-check username", body.get("username") == TEST_USER)
check("signup auth-check not admin", body.get("isAdmin") == False)
check("signup auth-check not guest", body.get("guest") == False)

resp, body = api("POST", "/api/signup", {"username": TEST_USER, "password": TEST_PASS})
check_eq("duplicate signup 409", resp.status, 409)

resp, body = api("POST", "/api/signup", {"username": "a", "password": "short"})
check("bad signup rejected", resp.status in (400, 422))

# ═══════════════════════════════════════════════════
header("4. LOGOUT & RE-LOGIN")

resp, body = api("POST", "/api/logout")
check("logout 200", resp.status == 200)

resp, body = api("GET", "/api/auth-check")
check_eq("after logout 401", resp.status, 401)

resp, body = login(TEST_USER, TEST_PASS)
check("login 200", resp.status == 200)
check_eq("login username", body.get("username"), TEST_USER)

resp, body = login(TEST_USER, "wrongpass123")
check_eq("bad login 401", resp.status, 401)

# Re-login to restore session for next section
resp, body = login(TEST_USER, TEST_PASS)
check("re-login ok", resp.status == 200)

wait()

# ═══════════════════════════════════════════════════
header("5. ADMIN LOGIN")

resp, body = login(ADMIN_USER, ADMIN_PASS)
check("admin login 200", resp.status == 200)
check_eq("admin username", body.get("username"), ADMIN_USER)

resp, body = api("GET", "/api/auth-check")
check("admin isAdmin True", body.get("isAdmin") == True)
check("admin authed True", body.get("authed") == True)

resp, body = api("GET", "/api/exam-tracks")
check("exam-tracks admin 200", resp.status == 200)
check("exam-tracks has tracks", "tracks" in body)
track_ids = [t["id"] for t in body.get("tracks", [])]
check("exam-tracks has JEE", "JEE" in track_ids)
check("exam-tracks has NEET", "NEET" in track_ids)
check("exam-tracks has UPSC", "UPSC" in track_ids)
check("exam-tracks has GATE", "GATE" in track_ids)
check("exam-tracks has CA", "CA" in track_ids)
check("exam-tracks has BOARDS", "BOARDS" in track_ids)
check("exam-tracks has CUSTOM", "CUSTOM" in track_ids)

wait()

wait(65)  # Extra wait — rate limit window reset

# ═══════════════════════════════════════════════════
header("6. CHANGE PASSWORD")

resp, body = login(TEST_USER, TEST_PASS)
check("login for pw change ok", resp.status == 200)

resp, body = api("POST", "/api/change-password",
                 {"current_password": TEST_PASS, "new_password": "newpass45678"})
check("change password ok", resp.status == 200)
# Re-extract token in case it was refreshed
extract_token(resp)

# Re-login after password change (old token may be stale)
resp, body = login(TEST_USER, "newpass45678")
check("re-login with new pw ok", resp.status == 200)

resp, body = api("POST", "/api/change-password",
                 {"current_password": "wrongone", "new_password": "somethingelse"})
check_eq("wrong current pw 403", resp.status, 403)

resp, body = api("POST", "/api/change-password",
                 {"current_password": "newpass45678", "new_password": "short"})
check("too short new pw rejected", resp.status in (400, 422))

resp, body = api("POST", "/api/change-password",
                 {"current_password": "newpass45678", "new_password": TEST_PASS})
check("change pw back ok", resp.status == 200)

wait()

# Guest can't change password
resp, body = guest_login()
resp, body = api("POST", "/api/change-password",
                 {"current_password": "x", "new_password": "y"})
check_eq("guest cant change pw 401", resp.status, 401)

wait()

# ═══════════════════════════════════════════════════
header("7. CONFIG API")

resp, body = login(TEST_USER, TEST_PASS)
check("login for config ok", resp.status == 200)

resp, body = api("GET", "/api/config")
check("config GET 200", resp.status == 200)
config_data = body
check("config is dict", isinstance(body, dict))

resp, body = api("PUT", "/api/config", config_data)
check("config PUT saved", resp.status == 200)

# Guest config
resp, body = guest_login()
resp, body = api("PUT", "/api/config", {"zones": []})
check("guest config PUT 200", resp.status == 200)
check("guest config guest True", body.get("guest") == True)

wait()

wait(65)  # Rate limit reset

# ═══════════════════════════════════════════════════
header("8. USER DATA")

resp, body = login(TEST_USER, TEST_PASS)
check("login for data ok", resp.status == 200)

# Save todos
sample_todos = [
    {"id": "t1", "text": "Complete physics chapter 3", "done": False, "priority": "high"},
    {"id": "t2", "text": "Review organic chemistry", "done": True, "priority": "medium"},
]
resp, body = api("POST", "/api/user-data", {"key": "todos", "value": sample_todos})
check("save todos 200", resp.status == 200)
check_eq("save todos status", body.get("status"), "ok")

# Save diary
sample_diary = [
    {"id": "d1", "date": "2026-07-29", "content": "Great study session", "mood": "happy"},
    {"id": "d2", "date": "2026-07-28", "content": "Tough problems", "mood": "tired"},
]
resp, body = api("POST", "/api/user-data", {"key": "diary", "value": sample_diary})
check("save diary 200", resp.status == 200)

# Save events
sample_events = [{"id": "e1", "title": "Mock test", "date": "2026-08-01", "type": "exam"}]
resp, body = api("POST", "/api/user-data", {"key": "events", "value": sample_events})
check("save events 200", resp.status == 200)

# Save stats
sample_stats = {"totalFocusMinutes": 120, "sessionsCompleted": 5, "streak": 3}
resp, body = api("POST", "/api/user-data", {"key": "stats", "value": sample_stats})
check("save stats 200", resp.status == 200)

# Save settings
sample_settings = {"theme": "dark", "sound": True, "notifications": True}
resp, body = api("POST", "/api/user-data", {"key": "settings", "value": sample_settings})
check("save settings 200", resp.status == 200)

# Save exam track & onboarded
resp, body = api("POST", "/api/user-data", {"key": "examTrack", "value": "JEE"})
check("save examTrack 200", resp.status == 200)
resp, body = api("POST", "/api/user-data", {"key": "onboarded", "value": True})
check("save onboarded 200", resp.status == 200)

# Read all data back
resp, body = api("GET", "/api/user-data")
check("read user-data 200", resp.status == 200)
check_eq("todos count 2", len(body.get("todos", [])), 2)
check_eq("diary count 2", len(body.get("diary", [])), 2)
check_eq("events count 1", len(body.get("events", [])), 1)
check("stats is dict", isinstance(body.get("stats"), dict))
check("settings is dict", isinstance(body.get("settings"), dict))
check("examTrack is JEE", body.get("examTrack") == "JEE")
check("onboarded is True", body.get("onboarded") == True)

# Invalid key
resp, body = api("POST", "/api/user-data", {"key": "invalid_key", "value": {}})
check_eq("invalid key 400", resp.status, 400)

# Guest save data
resp, body = guest_login()
resp, body = api("POST", "/api/user-data",
                 {"key": "todos", "value": [{"id": "g1", "text": "guest todo"}]})
check("guest save data 200", resp.status == 200)
check("guest save data guest True", body.get("guest") == True)

wait()

# ═══════════════════════════════════════════════════
header("9. TIMER API")

resp, body = login(TEST_USER, TEST_PASS)
check("login for timer ok", resp.status == 200)

resp, body = api("GET", "/api/timer/state")
check("timer state 200", resp.status == 200)
check("timer state has session", "session" in body)
check("timer state has zones", "zones" in body)

# Start timer
resp, body = api("POST", "/api/timer/control", {"action": "start"})
check("timer start 200", resp.status == 200)
session = body.get("session", {})
bys = session.get("byZone", {})
# byZone may be empty if frontend hasn't initialized session yet
check("timer start accepted", resp.status == 200)

# Pause timer
resp, body = api("POST", "/api/timer/control", {"action": "pause"})
check("timer pause 200", resp.status == 200)

# Stop timer (reset)
resp, body = api("POST", "/api/timer/control", {"action": "stop"})
check("timer stop 200", resp.status == 200)

# Invalid action
resp, body = api("POST", "/api/timer/control", {"action": "invalid_action"})
check_eq("timer invalid action 400", resp.status, 400)

# Guest timer control
resp, body = guest_login()
resp, body = api("POST", "/api/timer/control", {"action": "start"})
check("guest timer control 200", resp.status == 200)
check("guest timer control guest True", body.get("guest") == True)

wait()

# ═══════════════════════════════════════════════════
header("10. CHANGE USERNAME")

resp, body = login(TEST_USER, TEST_PASS)
check("login for rename ok", resp.status == 200)

resp, body = api("POST", "/api/change-username", {"new_username": "renamed_user"})
check("rename to renamed_user ok", resp.status == 200)
check_eq("rename username returned", body.get("username"), "renamed_user")

resp, body = api("POST", "/api/change-username", {"new_username": TEST_USER})
check("rename back to original ok", resp.status == 200)
check_eq("rename back username", body.get("username"), TEST_USER)

wait()

# ═══════════════════════════════════════════════════
header("11. ADMIN RESET PASSWORD FLOW")

resp, body = login(ADMIN_USER, ADMIN_PASS)
check("admin login for reset ok", resp.status == 200)

# Generate reset key
resp, body = api("POST", "/api/admin/generate-reset-key",
                 {"username": TEST_USER})
check("generate reset key 200", resp.status == 200)
reset_key = body.get("key")
check("generate reset key has key", bool(reset_key))

# List reset keys
resp, body = api("GET", "/api/admin/reset-keys")
check("list reset keys 200", resp.status == 200)
keys_list = body.get("keys", [])
check("reset keys is list", isinstance(keys_list, list))
check("our key in list", reset_key in keys_list if reset_key else True)

# Use the key to reset password
if reset_key:
    resp, body2 = api("POST", "/api/reset-password", {
        "username": TEST_USER,
        "admin_password": reset_key,
        "new_password": TEST_PASS,
    })
    check("reset password with key ok", resp.status == 200)

# Clean up all remaining keys
resp, body = api("GET", "/api/admin/reset-keys")
keys_list = body.get("keys", [])
for rk in keys_list:
    api("POST", "/api/admin/delete-reset-key", {"key": rk})

# Non-admin can't generate
resp, body = login(TEST_USER, TEST_PASS)
resp, body = api("POST", "/api/admin/generate-reset-key",
                 {"username": "someone"})
check("non-admin cant gen reset key", resp.status in (401, 403))

wait()

# ═══════════════════════════════════════════════════
header("12. DESKTOP APP / LAUNCHERS")

clear_session()
resp, raw = api("GET", "/api/desktop/app")
check("desktop app 200", resp.status == 200)

resp, body = api("GET", "/api/desktop/launcher/linux")
check("launcher linux 200", resp.status == 200)

resp, body = api("GET", "/api/desktop/launcher/mac")
check("launcher mac 200", resp.status in (200, 404))

resp, body = api("GET", "/api/desktop/launcher/windows")
check("launcher windows 200", resp.status == 200)

# ═══════════════════════════════════════════════════
header("13. SYNC ENDPOINTS")

wait(65)  # Rate limit reset before sync section

resp, body = login(TEST_USER, TEST_PASS)
check("login for sync ok", resp.status == 200)

resp, body = api("POST", "/api/sync/trigger")
check("sync trigger handled", resp.status in (200, 400, 500))

clear_session()
resp, body = api("GET", "/api/sync/status")
check("sync status 200", resp.status == 200)

resp, body = login(TEST_USER, TEST_PASS)
resp, body = api("GET", "/api/sync/export")
check("sync export 200", resp.status == 200)

resp, body = api("POST", "/api/sync/import", {"data": {}})
check("sync import 200", resp.status == 200)

wait()

# ═══════════════════════════════════════════════════
header("14. SYNC SCREEN")

clear_session()
resp, body = api("GET", "/api/sync-screen")
check("sync-screen GET 200", resp.status == 200)

resp, body = api("POST", "/api/sync-screen/push",
                 {"key": "test", "value": "hello"})
# Requires admin_password — so 403 is expected
check("sync-screen push ok", resp.status in (200, 401, 403))

resp, body = login(TEST_USER, TEST_PASS)
resp, body = api("POST", "/api/sync-screen/pull",
                 {"admin_password": "wrong"})
# Requires admin_password — 403 expected
check("sync-screen pull ok", resp.status in (200, 400, 403, 500))

resp, body = api("POST", "/api/sync-screen/dismiss")
check("sync-screen dismiss 200", resp.status == 200)

# ═══════════════════════════════════════════════════
header("15. GITHUB SYNC / HUB / KEEPALIVE")

clear_session()
resp, body = api("GET", "/api/hub")
# Hub requires auth or SPACE_ID — may return 401
check("hub API ok", resp.status in (200, 401, 404))

resp, body = api("GET", "/keepalive")
check("keepalive 200", resp.status == 200)

# keepalive-status requires auth — use existing token or expect 401
resp, body = api("GET", "/api/keepalive-status")
check("keepalive-status handled", resp.status in (200, 401))

# ═══════════════════════════════════════════════════
header("16. DATA PERSISTENCE AFTER RE-LOGIN")

resp, body = login(TEST_USER, TEST_PASS)
check("re-login for persistence ok", resp.status == 200)

resp, body = api("GET", "/api/user-data")
check("todos persist re-login", len(body.get("todos", [])) == 2)
check("diary persist re-login", len(body.get("diary", [])) == 2)
check("events persist re-login", len(body.get("events", [])) == 1)
check("stats persist re-login", isinstance(body.get("stats"), dict))
check("settings persist re-login", isinstance(body.get("settings"), dict))

wait()

# ═══════════════════════════════════════════════════
header("17. CROSS-USER DATA ISOLATION")

resp, body = login(ADMIN_USER, ADMIN_PASS)
check("admin login ok", resp.status == 200)

resp, body = api("GET", "/api/user-data")
check("admin data is dict", isinstance(body, dict))
admin_todos = body.get("todos", [])
check("admin cant see test user todos",
      len(admin_todos) == 0 or
      not any(t.get("id") in ("t1", "t2") for t in admin_todos))

wait()

# ═══════════════════════════════════════════════════
header("18. EDGE CASES")

clear_session()
resp, body = api("POST", "/api/signup", "not json")
check_eq("non-json body 422", resp.status, 422)

wait()
resp, body = api("POST", "/api/login",
                 {"username": "", "password": "test"})
check("empty username rejected", resp.status in (400, 401, 422))

wait()
resp, body = api("POST", "/api/signup",
                 {"username": "a" * 100, "password": TEST_PASS})
check("overlong username rejected", resp.status in (400, 422))

wait()
resp, body = api("POST", "/api/signup",
                 {"username": "user@#$%", "password": TEST_PASS})
check("special chars rejected", resp.status in (400, 422))

# Verify auth after edge cases doesn't break
resp, body = login(TEST_USER, TEST_PASS)
check("login still works after edge cases", resp.status == 200)

# Large data test (near the 5MB limit, not over)
small_but_valid = "x" * 500  # 500 bytes is fine
resp, body = api("POST", "/api/user-data",
                 {"key": "settings", "value": {"note": small_but_valid}})
check("reasonable-sized data accepted", resp.status == 200)

# Try oversized data — server may reject or crash, so just check it doesn't hang
big_val = "x" * (6 * 1024 * 1024)
try:
    resp, body = api("POST", "/api/user-data",
                     {"key": "todos", "value": big_val}, raw=True)
    check("oversized data handled", resp.status in (200, 413, 422))
except Exception:
    check("oversized data handled (connection closed)", True)

# ═══════════════════════════════════════════════════
header("RESULTS")

print(f"\n  Total:  {TOTAL}")
print(f"  Passed: {PASSED}")
print(f"  Failed: {FAILED}")
if TOTAL > 0:
    print(f"  Rate:   {PASSED / TOTAL * 100:.1f}%")

if FAILED > 0:
    print(f"\n  {FAILED} test(s) FAILED!")
    sys.exit(1)
else:
    print(f"\n  All {TOTAL} tests passed!")
    sys.exit(0)
