#!/usr/bin/env bash
# =============================================================================
# RKNN Model Export – WSL Helper Script
# Run this inside WSL2 (Ubuntu) on your Windows machine.
#
# Usage (from WSL terminal):
#   cd /mnt/d/development/vd2
#   chmod +x deploy/export_rknn_wsl.sh
#   ./deploy/export_rknn_wsl.sh [rk3576|rk3588|rk3568]
#
# Downloads rknn-toolkit2 directly from GitHub — no manual download needed.
# =============================================================================

set -euo pipefail

CHIP="${1:-rk3576}"
RKNN_VERSION="2.3.0"
RKNN_GITHUB="https://github.com/airockchip/rknn-toolkit2/raw/master/rknn-toolkit2/packages"
VENV="/tmp/rknn-export-venv"

echo "═══════════════════════════════════════════════"
echo "  RKNN Model Export  (chip: $CHIP)"
echo "═══════════════════════════════════════════════"

# ── 1. Create isolated venv ───────────────────────────────────────────────────
echo "[1/4] Setting up Python venv at $VENV..."
python3 -m venv "$VENV"
source "$VENV/bin/activate"

# Detect Python tag (e.g. cp310)
PY_TAG=$(python -c "import sys; print(f'cp{sys.version_info.major}{sys.version_info.minor}')")
echo "      Python tag: $PY_TAG"

# ── 2. Install rknn-toolkit2 from GitHub ──────────────────────────────────────
RKNN_FILENAME="rknn_toolkit2-${RKNN_VERSION}-${PY_TAG}-${PY_TAG}-linux_x86_64.whl"
RKNN_URL="${RKNN_GITHUB}/${RKNN_FILENAME}"

echo "[2/4] Installing rknn-toolkit2 from GitHub..."
echo "      URL: $RKNN_URL"
pip install --quiet "$RKNN_URL"

# ── 3. Install ultralytics ────────────────────────────────────────────────────
echo "[3/4] Installing ultralytics..."
pip install --quiet ultralytics

# ── 4. Export model ───────────────────────────────────────────────────────────
echo "[4/4] Exporting model for $CHIP..."
python deploy/export_rknn.py --chip "$CHIP"

deactivate

echo ""
echo "═══════════════════════════════════════════════"
echo "  Done! Copy the .rknn file to your device:"
echo ""
echo "  scp python/models/ppe_construction_best_${CHIP}.rknn \\"
echo "      user@<device-ip>:/opt/edge-service/python/models/"
echo "═══════════════════════════════════════════════"
