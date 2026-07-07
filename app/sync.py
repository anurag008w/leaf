import hashlib
import json
import logging
import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import TypeAlias

os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("HF_HUB_VERBOSITY", "error")

from huggingface_hub import CommitOperationDelete, HfApi, snapshot_download, upload_folder
from huggingface_hub.errors import HfHubHTTPError, RepositoryNotFoundError

logging.getLogger("huggingface_hub").setLevel(logging.ERROR)
log = logging.getLogger("zone.sync")

HF_TOKEN = os.environ.get("HF_TOKEN", "").strip()
HF_USERNAME = os.environ.get("HF_USERNAME", "").strip()
SYNC_DATASET = os.environ.get("SYNC_DATASET", "").strip() or "myos-backup"
SYNC_INTERVAL = int(os.environ.get("SYNC_INTERVAL", "1800"))
SYNC_UPLOAD_TIMEOUT = int(os.environ.get("SYNC_UPLOAD_TIMEOUT", "120"))
SYNC_MAX_FILE_BYTES = int(os.environ.get("SYNC_MAX_FILE_BYTES", str(50 * 1024 * 1024)))

DATA_DIR = Path(os.environ.get("ZONE_DATA_DIR", str(Path(__file__).parent.parent / "data")))
PRUNE_BATCH_SIZE = 50

FileMarker: TypeAlias = tuple[int, int, int, int, str]
WorkspaceMarker: TypeAlias = tuple[int, int, int, str]

HF_API: HfApi | None = HfApi(token=HF_TOKEN) if HF_TOKEN else None
_REPO_ID_CACHE: str | None = None
_prune_needed: bool = False


HF_SYNC_MARKER = DATA_DIR / ".hf-synced"

def resolve_namespace() -> str:
    global _REPO_ID_CACHE
    if _REPO_ID_CACHE:
        return _REPO_ID_CACHE
    namespace = HF_USERNAME
    if not namespace and HF_API is not None:
        try:
            whoami = HF_API.whoami()
            namespace = whoami.get("name") or whoami.get("user") or ""
        except Exception as exc:
            raise RuntimeError(f"could not resolve HF username from token: {exc}")
    namespace = str(namespace).strip()
    if not namespace:
        raise RuntimeError("HF_USERNAME not set and could not resolve from token")
    _REPO_ID_CACHE = f"{namespace}/{SYNC_DATASET}"
    return _REPO_ID_CACHE


def ensure_repo() -> str:
    repo_id = resolve_namespace()
    try:
        HF_API.repo_info(repo_id=repo_id, repo_type="dataset")
    except RepositoryNotFoundError:
        try:
            HF_API.create_repo(repo_id=repo_id, repo_type="dataset", private=True)
            log.info("created HF dataset: %s", repo_id)
        except Exception as exc:
            raise RuntimeError(f"cannot create HF dataset {repo_id}: {exc}")
    return repo_id


def _sync_files(root: Path):
    if not root.exists():
        return
    for path in root.rglob("*"):
        if path.is_file(follow_symlinks=False):
            yield path


def fingerprint(root: Path) -> str:
    hasher = hashlib.sha256()
    if not root.exists():
        return hasher.hexdigest()
    for path in sorted(_sync_files(root)):
        rel = path.relative_to(root).as_posix()
        hasher.update(rel.encode())
        try:
            stat = path.stat()
            if stat.st_size > SYNC_MAX_FILE_BYTES:
                hasher.update(b"[large]\0")
                hasher.update(str(stat.st_size).encode())
                hasher.update(b"\0")
                hasher.update(str(stat.st_mtime_ns).encode())
                continue
            with path.open("rb") as f:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    hasher.update(chunk)
        except (FileNotFoundError, OSError):
            raise RuntimeError(f"File changed while hashing: {rel}")
    return hasher.hexdigest()


def metadata_marker(root: Path) -> WorkspaceMarker:
    if not root.exists():
        return (0, 0, 0, "")
    file_count = 0
    total_size = 0
    newest_mtime = 0
    hasher = hashlib.sha256()
    for path in sorted(_sync_files(root)):
        rel = path.relative_to(root).as_posix()
        try:
            stat = path.stat()
        except OSError:
            continue
        file_count += 1
        sz = int(stat.st_size)
        mt = int(stat.st_mtime_ns)
        total_size += sz
        newest_mtime = max(newest_mtime, mt)
        hasher.update(rel.encode())
        hasher.update(b"\0")
        hasher.update(str(sz).encode())
        hasher.update(b"\0")
        hasher.update(str(mt).encode())
        hasher.update(b"\0")
    return (file_count, total_size, newest_mtime, hasher.hexdigest())


