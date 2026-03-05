"""
YOLOv8 service stub for RK3576.

The standard ultralytics/torch wheels use AVX2/FP16 instructions not supported
by the RK3576 Cortex-A55 cluster, causing SIGILL at import time.  This stub
replaces the real implementation so the rest of the application starts cleanly.

All detection endpoints remain available but return empty detection lists until
an RK3576-compatible inference backend is integrated (e.g. rknn_toolkit_lite2 or
a purpose-built RKNN model loader).
"""

import logging
from typing import List

import numpy as np

from .config import MODEL_PATH, DEVICE
from .models import Detection

logger = logging.getLogger(__name__)

_actual_device: str = "cpu"


def get_actual_device() -> str:
    """Return the effective inference device (always 'cpu' on RK3576 stub)."""
    return _actual_device


def load_model():
    """
    No-op stub.

    The real YOLO model cannot be loaded on RK3576 because the ultralytics /
    torch wheels require CPU instructions (AVX2 / FP16) that this SoC does not
    support.  Returns None so callers can detect the stub at runtime if needed.
    """
    logger.warning(
        "YOLO model NOT loaded: ultralytics/torch are unavailable on RK3576. "
        "Detection endpoints will return empty results."
    )
    return None


def detect_image(img: np.ndarray) -> List[Detection]:
    """Return empty detections (YOLO unavailable on RK3576)."""
    return []


def detect_frame(frame: np.ndarray) -> List[Detection]:
    """Return empty detections (YOLO unavailable on RK3576)."""
    return []
