"""Real-time RTSP streaming with YOLO detection.

All blocking OpenCV calls (connect, read, encode) are offloaded to a thread
pool so the uvicorn async event loop stays responsive even with a single worker.
"""

import cv2
import base64
import asyncio
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from fastapi import WebSocket, WebSocketDisconnect
from .video_utils import open_video_capture, flush_video_buffer
from .yolo_service import detect_frame
from .config import YOLO_INPUT_SIZE, STREAM_JPEG_QUALITY

logger = logging.getLogger(__name__)

_pool = ThreadPoolExecutor(max_workers=16, thread_name_prefix="rtsp")

CONNECT_TIMEOUT_SEC = 30

STREAM_MAX_WIDTH = 960
STREAM_JPEG_QUALITY_REMOTE = 55


def _open_capture_blocking(rtsp_url: str) -> cv2.VideoCapture:
    """Open RTSP stream in a worker thread (may block for several seconds)."""
    return open_video_capture(rtsp_url)


def _grab_and_process(cap: cv2.VideoCapture) -> tuple:
    """Flush buffer, read one frame, run detection, encode to JPEG for display.

    The display frame is down-scaled to STREAM_MAX_WIDTH to keep bandwidth
    manageable for remote (WAN) viewers.  Detection bounding-box coordinates
    are mapped back to the *display* frame so the frontend can draw them
    directly on the canvas.
    """
    flush_video_buffer(cap, max_frames=3)
    ret, frame = cap.read()
    if not ret or frame is None:
        return False, None, None

    h, w = frame.shape[:2]

    # --- Detection on a fixed-size input ---------------------------------
    if w > YOLO_INPUT_SIZE:
        det_scale = YOLO_INPUT_SIZE / w
        detection_frame = cv2.resize(frame, (YOLO_INPUT_SIZE, int(h * det_scale)))
    else:
        detection_frame = frame
        det_scale = 1.0

    detections = detect_frame(detection_frame)

    # --- Display frame (down-scaled for bandwidth) -----------------------
    if w > STREAM_MAX_WIDTH:
        disp_scale = STREAM_MAX_WIDTH / w
        display_frame = cv2.resize(frame, (STREAM_MAX_WIDTH, int(h * disp_scale)))
    else:
        disp_scale = 1.0
        display_frame = frame

    # Map detection boxes from the detection frame to the display frame
    box_scale = disp_scale / det_scale if det_scale != 0 else 1.0
    for det in detections:
        det.bbox = [coord * box_scale for coord in det.bbox]

    _, buf = cv2.imencode('.jpg', display_frame,
                          [cv2.IMWRITE_JPEG_QUALITY, STREAM_JPEG_QUALITY_REMOTE])
    frame_b64 = base64.b64encode(buf).decode('utf-8')

    return True, frame_b64, detections


async def stream_rtsp_realtime(websocket: WebSocket, rtsp_url: str, fps_limit: int = 15):
    """
    Stream RTSP video with real-time detection via WebSocket.

    Blocking OpenCV work runs in a thread pool so the event loop can still
    serve other WebSocket connections and HTTP requests concurrently.

    Back-pressure: if sending a frame takes longer than the frame interval,
    the next capture is skipped so the send queue doesn't grow unboundedly.
    """
    cap = None
    loop = asyncio.get_event_loop()

    try:
        logger.info(f"Opening RTSP stream: {rtsp_url}")

        try:
            cap = await asyncio.wait_for(
                loop.run_in_executor(_pool, _open_capture_blocking, rtsp_url),
                timeout=CONNECT_TIMEOUT_SEC,
            )
        except asyncio.TimeoutError:
            msg = f"Timed out connecting to {rtsp_url} after {CONNECT_TIMEOUT_SEC}s"
            logger.warning(msg)
            await websocket.send_json({"type": "error", "message": msg})
            return
        except ValueError as exc:
            logger.warning(f"Cannot open RTSP stream: {exc}")
            await websocket.send_json({"type": "error", "message": str(exc)})
            return

        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        stream_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0

        disp_w = min(width, STREAM_MAX_WIDTH)
        disp_h = int(height * (disp_w / width)) if width > 0 else height

        await websocket.send_json({
            "type": "stream_info",
            "width": disp_w,
            "height": disp_h,
            "fps": stream_fps,
        })

        logger.info(
            f"Streaming {width}x{height} → {disp_w}x{disp_h} @ {stream_fps} fps "
            f"(limited to {fps_limit} fps)"
        )

        frame_count = 0
        frame_interval = 1.0 / fps_limit
        last_send_time = 0.0
        consecutive_errors = 0
        max_consecutive_errors = 10
        send_timeout = 3.0  # drop frame if send takes longer than this

        while True:
            # Non-blocking check for client commands
            try:
                message = await asyncio.wait_for(websocket.receive_text(), timeout=0.001)
                data = json.loads(message)
                if data.get("command") == "stop":
                    logger.info("Stop command received from client")
                    break
            except asyncio.TimeoutError:
                pass
            except WebSocketDisconnect:
                break

            # Rate-limit: sleep until next frame is due
            now = loop.time()
            wait = frame_interval - (now - last_send_time)
            if wait > 0:
                await asyncio.sleep(wait)

            # Offload blocking OpenCV work to thread pool
            try:
                ret, frame_b64, detections = await asyncio.wait_for(
                    loop.run_in_executor(_pool, _grab_and_process, cap),
                    timeout=5.0,
                )
            except (asyncio.TimeoutError, Exception) as exc:
                consecutive_errors += 1
                if consecutive_errors >= max_consecutive_errors:
                    logger.warning(f"Stream stalled after {consecutive_errors} errors: {exc}")
                    break
                await asyncio.sleep(0.05)
                continue

            if not ret:
                consecutive_errors += 1
                if consecutive_errors >= max_consecutive_errors:
                    logger.warning(f"Stream ended after {consecutive_errors} read failures")
                    break
                await asyncio.sleep(0.05)
                continue

            consecutive_errors = 0
            frame_count += 1

            try:
                await asyncio.wait_for(
                    websocket.send_json({
                        "type": "frame",
                        "frame_index": frame_count,
                        "timestamp": loop.time(),
                        "frame_data": frame_b64,
                        "detections": [
                            {
                                "id": d.id,
                                "class_id": d.class_id,
                                "class_name": d.class_name,
                                "confidence": d.confidence,
                                "bbox": d.bbox,
                            }
                            for d in detections
                        ],
                    }),
                    timeout=send_timeout,
                )
                last_send_time = loop.time()
            except asyncio.TimeoutError:
                logger.warning("Frame send timed out (slow client), skipping")
                continue
            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.error(f"Error sending frame: {e}")
                break

    except WebSocketDisconnect:
        logger.info("Client disconnected from RTSP stream")
    except Exception as e:
        logger.error(f"RTSP streaming error: {e}", exc_info=True)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        if cap:
            cap.release()
            logger.info("RTSP stream closed and resources released")