def create_snapshot(source: Path) -> Path:
    dst = Path(tempfile.mkdtemp(prefix="myos-sync-"))
    for path in _sync_files(source):
        rel = path.relative_to(source)
        target = dst / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copy2(path, target)
        except (FileNotFoundError, OSError):
            raise RuntimeError(f"File changed while snapshotting: {rel}")
    return dst


def upload(repo_id: str, snapshot_dir: Path):
    upload_folder(
        folder_path=str(snapshot_dir),
        repo_id=repo_id,
        repo_type="dataset",
        token=HF_TOKEN,
        commit_message=f"myos sync {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}",
    )


def prune_remote(repo_id: str, snapshot_dir: Path):
    if HF_API is None:
        return
    local = {
        path.relative_to(snapshot_dir).as_posix()
        for path in snapshot_dir.rglob("*")
        if path.is_file()
    }
    remote = list(HF_API.list_repo_files(repo_id=repo_id, repo_type="dataset"))
    stale = [p for p in remote if p not in local and p != ".gitattributes"]
    if not stale:
        return
    for i in range(0, len(stale), PRUNE_BATCH_SIZE):
        batch = stale[i : i + PRUNE_BATCH_SIZE]
        ops = [CommitOperationDelete(path_in_repo=p) for p in batch]
        HF_API.create_commit(
            repo_id=repo_id,
            repo_type="dataset",
            operations=ops,
            commit_message=f"prune {len(batch)} stale file(s)",
        )
    log.info("pruned %d stale file(s) from remote", len(stale))


def sync_once(last_fp: str | None = None, last_mm: WorkspaceMarker | None = None) -> tuple[str, WorkspaceMarker]:
    global _prune_needed
    if not HF_TOKEN or HF_API is None:
        return (last_fp or "", last_mm or (0, 0, 0, ""))
    repo_id = ensure_repo()
    current_mm = metadata_marker(DATA_DIR)
    if last_mm is not None and current_mm == last_mm and not _prune_needed:
        return (last_fp or "", current_mm)
    current_fp = fingerprint(DATA_DIR)
    if last_fp is not None and current_fp == last_fp and not _prune_needed:
        return (last_fp, current_mm)
    log.info("uploading to %s …", repo_id)
    snap = create_snapshot(DATA_DIR)
    try:
        upload(repo_id, snap)
        try:
            prune_remote(repo_id, snap)
            _prune_needed = False
        except Exception as exc:
            log.warning("prune failed: %s", exc)
            _prune_needed = True
    finally:
        shutil.rmtree(snap, ignore_errors=True)
    return (current_fp, current_mm)


def restore():
    if not HF_TOKEN or HF_API is None:
        return False
    repo_id = resolve_namespace()
    log.info("restoring from %s …", repo_id)
    try:
        with tempfile.TemporaryDirectory() as tmp:
            snapshot_download(
                repo_id=repo_id,
                repo_type="dataset",
                token=HF_TOKEN,
                local_dir=tmp,
            )
            tmp_path = Path(tmp)
            if not any(f for f in tmp_path.iterdir() if f.name != ".gitattributes"):
                log.info("backup dataset is empty")
                return True
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            for child in tmp_path.iterdir():
                if child.name == ".gitattributes":
                    continue
                dst = DATA_DIR / child.name
                if child.is_dir():
                    if dst.exists():
                        shutil.rmtree(dst, ignore_errors=True)
                    shutil.copytree(child, dst)
                else:
                    shutil.copy2(child, dst)
        HF_SYNC_MARKER.write_text(json.dumps({"restored_at": time.time()}))
        log.info("restore complete")
        return True
    except RepositoryNotFoundError:
        log.info("backup dataset does not exist yet")
        return True
    except HfHubHTTPError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            log.info("backup dataset does not exist yet")
            return True
        log.error("restore failed: %s", exc)
        return False
    except Exception as exc:
        log.error("restore failed: %s", exc)
        return False
