#!/usr/bin/env python3
"""
Check RTSP camera connectivity from app.config.json.
Run from repo root: python3 scripts/check_camera_connection.py
"""
import json
import socket
import sys
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parent.parent / "app.config.json"
SOCKET_TIMEOUT = 3


def load_cameras():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    cameras = cfg.get("rtsp", {}).get("cameras", [])
    return [c for c in cameras if isinstance(c, dict) and c.get("url")]


def check_tcp(host: str, port: int) -> bool:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(SOCKET_TIMEOUT)
        s.connect((host, port))
        s.close()
        return True
    except (socket.timeout, socket.error, OSError):
        return False


def main():
    if not CONFIG_PATH.exists():
        print(f"Config not found: {CONFIG_PATH}")
        sys.exit(1)

    cameras = load_cameras()
    if not cameras:
        print("No cameras in app.config.json")
        sys.exit(0)

    print("Camera connection check (from app.config.json)\n")
    print(f"{'Camera':<12} {'URL':<35} {'TCP 8554':<12} {'Status'}")
    print("-" * 70)

    all_ok = True
    for c in cameras:
        cam_id = c.get("id", "?")
        name = c.get("name", cam_id)
        url = c.get("url", "")
        if not url.startswith("rtsp://"):
            print(f"{cam_id:<12} {url:<35} {'N/A':<12} Invalid URL")
            all_ok = False
            continue
        try:
            part = url.replace("rtsp://", "").split("/")[0]
            host = part.split(":")[0]
            port = int(part.split(":")[1]) if ":" in part else 554
        except Exception:
            host, port = "?", 8554
        ok = check_tcp(host, port)
        if not ok:
            all_ok = False
        status = "OK" if ok else "Unreachable"
        print(f"{cam_id:<12} {url:<35} {'OK' if ok else 'FAIL':<12} {status}")

    print("-" * 70)
    print("\nNote: eth2 (camera_lan) is DOWN. Cameras use 192.168.8.x; ensure the")
    print("camera LAN interface is up and has an address in that subnet.")
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
