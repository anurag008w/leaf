#!/bin/sh
set -e

# Resolve data directory (default: ./data relative to project root)
DATA_DIR="${ZONE_DATA_DIR:-data}"
mkdir -p "$DATA_DIR"

# Pre-flight checks
if [ -z "$ZONE_PASSWORD" ] && [ "$(ls -A "$DATA_DIR/users" 2>/dev/null | wc -l)" -eq 0 ]; then
  echo "WARNING: ZONE_PASSWORD is not set and no users exist. Signup will be the only way to log in."
fi

echo "DATA_DIR=$DATA_DIR"

# ── GitHub Data Sync Prompt ────────────────────────
# Only show in interactive terminals (not Docker/non-TTY)
if [ -t 0 ] && [ -t 1 ]; then
  python3 -c "
import subprocess, sys, os

def run(cmd):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return r.returncode == 0, r.stdout.strip()
    except:
        return False, ''

# Check gh CLI
gh_ok, _ = run(['gh', '--version'])
if not gh_ok:
    sys.exit(0)

# Check auth
auth_ok, auth_out = run(['gh', 'auth', 'status'])
if not auth_ok:
    sys.exit(0)

# Extract username
username = ''
for line in auth_out.splitlines():
    if 'account' in line.lower():
        parts = line.split()
        for i, p in enumerate(parts):
            if p == 'account' and i + 1 < len(parts):
                username = parts[i + 1].strip().rstrip('(')
                break

if not username:
    sys.exit(0)

repo_name = os.environ.get('GITHUB_REPO', 'zone-data-backup')
data_dir = os.environ.get('ZONE_DATA_DIR', 'data')

# Check if repo exists
repo_ok, _ = run(['gh', 'repo', 'view', f'{username}/{repo_name}', '--json', 'name'])
repo_exists = repo_ok

# Check if local data has content
has_local = False
if os.path.exists(data_dir):
    items = [f for f in os.listdir(data_dir) if not f.startswith('.')]
    has_local = len(items) > 0

print()
print('=' * 50)
print('  🔗 GitHub Data Sync')
print('=' * 50)
print(f'  Account:  {username}')
print(f'  Repo:     {username}/{repo_name}')
print(f'  Repo:     {\"✅ exists\" if repo_exists else \"❌ not found\"}')
print(f'  Local:    {\"✅ has data\" if has_local else \"📁 empty\"}')
print('=' * 50)

if not repo_exists and not has_local:
    print('  Nothing to sync yet. Start the server and use the')
    print('  app to create data, then push it to GitHub.')
    print()
    sys.exit(0)

# Prompt user
if repo_exists and not has_local:
    print('  Remote has data, local is empty.')
    print()
    print('  [1] Pull from GitHub → Local')
    print('  [2] Skip')
    print()
    choice = input('  Choose (1/2): ').strip()
    if choice == '1':
        print()
        print('  ⬇️  Pulling from GitHub...')
        r = subprocess.run(['python3', '-c', '''
from app.github_sync import pull_data
result = pull_data()
print(f\"  {'✅' if result.success else '❌'} {result.message}\")
'''], capture_output=False, text=True)
elif choice == '2':
    print('  Skipping sync.')
elif repo_exists and has_local:
    print('  Both local and remote have data.')
    print()
    print('  [1] Push Local → GitHub')
    print('  [2] Pull GitHub → Local')
    print('  [3] Skip')
    print()
    choice = input('  Choose (1/2/3): ').strip()
    if choice == '1':
        print()
        print('  ⬆️  Pushing to GitHub...')
        r = subprocess.run(['python3', '-c', '''
from app.github_sync import push_data
result = push_data()
print(f\"  {'✅' if result.success else '❌'} {result.message}\")
'''], capture_output=False, text=True)
    elif choice == '2':
        print()
        print('  ⬇️  Pulling from GitHub...')
        r = subprocess.run(['python3', '-c', '''
from app.github_sync import pull_data
result = pull_data()
print(f\"  {'✅' if result.success else '❌'} {result.message}\")
'''], capture_output=False, text=True)
    else:
        print('  Skipping sync.')
elif not repo_exists and has_local:
    print('  Local has data, no remote repo yet.')
    print()
    print('  [1] Create repo & Push Local → GitHub')
    print('  [2] Skip')
    print()
    choice = input('  Choose (1/2): ').strip()
    if choice == '1':
        print()
        print('  ⬆️  Creating repo & pushing...')
        r = subprocess.run(['python3', '-c', '''
from app.github_sync import push_data
result = push_data()
print(f\"  {'✅' if result.success else '❌'} {result.message}\")
'''], capture_output=False, text=True)
    else:
        print('  Skipping sync.')
print()
" 2>/dev/null || true
fi

python cronjob-keepalive-setup.py || echo "keepalive setup failed, continuing startup anyway"

# NOTE: Wildcard is required for HF Spaces (all traffic proxied through HF infra
# with dynamic IPs). For self-hosted deployments, override with a specific proxy IP:
#   FORWARDED_ALLOW_IPS=127.0.0.1 entrypoint.sh
# This avoids trusting X-Forwarded-For from arbitrary peers, which bypasses
# IP-based rate limiting.
exec uvicorn app.main:app --host 0.0.0.0 --port 7860 --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}"
