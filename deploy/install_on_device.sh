#!/usr/bin/env bash
# =============================================================================
# Edge Service – Device Installation Script
# Run this on the Rockchip Linux device as root (or with sudo).
#
# Usage:
#   chmod +x deploy/install_on_device.sh
#   sudo ./deploy/install_on_device.sh [rk3576|rk3588|rk3568]
#
# Assumes the project directory has been rsync/scp'd to /opt/edge-service.
# RKNN Toolkit Lite 2 is downloaded automatically from GitHub.
# =============================================================================

set -euo pipefail

CHIP="${1:-rk3576}"
INSTALL_DIR="/home/admin/edge"
VENV="$INSTALL_DIR/venv"
PIP="${VENV}/bin/pip"
SERVICE_DIR="/etc/systemd/system"

# RKNN Toolkit Lite 2 GitHub base URL (actual verified path)
RKNN_GITHUB="https://raw.githubusercontent.com/airockchip/rknn-toolkit2/master/rknn-toolkit-lite2/packages"

echo "═══════════════════════════════════════════════"
echo "  Edge AI – Device Setup  (chip: $CHIP)"
echo "═══════════════════════════════════════════════"

# ── 1. System packages ────────────────────────────────────────────────────────
echo "[1/7] Installing system packages..."
apt-get update -q
apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    libopencv-dev libgomp1 \
    ffmpeg curl \
    nodejs npm

# ── 2. Create 'edge' user if missing ──────────────────────────────────────────
if ! id edge &>/dev/null; then
    echo "[2/7] Creating 'edge' system user..."
    useradd --system --shell /bin/bash --home "$INSTALL_DIR" edge
else
    echo "[2/7] User 'edge' already exists."
fi
chown -R edge:edge "$INSTALL_DIR"

# ── 3. Python virtual environment & dependencies ───────────────────────────────
echo "[3/7] Setting up Python virtual environment..."
if [ ! -d "$VENV" ]; then
    python3 -m venv "$VENV"
fi

# Detect Python version (e.g. cp310, cp311)
PY_TAG=$("${VENV}/bin/python" -c "import sys; print(f'cp{sys.version_info.major}{sys.version_info.minor}')")
echo "      Detected Python tag: $PY_TAG"

# PyTorch CPU (ARM64)
echo "      Installing PyTorch CPU for ARM64..."
"$PIP" install --quiet torch torchvision \
    --index-url https://download.pytorch.org/whl/cpu

# RKNN Toolkit Lite 2 — try local wheel first, then download from GitHub
RKNN_WHL=$(find "$INSTALL_DIR/deploy" -name "rknn_toolkit_lite2-*.whl" 2>/dev/null | head -1 || true)
if [ -n "$RKNN_WHL" ]; then
    echo "      Installing RKNN Toolkit Lite 2 from local file: $RKNN_WHL"
    "$PIP" install --quiet "$RKNN_WHL"
else
    RKNN_FILENAME="rknn_toolkit_lite2-2.3.2-${PY_TAG}-${PY_TAG}-manylinux_2_17_aarch64.manylinux2014_aarch64.whl"
    RKNN_URL="${RKNN_GITHUB}/${RKNN_FILENAME}"
    echo "      Downloading RKNN Toolkit Lite 2 from GitHub..."
    echo "      URL: $RKNN_URL"
    if "$PIP" install --quiet "$RKNN_URL"; then
        echo "      ✓ RKNN Toolkit Lite 2 installed from GitHub."
    else
        echo ""
        echo "⚠ Auto-download failed. This usually means your Python version"
        echo "  ($PY_TAG) does not have a pre-built wheel for RKNN ${RKNN_VERSION}."
        echo ""
        echo "  Available wheels are listed at:"
        echo "  https://github.com/airockchip/rknn-toolkit2/tree/master/rknn-toolkit-lite2/packages"
        echo ""
        echo "  Download the correct .whl, place it in $INSTALL_DIR/deploy/"
        echo "  and re-run this script."
        exit 1
    fi
fi

# Rest of Python dependencies
echo "      Installing Python dependencies..."
"$PIP" install --quiet -r "$INSTALL_DIR/python/requirements-rk3588.txt"

# ── 4. Node / serve (for the React UI) + Cloud API deps ──────────────────────
echo "[4/8] Installing 'serve' and Cloud API dependencies..."
npm install -g serve --silent

# Cloud Vision API (OpenRouter/Gemini proxy)
if [ -d "$INSTALL_DIR/cloud" ]; then
    echo "      Installing Cloud API npm dependencies..."
    cd "$INSTALL_DIR/cloud"
    npm install --omit=dev --silent
    cd "$INSTALL_DIR"

    # Create .env if it doesn't exist yet
    if [ ! -f "$INSTALL_DIR/cloud/.env" ]; then
        echo "      Creating cloud/.env from .env.example..."
        if [ -f "$INSTALL_DIR/cloud/.env.example" ]; then
            cp "$INSTALL_DIR/cloud/.env.example" "$INSTALL_DIR/cloud/.env"
        else
            cat > "$INSTALL_DIR/cloud/.env" <<'ENVEOF'
