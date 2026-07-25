@echo off
setlocal enabledelayedexpansion
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
    echo  [+] Dependencies installed!
) else (
    echo  [+] All dependencies ready.
)

:: ── Get server URL (saved or prompt) ──
set SERVER_URL=
if exist "server.txt" (
    set /p SERVER_URL=<server.txt
    for /f "tokens=*" %%a in ("!SERVER_URL!") do set SERVER_URL=%%a
)
if "!SERVER_URL!"=="" (
    echo.
    echo  Enter your Zone OS server URL (e.g. https://yoursite.com)
    set /p SERVER_URL="  URL: "
    if "!SERVER_URL!"=="" (
        echo  [!] No URL entered. Exiting.
        pause
        exit /b 1
    )
    echo !SERVER_URL!> server.txt
    echo  [+] Saved to server.txt
)

:: ── Download timer.py if missing ──
if not exist "timer.py" (
    echo  [*] Downloading timer app from !SERVER_URL!...
    echo  [*] (First download may take up to 60s if server is sleeping)
    python -c "import urllib.request, socket; socket.setdefaulttimeout(60); urllib.request.urlretrieve('!SERVER_URL!/api/desktop/app', 'timer.py')"
    if %ERRORLEVEL% neq 0 (
        echo  [!] Download failed. Check URL and internet.
        echo  [!] Delete server.txt and try again.
        pause
        exit /b 1
    )
    :: Check file is not empty
    for %%A in (timer.py) do if %%~zA==0 (
        echo  [!] Downloaded file is empty. Server may be down.
        del timer.py
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
