"""
RKNN Model Export Script
========================
Run via Docker (Windows-native, no WSL needed):
    docker build -f deploy/Dockerfile.export -t rknn-export .
    docker run --rm -v "${PWD}/python/models:/work/models" rknn-export

Or in WSL / Linux directly:
    python deploy/export_rknn.py --chip rk3576

The converted .rknn file is saved to python/models/ and must be copied to the device:
    scp python/models/ppe_construction_best_rk3576.rknn user@<device-ip>:/opt/edge-service/python/models/
"""

import argparse
import os
from pathlib import Path


SUPPORTED_CHIPS = ["rk3588", "rk3576", "rk3568", "rk3566", "rk3562"]

# When running inside Docker the models folder is mounted at /work/models.
# When running natively (WSL/Linux) it is relative to the project root.
_DOCKER_MODELS = Path("/work/models")
_NATIVE_MODELS = Path(__file__).resolve().parent.parent / "python" / "models"

SOURCE_MODEL = (
    _DOCKER_MODELS / "ppe_construction_best.pt"
    if _DOCKER_MODELS.exists()
    else _NATIVE_MODELS / "ppe_construction_best.pt"
)


def export(chip: str, imgsz: int, batch: int) -> Path:
    from ultralytics import YOLO

    if not SOURCE_MODEL.exists():
        raise FileNotFoundError(
            f"Source model not found: {SOURCE_MODEL}\n"
            "Make sure python/models/ppe_construction_best.pt exists."
        )

    print(f"Loading  : {SOURCE_MODEL}")
    print(f"Target   : {chip.upper()}  |  imgsz={imgsz}  batch={batch}")

    model = YOLO(str(SOURCE_MODEL))

    # ultralytics export() returns the path of the exported file
    export_path = model.export(
        format="rknn",
        name=chip,         # selects the Rockchip platform in the RKNN toolchain
        imgsz=imgsz,
        batch=batch,
    )

    out = Path(export_path)
    print(f"\n✓ Exported → {out}")
    print(f"\nNext steps:")
    print(f"  1. Copy to device:")
    print(f"       scp {out} user@<device-ip>:/opt/edge-service/python/models/")
    print(f"  2. On the device, set:")
    print(f"       Environment=YOLO_MODEL_PATH=models/{out.name}")
    print(f"     in /etc/systemd/system/edge-python.service, then:")
    print(f"       sudo systemctl daemon-reload && sudo systemctl restart edge-python")
    return out


def main():
    parser = argparse.ArgumentParser(description="Export PPE model to RKNN format")
    parser.add_argument(
        "--chip",
        choices=SUPPORTED_CHIPS,
        default="rk3576",
        help="Rockchip platform target (default: rk3576)",
    )
    parser.add_argument("--imgsz", type=int, default=640, help="Input image size (default: 640)")
    parser.add_argument("--batch", type=int, default=1, help="Batch size (default: 1)")
    args = parser.parse_args()

    export(chip=args.chip, imgsz=args.imgsz, batch=args.batch)


if __name__ == "__main__":
    main()
