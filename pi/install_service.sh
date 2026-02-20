#!/bin/bash
# ============================================================
# ASSVA - One-Time Install Script
# Run ONCE on the Pi to auto-start both servers on boot.
#
# Usage:
#   chmod +x install_service.sh
#   sudo bash install_service.sh
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"
ACTUAL_USER="${SUDO_USER:-pi}"

echo "=== ASSVA Auto-Start Installer ==="

if [ "$EUID" -ne 0 ]; then
    echo "ERROR: Run with sudo"; exit 1
fi

if [ ! -f "$VENV_DIR/bin/python" ]; then
    echo "ERROR: venv not found at $VENV_DIR"; exit 1
fi

# ---- Front camera server (port 8080) ----
cat > /etc/systemd/system/assva.service << EOF
[Unit]
Description=ASSVA Front Camera Server (port 8080)
After=network.target

[Service]
Type=simple
User=$ACTUAL_USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=$VENV_DIR/bin/python $SCRIPT_DIR/server.py
Restart=always
RestartSec=3
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

# ---- Rear camera server (port 8081) ----
cat > /etc/systemd/system/assva-rear.service << EOF
[Unit]
Description=ASSVA Rear Camera Server (port 8081)
After=network.target

[Service]
Type=simple
User=$ACTUAL_USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=$VENV_DIR/bin/python $SCRIPT_DIR/rear_server.py
Restart=always
RestartSec=3
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable assva.service assva-rear.service
systemctl start assva.service assva-rear.service

echo ""
echo "Done! Both servers are running and will auto-start on boot."
echo ""
echo "  Front camera (8080): sudo systemctl status assva"
echo "  Rear camera  (8081): sudo systemctl status assva-rear"
echo "  Live logs:           journalctl -u assva -u assva-rear -f"
