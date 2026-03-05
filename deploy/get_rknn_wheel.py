"""
Query GitHub API to find and print the download URL for the correct
rknn-toolkit2 wheel for the current Python version.

Usage:
  For Docker (x86_64 conversion tool):
    pip install $(python3 get_rknn_wheel.py x86_64)

  For device (aarch64 inference runtime):
    pip install $(python3 get_rknn_wheel.py aarch64)
"""
import json
import sys
import urllib.request

GITHUB_API = "https://api.github.com/repos/airockchip/rknn-toolkit2/contents"

# x86_64 = rknn-toolkit2 (conversion), aarch64 = rknn-toolkit-lite2 (inference)
ARCH_MAP = {
    "x86_64": "rknn-toolkit2/packages/x86_64",
    "aarch64": "rknn-toolkit-lite2/packages",
}

arch = sys.argv[1] if len(sys.argv) > 1 else "x86_64"
if arch not in ARCH_MAP:
    print(f"ERROR: arch must be x86_64 or aarch64, got {arch}", file=sys.stderr)
    sys.exit(1)

api_url = f"{GITHUB_API}/{ARCH_MAP[arch]}"
py_tag = f"cp{sys.version_info.major}{sys.version_info.minor}"

print(f"Querying: {api_url}", file=sys.stderr)
print(f"Python:   {py_tag}  arch: {arch}", file=sys.stderr)

req = urllib.request.Request(
    api_url,
    headers={"Accept": "application/vnd.github.v3+json", "User-Agent": "rknn-export"},
)
try:
    files = json.loads(urllib.request.urlopen(req, timeout=30).read())
except Exception as e:
    print(f"ERROR: GitHub API request failed: {e}", file=sys.stderr)
    sys.exit(1)

# Find the wheel matching our Python version and architecture
wheel = next(
    (f for f in files
     if f["name"].endswith(".whl") and py_tag in f["name"]),
    None,
)

if not wheel:
    available = [f["name"] for f in files if f["name"].endswith(".whl")]
    print(f"ERROR: No wheel found for {py_tag} {arch}", file=sys.stderr)
    print(f"Available: {available}", file=sys.stderr)
    sys.exit(1)

print(f"Found:    {wheel['name']}", file=sys.stderr)
print(wheel["download_url"])  # stdout — captured by pip install $(...)
