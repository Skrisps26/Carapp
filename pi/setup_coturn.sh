#!/bin/bash
# ============================================================
# Setup script for coturn on Raspberry Pi
# Run this ON the Pi: bash setup_coturn.sh
# ============================================================

set -e

echo "=========================================="
echo " Installing coturn TURN server"
echo "=========================================="

# 1. Install coturn
sudo apt-get update
sudo apt-get install -y coturn

# 2. Enable coturn as a service
echo ""
echo "Enabling coturn..."
sudo sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn 2>/dev/null || true

# 3. Copy our config
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_SRC="${SCRIPT_DIR}/turnserver.conf"

if [ -f "$CONFIG_SRC" ]; then
    echo "Copying turnserver.conf..."
    sudo cp "$CONFIG_SRC" /etc/turnserver.conf
else
    echo "WARNING: turnserver.conf not found in script directory"
    echo "Expected at: $CONFIG_SRC"
fi

# 4. Get the Pi's IP
echo ""
echo "=========================================="
echo " Network Info"
echo "=========================================="
echo "Your network interfaces:"
ip -4 addr show | grep -E "inet |: " | head -20

PI_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "Primary IP detected: $PI_IP"
echo ""

# 5. Test coturn
echo "=========================================="
echo " Starting coturn..."
echo "=========================================="
echo ""
echo "To run coturn manually (foreground, with logs):"
echo "  sudo turnserver -c /etc/turnserver.conf --verbose"
echo ""
echo "To run as a background service:"
echo "  sudo systemctl restart coturn"
echo "  sudo systemctl status coturn"
echo ""
echo "=========================================="
echo " TURN Server Credentials"
echo "=========================================="
echo "  URL:      turn:${PI_IP}:3478"
echo "  Username: assva"
echo "  Password: assva2026"
echo ""
echo "Use these in your WebRTC ICE config on BOTH client and server."
echo "=========================================="
echo ""
echo "Done! Now run your WebRTC server:"
echo "  python3 server.py"
