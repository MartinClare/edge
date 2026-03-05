"""IP Camera Scanner - Discover RTSP cameras on the network."""

import cv2
import socket
import asyncio
import ipaddress
from typing import List, Dict, Optional
from concurrent.futures import ThreadPoolExecutor
import time


class CameraScanner:
    """Scan network for IP cameras and test RTSP connections."""
    
    # Common RTSP ports
    RTSP_PORTS = [554, 8554, 80, 8080]
    
    # Common RTSP paths by manufacturer
    RTSP_PATHS = [
        "/Streaming/Channels/1",           # Hikvision main stream
        "/Streaming/Channels/101",         # Hikvision sub stream
        "/Streaming/Channels/102",         # Hikvision sub stream 2
        "/cam/realmonitor?channel=1&subtype=0",  # Dahua
        "/h264/ch1/main/av_stream",        # Generic H.264 main
        "/h264/ch1/sub/av_stream",         # Generic H.264 sub
        "/live",                           # Generic
        "/stream",                         # Generic
        "/video1",                         # Generic
        "/video",                          # Generic
        "/axis-media/media.amp",           # Axis
        "/mpeg4",                          # Old Axis
        "/",                               # Root path
        "/1",                              # Simple path
        "/11"                              # Simple path
    ]
    
    def __init__(self, network_prefix: str = "192.168.1", 
                 username: str = "admin", 
                 password: str = "123456"):
        self.network_prefix = network_prefix
        self.username = username
        self.password = password
        
    async def scan_network(self) -> List[Dict]:
        """Scan network and discover working cameras."""
        print(f"[Scanner] Starting scan on {self.network_prefix}.0/24")
        
        # Step 1: Find active hosts
        active_hosts = await self._find_active_hosts()
        print(f"[Scanner] Found {len(active_hosts)} active hosts")
        
        # Step 2: Check for open RTSP ports
        hosts_with_rtsp = await self._check_rtsp_ports(active_hosts)
        print(f"[Scanner] Found {len(hosts_with_rtsp)} hosts with open RTSP ports")
        
        # Step 3: Test RTSP connections
        cameras = await self._test_rtsp_connections(hosts_with_rtsp)
        print(f"[Scanner] Found {len(cameras)} working cameras")
        
        return cameras
    
    async def _find_active_hosts(self) -> List[str]:
        """Ping sweep to find active hosts."""
        active_hosts = []
        
        # Use ThreadPoolExecutor for parallel pinging
        with ThreadPoolExecutor(max_workers=50) as executor:
            loop = asyncio.get_event_loop()
            tasks = []
            
            for i in range(1, 255):
                ip = f"{self.network_prefix}.{i}"
                tasks.append(loop.run_in_executor(executor, self._ping_host, ip))
            
            results = await asyncio.gather(*tasks)
            active_hosts = [ip for ip in results if ip is not None]
        
        return active_hosts
    
    def _ping_host(self, ip: str) -> Optional[str]:
        """Check if host is reachable (fast TCP check on common ports)."""
        # Instead of ICMP ping (requires admin), try TCP on common ports
        common_ports = [80, 554, 8080, 8554]
        
        for port in common_ports:
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(0.5)
                result = sock.connect_ex((ip, port))
                sock.close()
                
                if result == 0:
                    return ip  # Host is active
            except:
                pass
        
        return None
    
    async def _check_rtsp_ports(self, hosts: List[str]) -> List[Dict]:
        """Check which hosts have open RTSP ports."""
        hosts_with_ports = []
        
        with ThreadPoolExecutor(max_workers=20) as executor:
            loop = asyncio.get_event_loop()
            tasks = []
            
            for host in hosts:
                for port in self.RTSP_PORTS:
                    tasks.append(loop.run_in_executor(
                        executor, self._check_port, host, port
                    ))
            
            results = await asyncio.gather(*tasks)
            hosts_with_ports = [r for r in results if r is not None]
        
        return hosts_with_ports
    
    def _check_port(self, ip: str, port: int) -> Optional[Dict]:
        """Check if a specific port is open."""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1.0)
            result = sock.connect_ex((ip, port))
            sock.close()
            
            if result == 0:
                return {"ip": ip, "port": port}
        except:
            pass
        
        return None
    
    async def _test_rtsp_connections(self, hosts_ports: List[Dict]) -> List[Dict]:
        """Test RTSP connections with various paths."""
        cameras = []
        
        with ThreadPoolExecutor(max_workers=5) as executor:
            loop = asyncio.get_event_loop()
            tasks = []
            
            for hp in hosts_ports:
                for path in self.RTSP_PATHS:
                    url = f"rtsp://{self.username}:{self.password}@{hp['ip']}:{hp['port']}{path}"
                    tasks.append(loop.run_in_executor(
                        executor, self._test_rtsp_url, url, hp['ip'], hp['port'], path
                    ))
            
            results = await asyncio.gather(*tasks)
            
            # Remove duplicates (same IP, keep first working path)
            seen_ips = set()
            for result in results:
                if result and result['ip'] not in seen_ips:
                    cameras.append(result)
                    seen_ips.add(result['ip'])
        
        return cameras
    
    def _test_rtsp_url(self, url: str, ip: str, port: int, path: str) -> Optional[Dict]:
        """Test a specific RTSP URL."""
        try:
            cap = cv2.VideoCapture(url)
            
            if not cap.isOpened():
                return None
            
            # Try to read a frame
            ret, frame = cap.read()
            
            if not ret or frame is None:
                cap.release()
                return None
            
            # Get stream properties
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = cap.get(cv2.CAP_PROP_FPS) or 0
            
            # Detect codec
            fourcc = int(cap.get(cv2.CAP_PROP_FOURCC))
            codec = "".join([chr((fourcc >> 8 * i) & 0xFF) for i in range(4)])
            
            cap.release()
            
            print(f"[Scanner] ✅ Found camera: {ip}:{port}{path} - {width}x{height}")
            
            return {
                "ip": ip,
                "port": port,
                "path": path,
                "url": url,
                "width": width,
                "height": height,
                "fps": fps,
                "codec": codec,
                "resolution": f"{width}x{height}"
            }
            
        except Exception as e:
            return None


async def scan_cameras(network_prefix: str = "192.168.1",
                      username: str = "admin",
                      password: str = "123456") -> List[Dict]:
    """
    Scan network for IP cameras.
    
    Args:
        network_prefix: Network prefix (e.g., "192.168.1")
        username: RTSP username
        password: RTSP password
        
    Returns:
        List of discovered cameras with their properties
    """
    scanner = CameraScanner(network_prefix, username, password)
    return await scanner.scan_network()
