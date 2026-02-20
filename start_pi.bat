@echo off
REM ============================================================
REM ASSVA - Start Pi Server from Windows
REM Double-click this file or run from cmd to start the Pi server.
REM 
REM CONFIGURE THESE VALUES:
REM ============================================================

set PI_USER=pi
set PI_IP=192.168.92.121
set PI_SCRIPT_DIR=/home/pi/assva/pi

REM ============================================================
echo === ASSVA Pi Server Launcher ===
echo Connecting to %PI_USER%@%PI_IP%...
echo.

ssh %PI_USER%@%PI_IP% "cd %PI_SCRIPT_DIR% && bash start.sh"

echo.
echo Server stopped.
pause
