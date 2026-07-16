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

REPO_NAME = os.environ.get("GITHUB_REPO", "").strip() or "zone-data-backup"
GITHUB_SYNC_ENABLED = os.environ.get("GITHUB_SYNC_ENABLED", "").strip().lower()

try:
    GITHUB_SYNC_INTERVAL = max(60, int(os.environ.get("GITHUB_SYNC_INTERVAL", "300") or "300"))
except (ValueError, TypeError):
    GITHUB_SYNC_INTERVAL = 300  # 5 minutes


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


def _run(cmd: list[str], check: bool = False, capture: bool = True, timeout: int = 30) -> subprocess.CompletedProcess:
    """Run a command safely with timeout."""
    try:
        result = subprocess.run(
            cmd, capture_output=capture, text=True, timeout=timeout
        )
        if check and result.returncode != 0:
            raise RuntimeError(f"Command failed: {' '.join(cmd)}\n{result.stderr}")
        return result
    except FileNotFoundError:
        return subprocess.CompletedProcess(cmd, returncode=127, stdout="", stderr="command not found")
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(cmd, returncode=-1, stdout="", stderr="timeout")


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


def _git_init_and_push(data_path: Path, repo_url: str, username: str) -> None:
    """Initialize git in data dir, commit, and push."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)

        # Copy data to temp dir
        for item in data_path.iterdir():
            if item.name.startswith("."):
                continue
            dst = tmp_path / item.name
            if item.is_dir():
                shutil.copytree(item, dst)
            else:
                shutil.copy2(item, dst)

        # Init git repo
        _run(["git", "init"], cwd=str(tmp_path), check=True)
        _run(["git", "config", "user.email", f"{username}@zone-study-os"], cwd=str(tmp_path), check=True)
        _run(["git", "config", "user.name", "Zone Data Backup"], cwd=str(tmp_path), check=True)

        # Add remote
        _run(["git", "remote", "add", "origin", repo_url], cwd=str(tmp_path), check=True)

        # Check if remote has content
        r = _run(["git", "ls-remote", "--exit-code", "origin", "HEAD"], cwd=str(tmp_path))
        remote_has_content = r.returncode == 0

        if remote_has_content:
            # Pull first to get remote content
            _run(["git", "fetch", "origin"], cwd=str(tmp_path), check=True)
            _run(["git", "checkout", "-b", "main"], cwd=str(tmp_path), check=True)
            r = _run(["git", "pull", "origin", "main", "--allow-unrelated-histories", "--no-edit"],
                      cwd=str(tmp_path))
            if r.returncode != 0:
                log.warning("pull failed, will force push: %s", r.stderr)

        # Add and commit
        _run(["git", "add", "-A"], cwd=str(tmp_path), check=True)
        commit_msg = f"zone-data sync {time.strftime('%Y-%m-%d %H:%M:%S')}"
        r = _run(["git", "commit", "-m", commit_msg], cwd=str(tmp_path))
        if r.returncode != 0:
            log.info("nothing to commit")
            return

        # Push
        _run(["git", "branch", "-M", "main"], cwd=str(tmp_path), check=True)
        r = _run(["git", "push", "-u", "origin", "main", "--force"], cwd=str(tmp_path), check=True)
        if r.returncode != 0:
            raise RuntimeError(f"Push failed: {r.stderr}")
        log.info("pushed to %s", repo_url)


def _git_pull_to(local_path: Path, repo_url: str) -> bool:
    """Clone/pull repo content into local_path."""
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

        # Remove old content (except hidden files)
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

        log.info("pulled %d items from %s", len(items), repo_url)
        return True


# ── Public API ──────────────────────────────────────
@dataclass
class SyncResult:
    success: bool
    message: str
    direction: str = ""  # "push", "pull", "create"
    repo_url: str = ""
    files_affected: int = 0


def push_data() -> SyncResult:
    """Push local data to GitHub."""
    status = detect_environment()
    if not status.gh_authenticated:
        return SyncResult(False, "gh CLI not authenticated. Run: gh auth login", direction="push")

    username = status.gh_username
    repo_url = f"https://github.com/{username}/{REPO_NAME}.git"

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
        _git_init_and_push(DATA_DIR, repo_url, username)
        file_count = sum(1 for _ in DATA_DIR.rglob("*") if _.is_file())
        return SyncResult(True, f"Pushed {file_count} files to GitHub", direction="push",
                          repo_url=repo_url, files_affected=file_count)
    except Exception as e:
        return SyncResult(False, f"Push failed: {e}", direction="push")


def pull_data() -> SyncResult:
    """Pull data from GitHub to local."""
    status = detect_environment()
    if not status.gh_authenticated:
        return SyncResult(False, "gh CLI not authenticated. Run: gh auth login", direction="pull")

    username = status.gh_username
    repo_url = f"https://github.com/{username}/{REPO_NAME}.git"

    if not status.repo_exists:
        return SyncResult(False, f"Repo {username}/{REPO_NAME} doesn't exist on GitHub", direction="pull")

    try:
        ok = _git_pull_to(DATA_DIR, repo_url)
        if ok:
            file_count = sum(1 for _ in DATA_DIR.rglob("*") if _.is_file())
            return SyncResult(True, f"Pulled data from GitHub ({file_count} files)", direction="pull",
                              repo_url=repo_url, files_affected=file_count)
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
