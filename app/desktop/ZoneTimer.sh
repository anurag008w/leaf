#!/bin/bash
# ╔══════════════════════════════════════════╗
# ║   ZONE TIMER — Desktop Floating Timer   ║
# ╚══════════════════════════════════════════╝
#
# HOW TO RUN:
#   1. Open a terminal in this folder
#   2. Run:  bash ZoneTimer.sh
#
# (Double-click won't work on most Linux desktops —
#  .sh files open in text editor by default)

cd "$(dirname "$0")"

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   ZONE TIMER — Desktop Floating Timer   ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# ── Check Python ──
if ! command -v python3 &> /dev/null; then
    echo "  [!] Python3 not found."
    echo "  [!] Install: sudo apt install python3 python3-pip  (Debian/Ubuntu)"
    echo "  [!] Or: brew install python3  (macOS)"
    exit 1
fi
echo "  [+] Found $(python3 --version 2>&1)"

# ── Install dependencies (auto, first time only) ──
echo "  [*] Checking dependencies..."
python3 -c "import customtkinter" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "  [*] First run — installing customtkinter (one-time)..."
    python3 -m pip install --quiet --upgrade customtkinter 2>/dev/null
    if [ $? -ne 0 ]; then
        echo "  [!] Install failed. Try: pip3 install customtkinter"
        exit 1
    fi
    echo "  [+] Dependencies installed!"
else
    echo "  [+] All dependencies ready."
fi

# ── Get server URL (saved or prompt) ──
SERVER_URL=""
if [ -f "server.txt" ]; then
    SERVER_URL=$(cat server.txt | tr -d '[:space:]')
fi
if [ -z "$SERVER_URL" ]; then
    echo ""
    echo "  Enter your Zone OS server URL (e.g. https://yoursite.com)"
    read -rp "  URL: " SERVER_URL
    if [ -z "$SERVER_URL" ]; then
        echo "  [!] No URL entered. Exiting."
        exit 1
    fi
    echo "$SERVER_URL" > server.txt
    echo "  [+] Saved to server.txt"
fi

# ── Download timer.py if missing ──
if [ ! -f "timer.py" ]; then
    echo "  [*] Downloading timer app from $SERVER_URL..."
    python3 -c "import urllib.request; urllib.request.urlretrieve('$SERVER_URL/api/desktop/app', 'timer.py')"
    if [ $? -ne 0 ]; then
        echo "  [!] Download failed. Check URL and internet."
        echo "  [!] Delete server.txt and try again."
        exit 1
    fi
    chmod +x timer.py
    echo "  [+] Downloaded!"
fi

# ── Launch ──
echo ""
echo "  Starting Zone Timer..."
echo ""
python3 timer.py
