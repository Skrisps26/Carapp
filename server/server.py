import argparse
import asyncio
import json
import logging
import os
import ssl
import uuid

from aiohttp import web
from aiortc import RTCPeerConnection, RTCSessionDescription, RTCIceCandidate
from aiortc.contrib.media import MediaPlayer

ROOT = os.path.dirname(__file__)

logger = logging.getLogger("pc")
pcs = set()

# Map to store PC by some ID if needed, 
# for single client demo we can use a global variable or singleton
# But better to support 1 active connection for now.
active_pc = None

async def offer(request):
    global active_pc
    params = await request.json()
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])

    pc = RTCPeerConnection()
    active_pc = pc
    pcs.add(pc)

    logger.info("Created for %s", request.remote)

    # Prepare Media
    # usage: python server.py --device /dev/video0
    options = {"framerate": "30", "video_size": "640x480"}
    player = MediaPlayer("/dev/video0", format="v4l2", options=options)
    if player.audio:
        pc.addTrack(player.audio)
    if player.video:
        pc.addTrack(player.video)

    @pc.on("iceconnectionstatechange")
    async def on_iceconnectionstatechange():
        logger.info("ICE connection state is %s", pc.iceConnectionState)
        if pc.iceConnectionState == "failed":
            await pc.close()
            pcs.discard(pc)

    # Handle Offer
    await pc.setRemoteDescription(offer)

    # Create Answer
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    return web.Response(
        content_type="application/json",
        text=json.dumps(
            {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}
        ),
    )

async def candidate(request):
    global active_pc
    params = await request.json()
    
    if active_pc:
        # aiortc expects candidate dict
        # { "candidate": "...", "sdpMid": "...", "sdpMLineIndex": ... }
        cand = params.get("candidate")
        sdpMid = params.get("sdpMid")
        sdpMLineIndex = params.get("sdpMLineIndex")
        
        if cand:
            logger.info("Received candidate: %s", cand)
            candidate = RTCIceCandidate(cand, sdpMid, sdpMLineIndex)
            await active_pc.addIceCandidate(candidate)
            return web.Response(text="OK")
            
    return web.Response(status=404, text="No active PC")

async def on_shutdown(app):
    coros = [pc.close() for pc in pcs]
    await asyncio.gather(*coros)
    pcs.clear()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="WebRTC audio / video / data-channels demo"
    )
    parser.add_argument("--cert-file", help="SSL certificate file (for HTTPS)")
    parser.add_argument("--key-file", help="SSL key file (for HTTPS)")
    parser.add_argument(
        "--host", default="0.0.0.0", help="Host for HTTP server (default: 0.0.0.0)"
    )
    parser.add_argument(
        "--port", type=int, default=8080, help="Port for HTTP server (default: 8080)"
    )
    parser.add_argument("--verbose", "-v", action="count")
    args = parser.parse_args()

    if args.verbose:
        logging.basicConfig(level=logging.DEBUG)
    else:
        logging.basicConfig(level=logging.INFO)

    app = web.Application()
    app.on_shutdown.append(on_shutdown)
    app.router.add_post("/offer", offer)
    app.router.add_post("/candidate", candidate)

    # CORS
    import aiohttp_cors
    cors = aiohttp_cors.setup(app, defaults={
        "*": aiohttp_cors.ResourceOptions(
            allow_credentials=True,
            expose_headers="*",
            allow_headers="*",
        )
    })
    for route in list(app.router.routes()):
        cors.add(route)

    web.run_app(
        app, access_log=None, host=args.host, port=args.port, ssl_context=None
    )
