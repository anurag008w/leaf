#!/bin/bash
# ╔══════════════════════════════════════════╗
# ║   ZONE TIMER — Desktop Floating Timer   ║
# ╚══════════════════════════════════════════╝

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

# ── Download timer.py if missing ──
if [ ! -f "timer.py" ]; then
    echo "  [*] Downloading timer app from server..."
    python3 -c "import urllib.request; urllib.request.urlretrieve('https://anuragw088-zone.hf.space/api/desktop/app', 'timer.py')"
    if [ $? -ne 0 ]; then
        echo "  [!] Download failed. Check internet connection."
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
