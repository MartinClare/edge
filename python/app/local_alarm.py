"""
Local Alarm Trigger
Provides local alarm functionality including sound, visual alerts, and desktop notifications.
"""

import os
import sys
import time
import threading
import subprocess
import platform
from pathlib import Path
from typing import Optional, Dict, Any
import logging

logger = logging.getLogger(__name__)


class LocalAlarmTrigger:
    """
    Local alarm trigger for sound, visual, and desktop notifications.
    """
    
    def __init__(self, config: Dict[str, Any]):
        """Initialize local alarm trigger with configuration"""
        self.config = config
        self.is_playing = False
        self._stop_event = threading.Event()
        
    def trigger_sound_alarm(self, duration: int = 5, repeat: int = 3, interval: int = 2):
        """
        Trigger sound alarm.
        
        Args:
            duration: Duration of each beep in seconds
            repeat: Number of times to repeat
            interval: Interval between beeps in seconds
        """
        if self.is_playing:
            logger.warning("Sound alarm already playing")
            return
        
        self.is_playing = True
        self._stop_event.clear()
        
        def _play_sound():
            try:
                system = platform.system()
                
                for i in range(repeat):
                    if self._stop_event.is_set():
                        break
                    
                    if system == 'Windows':
                        # Windows: Use winsound or PowerShell
                        try:
                            import winsound
                            # Beep at 1000Hz for duration seconds
                            winsound.Beep(1000, duration * 1000)
                        except ImportError:
                            # Fallback to PowerShell
                            subprocess.run(
                                ['powershell', '-command', 
                                 f'[console]::Beep(1000, {duration * 1000})'],
                                check=False,
                                capture_output=True
                            )
                    
                    elif system == 'Darwin':  # macOS
                        # macOS: Use afplay or say
                        subprocess.run(
                            ['say', 'Alert! Safety risk detected!'],
                            check=False,
                            capture_output=True
                        )
                    
                    elif system == 'Linux':
                        # Linux: Use beep command or speaker-test
                        subprocess.run(
                            ['beep', '-f', '1000', '-l', str(duration * 1000)],
                            check=False,
                            capture_output=True
                        )
                    
                    if i < repeat - 1 and not self._stop_event.is_set():
                        time.sleep(interval)
                
                logger.info(f"🔊 Sound alarm played ({repeat} times)")
                
            except Exception as e:
                logger.error(f"Error playing sound alarm: {e}")
            finally:
                self.is_playing = False
        
        # Play in background thread
        thread = threading.Thread(target=_play_sound, daemon=True)
        thread.start()
    
    def trigger_desktop_notification(self, title: str, message: str, 
                                     urgency: str = 'critical', timeout: int = 0):
        """
        Trigger desktop notification.
        
        Args:
            title: Notification title
            message: Notification message
            urgency: Urgency level (low, normal, critical)
            timeout: Timeout in seconds (0 = no timeout)
        """
        try:
            system = platform.system()
            
            if system == 'Windows':
                # Windows: Use PowerShell for toast notification
                ps_script = f'''
                Add-Type -AssemblyName System.Windows.Forms
                
                $notification = New-Object System.Windows.Forms.NotifyIcon
                $notification.Icon = [System.Drawing.SystemIcons]::Warning
                $notification.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Warning
                $notification.BalloonTipTitle = "{title}"
                $notification.BalloonTipText = "{message}"
                $notification.Visible = $true
                $notification.ShowBalloonTip({timeout * 1000})
                
                Start-Sleep -Seconds {max(timeout, 5)}
                $notification.Dispose()
                '''
                
                subprocess.run(
                    ['powershell', '-command', ps_script],
                    check=False,
                    capture_output=True
                )
                
            elif system == 'Darwin':  # macOS
                # macOS: Use osascript
                script = f'display notification "{message}" with title "{title}" sound name "Glass"'
                subprocess.run(
                    ['osascript', '-e', script],
                    check=False,
                    capture_output=True
                )
                
            elif system == 'Linux':
                # Linux: Use notify-send
                subprocess.run(
                    ['notify-send', '-u', urgency, title, message],
                    check=False,
                    capture_output=True
                )
            
            logger.info(f"🖥️ Desktop notification sent: {title}")
            
        except Exception as e:
            logger.error(f"Error sending desktop notification: {e}")
    
    def trigger_visual_alert(self, message: str, color: str = 'red'):
        """
        Trigger visual alert (for integration with frontend).
        
        Args:
            message: Alert message
            color: Alert color
        """
        # This would typically send a WebSocket message to the frontend
        alert_data = {
            'type': 'visual_alert',
            'message': message,
            'color': color,
            'timestamp': time.time()
        }
        
        logger.info(f"💡 Visual alert: {message}")
        return alert_data
    
    def stop_alarm(self):
        """Stop any ongoing alarm"""
        self._stop_event.set()
        self.is_playing = False
        logger.info("Alarm stopped")
    
    def test_alarm(self):
        """Test the alarm system"""
        logger.info("🧪 Testing alarm system...")
        
        # Test sound
        self.trigger_sound_alarm(duration=1, repeat=2, interval=1)
        time.sleep(3)
        
        # Test notification
        self.trigger_desktop_notification(
            title="🧪 Test Alert",
            message="This is a test notification",
            timeout=5
        )
        
        logger.info("✅ Alarm test completed")


def create_alarm_sound_file(output_path: str = "alarm.wav", duration: float = 2.0, frequency: int = 800):
    """
    Create an alarm sound file using Python.
    
    Args:
        output_path: Path to save the sound file
        duration: Duration in seconds
        frequency: Frequency in Hz
    """
    try:
        import numpy as np
        from scipy.io import wavfile
        
        # Generate sine wave
        sample_rate = 44100
        t = np.linspace(0, duration, int(sample_rate * duration), False)
        
        # Create alarm sound (modulated sine wave)
        tone = np.sin(2 * np.pi * frequency * t)
        
        # Add modulation for alarm effect
        modulation = np.sin(2 * np.pi * 5 * t)  # 5 Hz modulation
        alarm = tone * (0.5 + 0.5 * modulation)
        
        # Normalize to 16-bit range
        alarm = np.int16(alarm * 32767 * 0.8)
        
        # Save as WAV file
        wavfile.write(output_path, sample_rate, alarm)
        
        logger.info(f"✅ Alarm sound file created: {output_path}")
        return True
        
    except ImportError:
        logger.warning("numpy/scipy not available, cannot create sound file")
        return False
    except Exception as e:
        logger.error(f"Error creating alarm sound: {e}")
        return False


if __name__ == "__main__":
    # Test the alarm system
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    config = {
        'sound': {
            'enabled': True,
            'duration': 2,
            'repeat': 3,
            'interval': 1
        },
        'desktop': {
            'enabled': True,
            'timeout': 10
        }
    }
    
    trigger = LocalAlarmTrigger(config)
    
    print("Testing alarm system...")
    print("1. Sound alarm")
    trigger.trigger_sound_alarm(duration=1, repeat=2, interval=1)
    
    time.sleep(4)
    
    print("2. Desktop notification")
    trigger.trigger_desktop_notification(
        title="🚨 Safety Alert",
        message="High risk detected on Camera 1",
        timeout=5
    )
    
    print("\nAlarm test completed!")
