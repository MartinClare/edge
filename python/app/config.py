"""Configuration settings for the YOLOv8 detection service."""

import os

# ---------------------------------------------------------------------------
# Model path
# ---------------------------------------------------------------------------
# Override via environment variable YOLO_MODEL_PATH.
#
# Supported values:
#   PyTorch  : "models/ppe_construction_best.pt"       (Windows / x86 / CUDA)
#   RKNN NPU : "models/ppe_construction_best_rk3588.rknn" (Rockchip RK3588)
#              "models/ppe_construction_best_rk3576.rknn" (Rockchip RK3576)
#   HuggingFace: "Tanishjain9/yolov8n-ppe-detection-6classes"
# ---------------------------------------------------------------------------
MODEL_PATH: str = os.getenv("YOLO_MODEL_PATH", "models/ppe_construction_best.pt")

# ---------------------------------------------------------------------------
# Inference device
# ---------------------------------------------------------------------------
# Override via environment variable YOLO_DEVICE.
#
# Values:
#   "cuda:0"  — NVIDIA GPU (default for dev on Windows/Linux with CUDA)
#   "cpu"     — CPU-only  (required when using RKNN model on Rockchip)
#   "mps"     — Apple Silicon
#
# When MODEL_PATH ends with ".rknn" the RKNN Lite runtime takes over
# automatically regardless of this setting; use "cpu" to avoid torch errors.
# ---------------------------------------------------------------------------
DEVICE: str = os.getenv("YOLO_DEVICE", "cuda:0")

# ---------------------------------------------------------------------------
# Video / Stream processing
# ---------------------------------------------------------------------------
FRAME_SAMPLE_EVERY: int = int(os.getenv("FRAME_SAMPLE_EVERY", "5"))
MAX_SAMPLE_EVERY: int = 100

# Real-time streaming
YOLO_INPUT_SIZE: int = 640
STREAM_JPEG_QUALITY: int = 70
DEFAULT_FPS_LIMIT: int = int(os.getenv("DEFAULT_FPS_LIMIT", "15"))

# API
API_TITLE: str = "YOLOv8 Detection API"
API_VERSION: str = "1.0.0"

# Video folder (relative to python/ directory, or absolute)
VIDEO_FOLDER: str = os.getenv("VIDEO_FOLDER", "videos")
