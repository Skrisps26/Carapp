#!/bin/bash
# ============================================================
# ASSVA Pi Server Startup Script
# Place this file on the Pi alongside server.py
# Usage: bash start.sh
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"

echo "=== ASSVA Pi Server ==="
echo "Working directory: $SCRIPT_DIR"

# Activate virtual environment
if [ -d "$VENV_DIR" ]; then
    echo "Activating venv at $VENV_DIR"
    source "$VENV_DIR/bin/activate"
else
    echo "ERROR: Virtual environment not found at $VENV_DIR"
    echo "Create one with: python3 -m venv $VENV_DIR"
    exit 1
fi

# Start the server
echo "Starting server.py on port 8080..."
cd "$SCRIPT_DIR"
python server.py
