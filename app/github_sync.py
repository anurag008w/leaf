"""
GitHub Data Sync — push/pull zone-data to a private GitHub repo.

Uses `gh` CLI (authenticated) + git subprocess. No extra pip dependencies.
Env vars:
  GITHUB_SYNC_ENABLED  — "true" to enable (default: auto-detect)
  GITHUB_REPO          — "owner/repo" override (default: zone-data-backup)
"""

import json
import logging
import os
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger("zone.github_sync")

# ── Config ──────────────────────────────────────────
_APP_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _APP_DIR.parent
DATA_DIR = Path(os.environ.get("ZONE_DATA_DIR", str(_PROJECT_ROOT / "data")))

# ── Fingerprint cache for smart auto-push ──────────
_last_push_fingerprint: str = ""

REPO_NAME = os.environ.get("GITHUB_REPO", "").strip() or "zone-data-backup"
GITHUB_SYNC_ENABLED = os.environ.get("GITHUB_SYNC_ENABLED", "").strip().lower()
GH_TOKEN = os.environ.get("GH_TOKEN", "").strip()

try:
    GITHUB_SYNC_INTERVAL = max(30, int(os.environ.get("GITHUB_SYNC_INTERVAL", "40") or "40"))
except (ValueError, TypeError):
    GITHUB_SYNC_INTERVAL = 40  # 40 seconds


# ── Environment Detection ──────────────────────────
@dataclass
class EnvStatus:
    git_available: bool = False
    git_version: str = ""
    gh_available: bool = False
    gh_version: str = ""
    gh_authenticated: bool = False
    gh_username: str = ""
    repo_exists: bool = False
    repo_url: str = ""
    data_dir_exists: bool = False
    data_dir_path: str = ""


def _run(cmd: list[str], check: bool = False, capture: bool = True, timeout: int = 30, cwd: str | None = None) -> subprocess.CompletedProcess:
    """Run a command safely with timeout."""
    try:
        result = subprocess.run(
            cmd, capture_output=capture, text=True, timeout=timeout, cwd=cwd
        )
        if check and result.returncode != 0:
            raise RuntimeError(f"Command failed: {' '.join(cmd)}\n{result.stderr}")
        return result
    except FileNotFoundError:
        return subprocess.CompletedProcess(cmd, returncode=127, stdout="", stderr="command not found")
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(cmd, returncode=-1, stdout="", stderr="timeout")


def compute_fingerprint() -> str:
    """Compute a fingerprint of the data dir contents (file names + mtimes + sizes)."""
    import hashlib
    h = hashlib.md5()
    if not DATA_DIR.exists():
        return ""
    for f in sorted(DATA_DIR.rglob("*")):
        if f.is_file():
            rel = str(f.relative_to(DATA_DIR))
            h.update(rel.encode())
            try:
                stat = f.stat()
                h.update(str(stat.st_mtime_ns).encode())
                h.update(str(stat.st_size).encode())
            except OSError:
                pass
    return h.hexdigest()


def has_data_changed() -> bool:
    """Check if data dir has changed since last push. Returns True if changed."""
    global _last_push_fingerprint
    fp = compute_fingerprint()
    if fp == _last_push_fingerprint:
        return False
    return True


def mark_pushed():
    """Mark current fingerprint as pushed (called after successful push)."""
    global _last_push_fingerprint
    _last_push_fingerprint = compute_fingerprint()


