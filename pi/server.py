"""
MJPEG + TFLite Inference Server for Raspberry Pi
- Shared camera frame buffer (no contention)
- TFLite inference via cv2.dnn
- HTTP endpoints for detections and model control
"""

import asyncio
import threading
import time
import logging
import json
import os
import numpy as np
import cv2

from aiohttp import web
from aiohttp.web import middleware

# =========================================================
# CONFIG
# =========================================================

VIDEO_DEVICE = "/dev/video0"
FRAME_WIDTH = 640
FRAME_HEIGHT = 360
FPS = 30
JPEG_QUALITY = 40
CONE_INPUT_SIZE = 320
POTHOLE_INPUT_SIZE = 256

# Model paths
CONE_MODEL_PATH = "./models/cone_detect.tflite"
POTHOLE_MODEL_PATH = "./models/pothole_detect.tflite"

# Detection thresholds
CONE_CONFIDENCE_THRESHOLD = 0.3
POTHOLE_CONFIDENCE_THRESHOLD = 0.6
NMS_IOU_THRESHOLD = 0.45

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("server")

# =========================================================
# SHARED STATE
# =========================================================

active_model = "cone"           # "cone" | "pothole" | "off"
latest_detections = []
detection_lock = threading.Lock()

# Shared camera frame — written by camera thread, read by stream + inference
latest_frame = None
latest_jpeg = None
frame_lock = threading.Lock()
frame_seq = 0          # incremented every time a new frame is written
frame_event = threading.Event()  # signals waiters that a new frame is ready

# TFLite interpreters (ai-edge-litert)
cone_interp = None
pothole_interp = None


# =========================================================
# MODEL LOADER (ai-edge-litert)
# =========================================================

def load_models():
    global cone_interp, pothole_interp
    from ai_edge_litert import interpreter as tflite

    for name, path in [("cone", CONE_MODEL_PATH), ("pothole", POTHOLE_MODEL_PATH)]:
        if not os.path.exists(path):
            logger.warning("[%s] Model not found: %s", name, path)
            continue
        try:
            interp = tflite.Interpreter(model_path=path)
            interp.allocate_tensors()
            inp = interp.get_input_details()[0]
            outs = interp.get_output_details()
            logger.info("[%s] Loaded: %s", name, path)
            logger.info("[%s]   Input:  shape=%s dtype=%s", name, inp['shape'], inp['dtype'])
            for i, o in enumerate(outs):
                logger.info("[%s]   Output[%d]: shape=%s dtype=%s", name, i, o['shape'], o['dtype'])
            if name == "cone":
                cone_interp = interp
            else:
                pothole_interp = interp
        except Exception as e:
            logger.error("[%s] Failed to load: %s", name, e)


# =========================================================
# CAMERA THREAD — single reader, shared frame
# =========================================================

def camera_loop():
    """Continuously read frames from camera into shared buffer."""
    global latest_frame, latest_jpeg
    logger.info("Camera thread starting...")

    cap = None
    for attempt in range(10):
        cap = cv2.VideoCapture(VIDEO_DEVICE, cv2.CAP_V4L2)
        if cap.isOpened():
            break
        time.sleep(0.5)

    if not cap or not cap.isOpened():
        logger.error("Cannot open camera!")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)
    cap.set(cv2.CAP_PROP_FPS, FPS)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))

    # Drain initial frames
    for _ in range(5):
        cap.read()

    logger.info("Camera ready — streaming at %dx%d @ %dfps", FRAME_WIDTH, FRAME_HEIGHT, FPS)
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
            global frame_seq
            latest_frame = frame
            latest_jpeg = jpeg_buf.tobytes()
            frame_seq += 1
        frame_event.set()   # wake any waiting stream coroutines
        frame_event.clear()

        elapsed = time.monotonic() - t0
        sleep_time = frame_interval - elapsed
        if sleep_time > 0:
            time.sleep(sleep_time)


# =========================================================
# NMS
# =========================================================

def nms(boxes, scores, iou_threshold):
    if len(boxes) == 0:
        return []
    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]
    keep = []
    while len(order) > 0:
        i = order[0]
        keep.append(i)
        if len(order) == 1:
            break
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
        iou = inter / (areas[i] + areas[order[1:]] - inter + 1e-6)
        order = order[np.where(iou <= iou_threshold)[0] + 1]
    return keep


# =========================================================
# INFERENCE (TFLite via ai-edge-litert)
# =========================================================

