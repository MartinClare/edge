"""Utilities for reading and processing video files and streams."""

import os
import cv2
import numpy as np
import threading
from typing import Generator, Tuple, Optional
from .config import FRAME_SAMPLE_EVERY

CAP_FFMPEG = getattr(cv2, "CAP_FFMPEG", 1900)

# Set FFmpeg RTSP timeout so unreachable cameras fail in ~5s instead of 30s+.
# The value is in microseconds.  Must be set before any VideoCapture call.
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS",
                       "timeout;5000000|stimeout;5000000|rtsp_transport;tcp")


def open_video_capture(path_or_url: str | int) -> cv2.VideoCapture:
    """
    Open a video capture from file, webcam, or RTSP URL.

    For RTSP the FFmpeg backend is used directly with TCP transport and a
    5-second connection timeout so unreachable cameras fail quickly.
    """
    is_rtsp = isinstance(path_or_url, str) and path_or_url.strip().lower().startswith("rtsp://")

    if is_rtsp:
        # Use FFmpeg directly — it handles RTSP better on ARM/Linux and
        # honours the timeout env vars we set above.
        cap = cv2.VideoCapture(path_or_url, CAP_FFMPEG)
        if cap.isOpened():
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            return cap
        cap.release()

        raise ValueError(
            f"Failed to open video source: {path_or_url}. "
            "For RTSP: check URL and credentials; try /Streaming/Channels/1 or test in VLC."
        )
    else:
        cap = cv2.VideoCapture(path_or_url)
        if not cap.isOpened():
            raise ValueError(f"Failed to open video source: {path_or_url}")
        return cap


def flush_video_buffer(cap: cv2.VideoCapture, max_frames: int = 5) -> None:
    """
    Flush the video capture buffer by reading and discarding frames.
    This is essential for real-time streaming to prevent latency buildup.
    
    Args:
        cap: OpenCV VideoCapture object
        max_frames: Maximum number of frames to flush (default 5)
    """
    for _ in range(max_frames):
        ret = cap.grab()  # grab is faster than read() since we don't decode
        if not ret:
            break


def iterate_frames(
    cap: cv2.VideoCapture,
    sample_every: int = FRAME_SAMPLE_EVERY,
    max_frames: Optional[int] = None
) -> Generator[Tuple[int, Optional[float], np.ndarray], None, None]:
    """
    Iterate through video frames with optional sampling.
    
    Args:
        cap: OpenCV VideoCapture object
        sample_every: Sample every Nth frame (default from config)
        max_frames: Maximum number of frames to process (None = all)
        
    Yields:
        Tuple of (frame_index, timestamp_sec, frame_ndarray)
    """
    frame_index = 0
    frames_read = 0
    fps = cap.get(cv2.CAP_PROP_FPS)
    
    while True:
        ret, frame = cap.read()
        
        if not ret:
            break
        
        # Only yield frames that match the sampling interval
        if frame_index % sample_every == 0:
            # Calculate timestamp if FPS is available
            timestamp_sec = (frame_index / fps) if fps > 0 else None
            
            yield (frame_index, timestamp_sec, frame)
            frames_read += 1
            
            # Check max_frames limit
            if max_frames is not None and frames_read >= max_frames:
                break
        
        frame_index += 1
    
    cap.release()


def get_video_properties(cap: cv2.VideoCapture) -> Tuple[int, int, Optional[float], int]:
    """
    Get video properties from a VideoCapture object.
    
    Args:
        cap: OpenCV VideoCapture object
        
    Returns:
        Tuple of (width, height, fps, total_frames)
    """
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    fps = fps if fps > 0 else None
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    
    return (width, height, fps, total_frames)