def detect_environment() -> EnvStatus:
    """Detect what's available in the environment."""
    status = EnvStatus()

    # Check git
    r = _run(["git", "--version"])
    if r.returncode == 0:
        status.git_available = True
        status.git_version = r.stdout.strip()

    # Check gh CLI
    r = _run(["gh", "--version"])
    if r.returncode == 0:
        status.gh_available = True
        status.gh_version = r.stdout.split("\n")[0].strip()

    # Check gh auth
    if status.gh_available:
        r = _run(["gh", "auth", "status"])
        if r.returncode == 0:
            status.gh_authenticated = True
            # Extract username from output
            for line in (r.stdout + r.stderr).splitlines():
                if "account" in line.lower():
                    # Format: "  ✓ Logged in to github.com account anurag008w (keyring)"
                    parts = line.split()
                    for i, p in enumerate(parts):
                        if p == "account" and i + 1 < len(parts):
                            status.gh_username = parts[i + 1].strip().rstrip("(")
                            break

        # Fallback: if GH_TOKEN is set, use it even if `gh auth status` fails
        if not status.gh_authenticated and GH_TOKEN:
            status.gh_authenticated = True
            # Get username from GitHub API
            import urllib.request, urllib.error
            try:
                req = urllib.request.Request("https://api.github.com/user", headers={
                    "Authorization": f"token {GH_TOKEN}",
                    "Accept": "application/vnd.github+json"
                })
                with urllib.request.urlopen(req, timeout=10) as resp:
                    data = json.loads(resp.read())
                    status.gh_username = data.get("login", "")
            except Exception as e:
                log.warning("GH_TOKEN set but failed to get username: %s", e)
                status.gh_authenticated = False

    # Check if repo exists
    if status.gh_authenticated:
        r = _run(["gh", "repo", "view", f"{status.gh_username}/{REPO_NAME}", "--json", "name,url"])
        if r.returncode == 0:
            try:
                info = json.loads(r.stdout)
                status.repo_exists = True
                status.repo_url = info.get("url", f"https://github.com/{status.gh_username}/{REPO_NAME}")
            except json.JSONDecodeError:
                pass

    # Check data dir
    status.data_dir_exists = DATA_DIR.exists() and any(DATA_DIR.iterdir()) if DATA_DIR.exists() else False
    status.data_dir_path = str(DATA_DIR)

    return status


def is_available() -> bool:
    """Quick check: is GitHub sync usable?"""
    s = detect_environment()
    return s.git_available and s.gh_available and s.gh_authenticated


# ── Repo Management ────────────────────────────────
def create_repo(username: str) -> str:
    """Create a private GitHub repo for data backup."""
    full_name = f"{username}/{REPO_NAME}"
    log.info("creating private repo: %s", full_name)

    r = _run([
        "gh", "repo", "create", REPO_NAME,
        "--private",
        "--description", "Zone Study OS — encrypted data backup",
    ], check=True)
    if r.returncode != 0:
        raise RuntimeError(f"Failed to create repo: {r.stderr}")

    log.info("repo created: https://github.com/%s", full_name)
    return f"https://github.com/{full_name}.git"


