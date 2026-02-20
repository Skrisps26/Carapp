"""
Front Raw Camera MJPEG Server — port 8082
Simple video-only stream, no inference.
"""

import threading
import time
import logging
import cv2

from aiohttp import web
from aiohttp.web import middleware

# =========================================================
# CONFIG
# =========================================================

VIDEO_DEVICE = "/dev/video0"   # Change to your front camera device
FRAME_WIDTH  = 640
FRAME_HEIGHT = 360
FPS          = 30
JPEG_QUALITY = 40

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("front_server")

# =========================================================
# SHARED STATE
# =========================================================

latest_jpeg  = None
frame_lock   = threading.Lock()
frame_seq    = 0
frame_event  = threading.Event()

# =========================================================
# CAMERA THREAD
# =========================================================

def camera_loop():
    global latest_jpeg, frame_seq
    logger.info("Front camera thread starting...")

    cap = None
    for attempt in range(10):
        cap = cv2.VideoCapture(VIDEO_DEVICE, cv2.CAP_V4L2)
        if cap.isOpened():
            break
        logger.warning("Attempt %d: cannot open %s", attempt + 1, VIDEO_DEVICE)
        time.sleep(0.5)

    if not cap or not cap.isOpened():
        logger.error("Cannot open front camera at %s!", VIDEO_DEVICE)
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  FRAME_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)
    cap.set(cv2.CAP_PROP_FPS,          FPS)
    cap.set(cv2.CAP_PROP_BUFFERSIZE,   1)
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))

    # Drain initial frames
    for _ in range(5):
        cap.read()

    logger.info("Front camera ready — %dx%d @ %dfps", FRAME_WIDTH, FRAME_HEIGHT, FPS)
    frame_interval = 1.0 / FPS

    while True:
        t0 = time.monotonic()

        cap.grab()
        ret, frame = cap.retrieve()
        if not ret:
            time.sleep(0.01)
            continue

        _, jpeg_buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])

        with frame_lock:
            latest_jpeg = jpeg_buf.tobytes()
            frame_seq  += 1
        frame_event.set()
        frame_event.clear()

        elapsed    = time.monotonic() - t0
        sleep_time = frame_interval - elapsed
        if sleep_time > 0:
            time.sleep(sleep_time)


# =========================================================
# CORS
# =========================================================

@middleware
async def cors_middleware(request, handler):
    if request.method == "OPTIONS":
        response = web.Response()
    else:
        response = await handler(request)
    response.headers["Access-Control-Allow-Origin"]  = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


# =========================================================
# ENDPOINTS
# =========================================================

async def handle_frame(request):
    with frame_lock:
        jpeg = latest_jpeg
    if jpeg is None:
        return web.Response(status=503, text="No frame yet")
    return web.Response(
        body=jpeg,
        content_type="image/jpeg",
        headers={"Cache-Control": "no-cache, no-store"},
    )


async def handle_stream(request):
    import asyncio
    boundary = "frame"
    response = web.StreamResponse(
        status=200,
        reason="OK",
        headers={
            "Content-Type": f"multipart/x-mixed-replace; boundary={boundary}",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Connection": "keep-alive",
        },
    )
    response.enable_chunked_encoding()
    await response.prepare(request)

    logger.info("Front client connected")
    last_seq = -1

    try:
        while True:
            await asyncio.get_event_loop().run_in_executor(
                None, lambda: frame_event.wait(timeout=0.1)
            )

            with frame_lock:
                jpeg = latest_jpeg
                seq  = frame_seq

            if jpeg is None or seq == last_seq:
                continue

            last_seq = seq

            try:
                await response.write(
                    f"--{boundary}\r\n"
                    f"Content-Type: image/jpeg\r\n"
                    f"Content-Length: {len(jpeg)}\r\n"
                    f"\r\n".encode()
                    + jpeg
                    + b"\r\n"
                )
            except (ConnectionResetError, ConnectionError, ConnectionAbortedError):
                break
    except (ConnectionResetError, ConnectionError, ConnectionAbortedError):
        pass
    finally:
        logger.info("Front client disconnected")
    return response


async def handle_status(request):
    return web.json_response({"status": "ok", "camera": "front_raw"})


# =========================================================
# MAIN
# =========================================================

if __name__ == "__main__":
    cam_thread = threading.Thread(target=camera_loop, daemon=True)
    cam_thread.start()

    app = web.Application(middlewares=[cors_middleware])
    app.router.add_get("/frame",  handle_frame)
    app.router.add_get("/stream", handle_stream)
    app.router.add_get("/status", handle_status)

    logger.info("Front raw camera server on http://0.0.0.0:8082")
    web.run_app(app, host="0.0.0.0", port=8082, tcp_nodelay=True)
