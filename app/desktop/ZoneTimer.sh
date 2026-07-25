#!/bin/bash
# ╔══════════════════════════════════════════╗
# ║   ZONE TIMER — Desktop Floating Timer   ║
# ╚══════════════════════════════════════════╝
#
# HOW TO RUN:
#   1. Open a terminal in this folder
#   2. Run:  bash ZoneTimer.sh
#
# After first run, a "Zone Timer" shortcut will appear on your Desktop.
# Double-click it anytime to launch!

cd "$(dirname "$0")"
APP_DIR="$(pwd)"

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
    echo "  [*] (First download may take up to 60s if server is sleeping)"
    # Use curl with timeout — faster and shows progress
    if command -v curl &> /dev/null; then
        curl -sL --connect-timeout 30 --max-time 120 -o timer.py "$SERVER_URL/api/desktop/app"
    else
        python3 -c "
import urllib.request, socket
socket.setdefaulttimeout(60)
urllib.request.urlretrieve('$SERVER_URL/api/desktop/app', 'timer.py')
"
    fi
    if [ ! -s "timer.py" ]; then
        echo "  [!] Download failed. Check URL and internet."
        echo "  [!] Delete server.txt and try again."
        rm -f timer.py
        exit 1
    fi
    chmod +x timer.py
    echo "  [+] Downloaded!"
fi

# ── Install .desktop shortcut (double-click launcher) ──
DESKTOP_FILE="$HOME/Desktop/ZoneTimer.desktop"
if [ ! -f "$DESKTOP_FILE" ]; then
    echo "  [*] Installing desktop shortcut..."
    cat > "$DESKTOP_FILE" << DESKTOP
[Desktop Entry]
Name=Zone Timer
Comment=Floating desktop timer for Zone Study OS
Exec=bash -c 'cd "$APP_DIR" && ([ -f timer.py ] && python3 timer.py 2>/dev/null || x-terminal-emulator -e bash ZoneTimer.sh)'
Icon=preferences-system-time
Terminal=false
Type=Application
Categories=Utility;Education;
StartupNotify=false
Keywords=timer;focus;study;zone;
DESKTOP
    chmod +x "$DESKTOP_FILE"
    # Also try to add to app menu (non-critical, ignore errors)
    APP_DIR_PATH="$HOME/.local/share/applications"
    mkdir -p "$APP_DIR_PATH" 2>/dev/null
    cp "$DESKTOP_FILE" "$APP_DIR_PATH/ZoneTimer.desktop" 2>/dev/null
    update-desktop-database "$APP_DIR_PATH" 2>/dev/null
    echo "  [+] Desktop shortcut installed! Double-click 'Zone Timer' on your Desktop."
fi

# ── Launch ──
echo ""
echo "  Starting Zone Timer..."
echo ""
python3 timer.py