def run_inference(frame, interp, class_name, input_size=320, conf_threshold=0.5):
    """Run SSD-style TFLite inference. Output: [1, 300, 6] = [x1,y1,x2,y2,conf,class]."""
    if interp is None or frame is None:
        return []

    input_details = interp.get_input_details()[0]
    output_details = interp.get_output_details()

    # Preprocess: resize, RGB
    img = cv2.resize(frame, (input_size, input_size))
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

    if input_details['dtype'] == np.uint8:
        # Quantized model — pass raw 0-255 uint8 pixels
        img = np.expand_dims(img.astype(np.uint8), axis=0)
    else:
        # Float model — normalize to 0-1
        img = img.astype(np.float32) / 255.0
        img = np.expand_dims(img, axis=0)

    interp.set_tensor(input_details['index'], img)
    interp.invoke()

    # Get output
    output = interp.get_tensor(output_details[0]['index'])

    # Dequantize uint8 output
    if output_details[0]['dtype'] == np.uint8:
        quant = output_details[0].get('quantization', (1.0, 0))
        if isinstance(quant, tuple) and len(quant) == 2:
            scale, zero_point = float(quant[0]), int(quant[1])
        else:
            scale, zero_point = 1.0, 0
        output = (output.astype(np.float32) - zero_point) * scale
        logger.debug("Dequantized with scale=%f, zero=%d", scale, zero_point)

    # Squeeze to [300, 6]
    while len(output.shape) > 2:
        output = output[0]

    logger.debug("Output shape: %s, sample row: %s",
                 output.shape,
                 [round(float(v), 4) for v in output[0]] if len(output) > 0 else "empty")

    # Parse SSD format: [x1, y1, x2, y2, confidence, class_id]
    detections = []
    boxes_for_nms = []
    scores_for_nms = []

    for row in output:
        if len(row) < 5:
            continue

        x1, y1, x2, y2 = float(row[0]), float(row[1]), float(row[2]), float(row[3])
        conf = float(row[4])

        # Clamp confidence to 0-1
        conf = max(0.0, min(1.0, conf))

        if conf < conf_threshold:
            continue

        # Clamp coordinates to 0-1
        x1 = max(0.0, min(1.0, x1))
        y1 = max(0.0, min(1.0, y1))
        x2 = max(0.0, min(1.0, x2))
        y2 = max(0.0, min(1.0, y2))

        w = x2 - x1
        h = y2 - y1
        if w <= 0 or h <= 0:
            continue

        boxes_for_nms.append([x1, y1, x2, y2])
        scores_for_nms.append(conf)
        detections.append({
            "class": class_name,
            "confidence": round(conf, 3),
            "x": round(x1, 4),
            "y": round(y1, 4),
            "w": round(w, 4),
            "h": round(h, 4),
        })

    if detections:
        keep = nms(np.array(boxes_for_nms), np.array(scores_for_nms), NMS_IOU_THRESHOLD)
        detections = [detections[i] for i in keep]

    return detections


# =========================================================
# INFERENCE THREAD
# =========================================================

inference_fps_counter = 0
inference_last_log = time.monotonic()

def inference_loop():
    global latest_detections, inference_fps_counter, inference_last_log
    logger.info("Inference thread started")

    while True:
        try:
            if active_model == "off":
                with detection_lock:
                    latest_detections = []
                time.sleep(0.1)
                continue

            with frame_lock:
                frame = latest_frame.copy() if latest_frame is not None else None

            if frame is None:
                time.sleep(0.05)
                continue

            if active_model == "cone" and cone_interp:
                dets = run_inference(frame, cone_interp, "cone", CONE_INPUT_SIZE, CONE_CONFIDENCE_THRESHOLD)
            elif active_model == "pothole" and pothole_interp:
                dets = run_inference(frame, pothole_interp, "pothole", POTHOLE_INPUT_SIZE, POTHOLE_CONFIDENCE_THRESHOLD)
            else:
                dets = []

            with detection_lock:
                latest_detections = dets

            # Log inference stats every 5 seconds
            inference_fps_counter += 1
            now = time.monotonic()
            if now - inference_last_log >= 5.0:
                fps = inference_fps_counter / (now - inference_last_log)
                logger.info("Inference: %.1f fps, %d detections, model=%s",
                           fps, len(dets), active_model)
                inference_fps_counter = 0
                inference_last_log = now

        except Exception as e:
            logger.error("Inference error: %s", e, exc_info=True)
            time.sleep(0.5)


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
# ENDPOINTS
# =========================================================

async def handle_frame(request):
    with frame_lock:
        jpeg = latest_jpeg
    if jpeg is None:
        return web.Response(status=500, text="No frame yet")
    return web.Response(
        body=jpeg,
        content_type="image/jpeg",
        headers={"Cache-Control": "no-cache, no-store"},
    )


