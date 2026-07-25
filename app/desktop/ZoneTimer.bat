@echo off
title Zone Timer — Desktop Overlay
color 0B
cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║   ZONE TIMER — Desktop Floating Timer   ║
echo  ╚══════════════════════════════════════════╝
echo.

:: ── Check Python ──
where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [!] Python not found.
    echo  [!] Download from https://python.org/downloads/
    echo  [!] IMPORTANT: Check "Add Python to PATH" during install
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('python --version 2^>^&1') do echo  [+] Found %%i

:: ── Install dependencies (auto, first time only) ──
echo  [*] Checking dependencies...
python -c "import customtkinter" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [*] First run — installing customtkinter (one-time)...
    python -m pip install --quiet --upgrade customtkinter 2>nul
    if %ERRORLEVEL% neq 0 (
        echo  [!] Install failed. Try: pip install customtkinter
        pause
        exit /b 1
    )
    echo  [+] Dependencies installed successfully!
) else (
    echo  [+] All dependencies ready.
)

:: ── Download timer.py if missing ──
if not exist "timer.py" (
    echo  [*] Downloading timer app from server...
    python -c "import urllib.request; urllib.request.urlretrieve('https://anuragw088-zone.hf.space/api/desktop/app', 'timer.py')"
    if %ERRORLEVEL% neq 0 (
        echo  [!] Download failed. Check your internet connection.
        pause
        exit /b 1
    )
    echo  [+] Downloaded!
)

:: ── Launch ──
echo.
echo  Starting Zone Timer...
echo.
python timer.py
if %ERRORLEVEL% neq 0 (
    echo.
    echo  [!] App crashed. Try: pip install --upgrade customtkinter
    pause
)
