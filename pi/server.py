"""
Low-Latency MJPEG Server for Raspberry Pi
- Optimized for minimal streaming delay
- /stream endpoint with aggressive flushing
"""

import asyncio
import time
import logging
import cv2

from aiohttp import web
from aiohttp.web import middleware

# =========================================================
# CONFIG — TUNE THESE FOR LATENCY
# =========================================================

VIDEO_DEVICE = "/dev/video0"
FRAME_WIDTH = 640
FRAME_HEIGHT = 360
FPS = 30
JPEG_QUALITY = 50           # Lower = faster encode + smaller frames

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mjpeg-server")

# =========================================================
# CAMERA
# =========================================================

camera = None


def get_camera():
    global camera
    if camera is None or not camera.isOpened():
        logger.info("Opening camera...")
        for attempt in range(5):
            cap = cv2.VideoCapture(VIDEO_DEVICE, cv2.CAP_V4L2)
            if cap.isOpened():
                camera = cap
                break
            time.sleep(0.5)

        if not camera or not camera.isOpened():
            raise RuntimeError("Cannot open camera")

        camera.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
        camera.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)
        camera.set(cv2.CAP_PROP_FPS, FPS)
        camera.set(cv2.CAP_PROP_BUFFERSIZE, 1)     # Minimize buffer
        camera.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))

        # Drain old frames
        for _ in range(5):
            camera.read()
        logger.info("Camera ready")

    return camera


def grab_jpeg():
    """Grab latest JPEG frame, dropping stale frames."""
    cap = get_camera()
    # Drain buffer to get latest frame (reduce latency)
    cap.grab()
    ret, frame = cap.retrieve()
    if not ret:
        return None
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    return buf.tobytes()


# =========================================================
# CORS
# =========================================================

@middleware
async def cors_middleware(request, handler):
    if request.method == "OPTIONS":
        response = web.Response()
    else:
        response = await handler(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


# =========================================================
# /frame — Single snapshot
# =========================================================

async def handle_frame(request):
    jpeg = grab_jpeg()
    if jpeg is None:
        return web.Response(status=500, text="Camera error")
    return web.Response(
        body=jpeg,
        content_type="image/jpeg",
        headers={"Cache-Control": "no-cache, no-store"},
    )


# =========================================================
# /stream — Low-latency MJPEG stream
# =========================================================

async def handle_stream(request):
    boundary = "frame"
    response = web.StreamResponse(
        status=200,
        reason="OK",
        headers={
            "Content-Type": f"multipart/x-mixed-replace; boundary={boundary}",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Connection": "close",
            "X-Content-Type-Options": "nosniff",
        },
    )
    # Disable output buffering
    response.enable_chunked_encoding()
    await response.prepare(request)

    logger.info("Client connected to /stream")
    frame_interval = 1.0 / FPS

    try:
        while True:
            t0 = time.monotonic()

            jpeg = grab_jpeg()
            if jpeg is None:
                await asyncio.sleep(0.01)
                continue

            # Write frame with boundary
            await response.write(
                f"--{boundary}\r\n"
                f"Content-Type: image/jpeg\r\n"
                f"Content-Length: {len(jpeg)}\r\n"
                f"\r\n".encode()
                + jpeg
                + b"\r\n"
            )

            # Force flush to network
            await response.drain()

            # Pace to target FPS
            elapsed = time.monotonic() - t0
            sleep_time = frame_interval - elapsed
            if sleep_time > 0:
                await asyncio.sleep(sleep_time)

    except (ConnectionResetError, ConnectionError, ConnectionAbortedError):
        logger.info("Client disconnected")
    return response


# =========================================================
# /status
# =========================================================

async def handle_status(request):
    return web.json_response({"status": "ok"})


# =========================================================
# SHUTDOWN
# =========================================================

async def on_shutdown(app):
    global camera
    if camera:
        camera.release()
        camera = None


# =========================================================
# MAIN
# =========================================================

if __name__ == "__main__":
    # Disable TCP Nagle algorithm for lower latency
    import socket
    socket.setdefaulttimeout(5)

    app = web.Application(middlewares=[cors_middleware])
    app.router.add_get("/frame", handle_frame)
    app.router.add_get("/stream", handle_stream)
    app.router.add_get("/status", handle_status)
    app.on_shutdown.append(on_shutdown)

    logger.info("Low-latency MJPEG server on http://0.0.0.0:8080")
    web.run_app(
        app,
        host="0.0.0.0",
        port=8080,
        # TCP_NODELAY for lower latency
        tcp_nodelay=True,
    )