async def handle_stream(request):
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

    logger.info("Client connected to /stream")
    last_seq = -1

    try:
        while True:
            # Wait up to 100ms for a new frame — avoids busy-spin
            await asyncio.get_event_loop().run_in_executor(
                None, lambda: frame_event.wait(timeout=0.1)
            )

            with frame_lock:
                jpeg = latest_jpeg
                seq = frame_seq

            if jpeg is None or seq == last_seq:
                continue  # no new frame yet

            last_seq = seq

            # Write the frame — no drain() to avoid TCP backpressure stall
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
        logger.info("Client disconnected")
    return response


async def handle_detections(request):
    with detection_lock:
        dets = list(latest_detections)
    return web.json_response(dets)


async def handle_set_model(request):
    global active_model
    params = await request.json()
    model = params.get("model", "off")
    if model not in ("cone", "pothole", "off"):
        return web.Response(status=400, text="Invalid model")
    active_model = model
    logger.info("Model switched to: %s", model)
    with detection_lock:
        global latest_detections
        latest_detections = []
    return web.json_response({"model": active_model})


async def handle_status(request):
    return web.json_response({
        "status": "ok",
        "active_model": active_model,
        "cone_model_loaded": cone_interp is not None,
        "pothole_model_loaded": pothole_interp is not None,
    })


async def handle_debug(request):
    """Run one inference and dump raw output for debugging."""
    global active_model
    model = request.query.get("model", "cone")

    # Pause inference thread
    prev_model = active_model
    active_model = "off"
    import time as _time
    _time.sleep(0.3)  # Wait for inference thread to stop

    try:
        with frame_lock:
            frame = latest_frame.copy() if latest_frame is not None else None

        if frame is None:
            return web.json_response({"error": "No frame yet"})

        if model == "cone" and cone_interp:
            interp, sz = cone_interp, CONE_INPUT_SIZE
        elif model == "pothole" and pothole_interp:
            interp, sz = pothole_interp, POTHOLE_INPUT_SIZE
        else:
            return web.json_response({"error": f"Model '{model}' not loaded"})

        input_details = interp.get_input_details()[0]
        output_details = interp.get_output_details()

        img = cv2.resize(frame, (sz, sz))
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        img = img.astype(np.float32) / 255.0
        img = np.expand_dims(img, axis=0)

        if input_details['dtype'] == np.uint8:
            scale, zero = input_details.get('quantization', (1.0, 0))
            if isinstance(scale, tuple):
                scale, zero = scale
            img = ((img / scale) + zero).astype(np.uint8)

        interp.set_tensor(input_details['index'], img)
        interp.invoke()

        result = {"model": model, "input_shape": [int(x) for x in input_details['shape']],
                  "input_dtype": str(input_details['dtype']), "num_outputs": len(output_details)}
        for i, od in enumerate(output_details):
            tensor = interp.get_tensor(od['index'])
            flat = tensor.flatten()
            result[f"output_{i}"] = {
                "shape": [int(x) for x in tensor.shape],
                "dtype": str(tensor.dtype),
                "min": round(float(np.min(tensor)), 6),
                "max": round(float(np.max(tensor)), 6),
                "first_30": [round(float(v), 4) for v in flat[:30]],
            }
        return web.json_response(result)

    except Exception as e:
        return web.json_response({"error": str(e)})

    finally:
        active_model = prev_model


# =========================================================
# MAIN
# =========================================================

if __name__ == "__main__":
    import socket
    socket.setdefaulttimeout(5)

    load_models()

    # Camera thread — single reader
    cam_thread = threading.Thread(target=camera_loop, daemon=True)
    cam_thread.start()

    # Inference thread — reads shared frame
    inf_thread = threading.Thread(target=inference_loop, daemon=True)
    inf_thread.start()

    app = web.Application(middlewares=[cors_middleware])
    app.router.add_get("/frame", handle_frame)
    app.router.add_get("/stream", handle_stream)
    app.router.add_get("/detections", handle_detections)
    app.router.add_post("/set_model", handle_set_model)
    app.router.add_get("/status", handle_status)
    app.router.add_get("/debug", handle_debug)

    logger.info("Server on http://0.0.0.0:8080")
    logger.info("  /stream      — MJPEG video")
    logger.info("  /detections  — Detection results (JSON)")
    logger.info("  /set_model   — Switch model (POST)")
    logger.info("  /debug       — Raw model output (GET)")
    web.run_app(app, host="0.0.0.0", port=8080, tcp_nodelay=True)