def _git_init_and_push(data_path: Path, repo_url: str, username: str, force_mode: str = "normal") -> None:
    """Initialize git in data dir, commit, and push.

    force_mode:
      "normal"           — git push (fails if remote has diverged)
      "force"            — git push --force (overwrites remote)
      "force-with-lease" — git push --force-with-lease (safer: fails if remote has unseen changes)
    """
    push_flag = ""
    if force_mode == "force":
        push_flag = "--force"
    elif force_mode == "force-with-lease":
        push_flag = "--force-with-lease"

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)

        # Init git repo
        _run(["git", "init"], cwd=str(tmp_path), check=True)
        _run(["git", "config", "user.email", f"{username}@zone-study-os"], cwd=str(tmp_path), check=True)
        _run(["git", "config", "user.name", "Zone Data Backup"], cwd=str(tmp_path), check=True)
        _run(["git", "remote", "add", "origin", repo_url], cwd=str(tmp_path), check=True)

        # Check if remote has content
        r = _run(["git", "ls-remote", "--exit-code", "origin", "HEAD"], cwd=str(tmp_path))
        remote_has_content = r.returncode == 0

        if remote_has_content and force_mode == "normal":
            # Normal push: fetch remote, checkout its branch, then overlay local data
            _run(["git", "fetch", "origin"], cwd=str(tmp_path), check=True)
            _run(["git", "checkout", "-b", "main"], cwd=str(tmp_path), check=True)
            r = _run(["git", "pull", "origin", "main", "--allow-unrelated-histories", "--no-edit"],
                      cwd=str(tmp_path))
            if r.returncode != 0:
                # Pull failed — try checkout remote then overlay
                _run(["git", "checkout", "main"], cwd=str(tmp_path), check=True)
                r2 = _run(["git", "reset", "--hard", "origin/main"], cwd=str(tmp_path))
                if r2.returncode != 0:
                    log.warning("could not reset to remote, falling back to force: %s", r.stderr)
                    push_flag = "--force"
        elif remote_has_content:
            # Force mode: fetch to update refs
            _run(["git", "fetch", "origin"], cwd=str(tmp_path), check=True)
            _run(["git", "checkout", "-b", "main"], cwd=str(tmp_path), check=True)

        # NOW: copy local data ON TOP of whatever is in tmp_path
        # Remove everything except .git
        for item in tmp_path.iterdir():
            if item.name == ".git":
                continue
            if item.is_dir():
                shutil.rmtree(item)
            else:
                item.unlink()

        # Copy fresh local data
        for item in data_path.iterdir():
            if item.name.startswith("."):
                continue
            dst = tmp_path / item.name
            if item.is_dir():
                shutil.copytree(item, dst)
            else:
                shutil.copy2(item, dst)

        # Add and commit
        _run(["git", "add", "-A"], cwd=str(tmp_path), check=True)
        commit_msg = f"zone-data sync {time.strftime('%Y-%m-%d %H:%M:%S')}"
        r = _run(["git", "commit", "-m", commit_msg], cwd=str(tmp_path))
        if r.returncode != 0:
            log.info("nothing to commit")
            return

        # Push with selected mode
        _run(["git", "branch", "-M", "main"], cwd=str(tmp_path), check=True)
        push_cmd = ["git", "push", "-u", "origin", "main"]
        if push_flag:
            push_cmd.append(push_flag)
        r = _run(push_cmd, cwd=str(tmp_path))

        # Auto-retry: if normal push rejected (diverged), fall back to force-with-lease
        if r.returncode != 0 and force_mode == "normal":
            stderr = r.stderr or ""
            rejected_keywords = ["rejected", "diverged", "failed to push", "non-fast-forward", "updates were rejected"]
            if any(kw in stderr.lower() for kw in rejected_keywords):
                log.warning("normal push rejected, auto-retrying with force-with-lease: %s", stderr.strip())
                fallback_cmd = ["git", "push", "-u", "origin", "main", "--force-with-lease"]
                r = _run(fallback_cmd, cwd=str(tmp_path))
                if r.returncode != 0:
                    raise RuntimeError(f"Force-with-lease retry also failed: {r.stderr}")
                log.info("pushed (force-with-lease fallback) to %s", repo_url)
                return

        if r.returncode != 0:
            raise RuntimeError(f"Push failed ({force_mode}): {r.stderr}")
        log.info("pushed (%s) to %s", force_mode, repo_url)


def _git_pull_to(local_path: Path, repo_url: str, force_mode: str = "normal") -> bool:
    """Clone/pull repo content into local_path.

    force_mode:
      "normal"           — clone remote, replace local non-hidden files
      "force"            — nuke ALL local data (including hidden), then clone fresh
      "force-with-lease" — clone remote, replace local, but verify remote is newer first
    """
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)

        # Clone repo
        r = _run(["git", "clone", "--depth", "1", repo_url, str(tmp_path / "repo")], timeout=60)
        if r.returncode != 0:
            log.error("clone failed: %s", r.stderr)
            return False

        repo_dir = tmp_path / "repo"
        if not repo_dir.exists():
            return False

        # Check if repo is empty
        items = [f for f in repo_dir.iterdir() if f.name not in (".git", ".gitignore")]
        if not items:
            log.info("remote repo is empty")
            return True

        # Copy to local data dir
        local_path.mkdir(parents=True, exist_ok=True)

        if force_mode == "force":
            # Nuke EVERYTHING including hidden files (except data dir itself)
            log.info("force pull: deleting all local data first")
            for item in local_path.iterdir():
                if item.is_dir():
                    shutil.rmtree(item)
                else:
                    item.unlink()
        else:
            # Normal: remove old content (except hidden files)
            for item in local_path.iterdir():
                if item.name.startswith("."):
                    continue
                if item.is_dir():
                    shutil.rmtree(item)
                else:
                    item.unlink()

        # Copy new content
        for item in repo_dir.iterdir():
            if item.name.startswith("."):
                continue
            dst = local_path / item.name
            if item.is_dir():
                shutil.copytree(item, dst)
            else:
                shutil.copy2(item, dst)

        log.info("pulled %d items from %s (mode: %s)", len(items), repo_url, force_mode)
        return True


