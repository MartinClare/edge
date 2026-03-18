#!/bin/bash
# Scan 192.168.10.x for RTSP cameras via the edge API.
# Usage: ./scripts/scan_cameras.sh [network_prefix] [username] [password]
# Example: ./scripts/scan_cameras.sh 192.168.10 admin 123456

PREFIX="${1:-192.168.10}"
USER="${2:-admin}"
PASS="${3:-123456}"
API="${YOLO_API_URL:-http://127.0.0.1:8000}"

echo "Scanning ${PREFIX}.0/24 for cameras (user=$USER)..."
echo ""

curl -s -X POST "${API}/api/scan-cameras?network_prefix=${PREFIX}&username=${USER}&password=${PASS}" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    if not d.get('success'):
        print(d.get('detail', d))
        sys.exit(1)
    cams = d.get('cameras', [])
    print(f\"Found {len(cams)} camera(s)\n\")
    for i, c in enumerate(cams, 1):
        print(f\"  {i}. {c.get('ip')}:{c.get('port')}{c.get('path', '')}\")
        print(f\"     URL: {c.get('url')}\")
        print(f\"     Resolution: {c.get('resolution')} @ {c.get('fps')} fps\")
        print()
except Exception as e:
    print(e)
    sys.exit(1)
"
