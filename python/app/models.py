"""Pydantic models for request/response schemas."""

from pydantic import BaseModel
from typing import Optional


class Detection(BaseModel):
    """Single object detection result."""
    id: int
    class_id: int
    class_name: str
    confidence: float
    bbox: list[float]  # [x1, y1, x2, y2]


class FrameDetections(BaseModel):
    """Detections for a single video frame."""
    frame_index: int
    timestamp_sec: Optional[float] = None
    detections: list[Detection]
    frame_data: Optional[str] = None  # Base64 encoded frame image


class ImageDetections(BaseModel):
    """Detection results for an image."""
    image_width: int
    image_height: int
    model_name: str
    device: str
    inference_ms: float
    detections: list[Detection]


class VideoDetections(BaseModel):
    """Detection results for a video."""
    video_fps: Optional[float] = None
    frame_width: int
    frame_height: int
    total_frames: int
    total_frames_sampled: int
    frames: list[FrameDetections]


class PpeEvent(BaseModel):
    """PPE safety event."""
    frame_index: int
    description: str


class DistanceEvent(BaseModel):
    """Distance violation event."""
    frame_index: int
    description: str


class HazardEvent(BaseModel):
    """Hazard detection event."""
    frame_index: int
    description: str


class RTSPStreamRequest(BaseModel):
    """Request body for RTSP stream detection."""
    url: str
    max_frames: int = 100
    sample_every: int = 1