# ── Public API ──────────────────────────────────────
@dataclass
class SyncResult:
    success: bool
    message: str
    direction: str = ""  # "push", "pull", "create"
    repo_url: str = ""
    files_affected: int = 0


def _auth_url(username: str) -> str:
    """Build git remote URL with GH_TOKEN if available."""
    if GH_TOKEN:
        return f"https://{GH_TOKEN}@github.com/{username}/{REPO_NAME}.git"
    return f"https://github.com/{username}/{REPO_NAME}.git"


def push_data(force_mode: str = "normal") -> SyncResult:
    """Push local data to GitHub.

    force_mode: "normal", "force", "force-with-lease"
    """
    status = detect_environment()
    if not status.gh_authenticated:
        return SyncResult(False, "gh CLI not authenticated. Run: gh auth login", direction="push")

    username = status.gh_username
    repo_url = _auth_url(username)

    # Create repo if it doesn't exist
    if not status.repo_exists:
        try:
            create_repo(username)
            status.repo_exists = True
        except Exception as e:
            return SyncResult(False, f"Failed to create repo: {e}", direction="create")

    if not DATA_DIR.exists() or not any(DATA_DIR.iterdir()):
        return SyncResult(False, "Data directory is empty, nothing to push", direction="push")

    try:
        _git_init_and_push(DATA_DIR, repo_url, username, force_mode=force_mode)
        file_count = sum(1 for _ in DATA_DIR.rglob("*") if _.is_file())
        mode_label = f" ({force_mode})" if force_mode != "normal" else ""
        return SyncResult(True, f"Pushed{mode_label} {file_count} files to GitHub", direction="push",
                          repo_url=f"https://github.com/{username}/{REPO_NAME}", files_affected=file_count)
    except Exception as e:
        return SyncResult(False, f"Push failed: {e}", direction="push")


def pull_data(force_mode: str = "normal") -> SyncResult:
    """Pull data from GitHub to local.

    force_mode: "normal", "force", "force-with-lease"
    """
    status = detect_environment()
    if not status.gh_authenticated:
        return SyncResult(False, "gh CLI not authenticated. Run: gh auth login", direction="pull")

    username = status.gh_username
    repo_url = _auth_url(username)

    if not status.repo_exists:
        return SyncResult(False, f"Repo {username}/{REPO_NAME} doesn't exist on GitHub", direction="pull")

    try:
        ok = _git_pull_to(DATA_DIR, repo_url, force_mode=force_mode)
        if ok:
            file_count = sum(1 for _ in DATA_DIR.rglob("*") if _.is_file())
            mode_label = f" ({force_mode})" if force_mode != "normal" else ""
            return SyncResult(True, f"Pulled{mode_label} data from GitHub ({file_count} files)", direction="pull",
                              repo_url=f"https://github.com/{username}/{REPO_NAME}", files_affected=file_count)
        else:
            return SyncResult(False, "Failed to pull from GitHub", direction="pull")
    except Exception as e:
        return SyncResult(False, f"Pull failed: {e}", direction="pull")


def sync_status() -> dict:
    """Get current sync status."""
    status = detect_environment()
    return {
        "git_available": status.git_available,
        "git_version": status.git_version,
        "gh_available": status.gh_available,
        "gh_version": status.gh_version,
        "gh_authenticated": status.gh_authenticated,
        "gh_username": status.gh_username,
        "repo_exists": status.repo_exists,
        "repo_url": status.repo_url or f"https://github.com/{status.gh_username}/{REPO_NAME}" if status.gh_username else "",
        "repo_name": REPO_NAME,
        "data_dir": status.data_dir_path,
        "data_dir_has_content": status.data_dir_exists,
        "sync_enabled": GITHUB_SYNC_ENABLED != "false",
        "sync_interval": GITHUB_SYNC_INTERVAL,
    }