OPENROUTER_API_KEY=sk-or-v1-REPLACE_ME
PORT=3001
FRONTEND_URL=http://localhost:3000
ENVEOF
        fi
        echo ""
        echo "  ⚠ IMPORTANT: Edit $INSTALL_DIR/cloud/.env and set your OpenRouter API key:"
        echo "    nano $INSTALL_DIR/cloud/.env"
        echo ""
    fi
else
    echo "      ⚠ cloud/ folder not found — Deep Vision (Gemini) will not be available."
fi

# ── 5. Verify RKNN model exists ───────────────────────────────────────────────
RKNN_MODEL="$INSTALL_DIR/python/models/ppe_construction_best-${CHIP}.rknn"
echo "[5/8] Checking for RKNN model at $RKNN_MODEL..."
if [ ! -f "$RKNN_MODEL" ]; then
    echo ""
    echo "⚠ RKNN model not found: $RKNN_MODEL"
    echo "  Convert on your Windows dev machine using WSL:"
    echo "    python deploy/export_rknn.py"
    echo "  Then copy to this device:"
    echo "    scp python/models/ppe_construction_best_${CHIP}.rknn user@$(hostname -I | awk '{print $1}'):$INSTALL_DIR/python/models/"
    echo ""
    echo "  Services will be installed but will fail to start until the model is present."
else
    echo "      ✓ RKNN model found."
fi

# ── 6. Install systemd service files ─────────────────────────────────────────
echo "[6/8] Installing systemd services..."

sed "s/ppe_construction_best-rk3576/ppe_construction_best-${CHIP}/g" \
    "$INSTALL_DIR/deploy/edge-python.service" > "$SERVICE_DIR/edge-python.service"

cp "$INSTALL_DIR/deploy/edge-ui.service" "$SERVICE_DIR/edge-ui.service"

SERVICES="edge-python edge-ui"

if [ -f "$INSTALL_DIR/deploy/wg-mullvad.service" ] && [ -f "$INSTALL_DIR/deploy/wg-mullvad-policy.sh" ]; then
    cp "$INSTALL_DIR/deploy/wg-mullvad.service" "$SERVICE_DIR/wg-mullvad.service"
    cp "$INSTALL_DIR/deploy/wg-mullvad-policy.sh" "/usr/local/bin/wg-mullvad-policy.sh"
    chmod +x "/usr/local/bin/wg-mullvad-policy.sh"
    SERVICES="$SERVICES wg-mullvad"
    echo "      ✓ Mullvad policy-routing service installed."
fi

if [ -d "$INSTALL_DIR/cloud/dist" ]; then
    cp "$INSTALL_DIR/deploy/edge-cloud.service" "$SERVICE_DIR/edge-cloud.service"
    SERVICES="$SERVICES edge-cloud"
    echo "      ✓ Cloud Vision API service installed."
fi

systemctl daemon-reload
systemctl enable $SERVICES

# ── 7. Start services ─────────────────────────────────────────────────────────
echo "[7/8] Starting services..."
systemctl restart edge-python || echo "⚠ edge-python failed to start — check logs: journalctl -u edge-python -f"
systemctl restart edge-ui     || echo "⚠ edge-ui failed to start — check logs: journalctl -u edge-ui -f"

if systemctl is-enabled edge-cloud &>/dev/null; then
    systemctl restart edge-cloud || echo "⚠ edge-cloud failed to start — check logs: journalctl -u edge-cloud -f"
fi

# ── 8. Ownership ─────────────────────────────────────────────────────────────
echo "[8/8] Setting file ownership..."
chown -R edge:edge "$INSTALL_DIR"

DEVICE_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "═══════════════════════════════════════════════"
echo "  Installation complete!"
echo ""
echo "  Python backend : http://${DEVICE_IP}:8000"
echo "  React UI       : http://${DEVICE_IP}:3000"
echo "  Cloud Vision   : http://${DEVICE_IP}:3001"
echo ""
echo "  Check status:"
echo "    sudo systemctl status edge-python"
echo "    sudo systemctl status edge-ui"
echo "    sudo systemctl status edge-cloud"
echo ""
echo "  Logs:"
echo "    sudo journalctl -u edge-python -f"
echo "    sudo journalctl -u edge-ui -f"
echo "    sudo journalctl -u edge-cloud -f"
echo ""
echo "  NPU utilisation:"
echo "    watch -n 1 cat /sys/kernel/debug/rknpu/load"
echo "═══════════════════════════════════════════════"
