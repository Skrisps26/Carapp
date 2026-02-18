#!/bin/bash
# ============================================================
# RTSP Server Setup for Raspberry Pi
# Uses mediamtx (lightweight RTSP server) + FFmpeg
# ============================================================

set -e

ARCH=$(uname -m)
MEDIAMTX_VERSION="v1.9.3"

echo "=========================================="
echo " Setting up RTSP Server"
echo "=========================================="

# 1. Install FFmpeg (if not present)
if ! command -v ffmpeg &> /dev/null; then
    echo "Installing FFmpeg..."
    sudo apt-get update
    sudo apt-get install -y ffmpeg
else
    echo "FFmpeg already installed"
fi

# 2. Download mediamtx
if [ ! -f "./mediamtx" ]; then
    echo "Downloading mediamtx..."
    if [ "$ARCH" = "aarch64" ]; then
        TARBALL="mediamtx_${MEDIAMTX_VERSION}_linux_arm64v8.tar.gz"
    elif [ "$ARCH" = "armv7l" ]; then
        TARBALL="mediamtx_${MEDIAMTX_VERSION}_linux_armv7.tar.gz"
    else
        TARBALL="mediamtx_${MEDIAMTX_VERSION}_linux_amd64.tar.gz"
    fi

    wget -q "https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/${TARBALL}" -O mediamtx.tar.gz
    tar xzf mediamtx.tar.gz mediamtx
    rm mediamtx.tar.gz
    chmod +x mediamtx
    echo "mediamtx downloaded"
else
    echo "mediamtx already present"
fi

# 3. Get Pi IP
PI_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "=========================================="
echo " Ready!"
echo "=========================================="
echo ""
echo "Step 1: Start mediamtx (Terminal 1):"
echo "  ./mediamtx"
echo ""
echo "Step 2: Start FFmpeg camera stream (Terminal 2):"
echo "  ffmpeg -f v4l2 -input_format mjpeg -video_size 640x360 -framerate 30 \\"
echo "    -i /dev/video0 \\"
echo "    -c:v libx264 -preset ultrafast -tune zerolatency \\"
echo "    -b:v 1500k -maxrate 1500k -bufsize 500k \\"
echo "    -g 30 -keyint_min 30 \\"
echo "    -f rtsp rtsp://localhost:8554/live"
echo ""
echo "Step 3: Test in VLC:"
echo "  rtsp://${PI_IP}:8554/live"
echo ""
echo "=========================================="
