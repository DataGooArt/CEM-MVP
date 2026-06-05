import subprocess
import logging
from plugins.base import BasePlugin

log = logging.getLogger(__name__)


class GobusterPlugin(BasePlugin):
    name = "gobuster"
    description = "Directory and file brute-forcing"

    def run(self, target: dict, config: dict) -> list[dict]:
        host = target["host"]
        wordlist = config.get("wordlist", "/app/wordlists/common.txt")
        extensions = config.get("extensions", "php,html,js,txt")
        findings = []

        # Wordlist fallback chain (Debian: /usr/share/dirb/wordlists/, NOT Kali: /usr/share/wordlists/dirb/)
        import os
        for wl in [wordlist, "/app/wordlists/common.txt", "/usr/share/dirb/wordlists/common.txt", "/usr/share/wordlists/dirb/common.txt"]:
            if os.path.exists(wl):
                wordlist = wl
                break
        else:
            log.error(f"gobuster: no wordlist available for {host} — checked: {wordlist}, /app/wordlists/common.txt, /usr/share/dirb/wordlists/common.txt")
            return []

        threads = config.get("threads", 30)
        cmd = [
            "gobuster", "dir",
            "-u", f"https://{host}",
            "-w", wordlist,
            "-x", extensions,
            "-t", str(threads),
            "-o", "/tmp/gobuster_out.txt",
            "-q", "--no-color",
        ]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        except subprocess.TimeoutExpired:
            log.warning(f"gobuster timed out against {host}")
            return []
        except FileNotFoundError:
            log.error("gobuster binary not found")
            return []

        interesting_extensions = {".php", ".bak", ".sql", ".env", ".config", ".xml", ".json", ".log"}
        sensitive_paths = {"admin", "backup", "config", "secret", "private", ".git", ".env", "debug", "test"}

        try:
            with open("/tmp/gobuster_out.txt") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("=") or line.startswith("/usr"):
                        continue

                    path = line.split()[0] if line.split() else line
                    status = line.split()[1].strip("()") if len(line.split()) > 1 else "200"

                    ext = "." + path.rsplit(".", 1)[-1] if "." in path else ""
                    path_lower = path.lower()

                    severity = "INFO"
                    if ext in interesting_extensions or any(s in path_lower for s in sensitive_paths):
                        severity = "HIGH"
                    elif status in ("200", "301", "302"):
                        severity = "LOW"

                    findings.append(self._finding(
                        asset_id=host,
                        title=f"Exposed path: {path}",
                        severity=severity,
                        category="EXPOSURE",
                        source_tool="gobuster",
                        description=f"HTTP {status} on {path}",
                        evidence={"path": path, "status_code": status},
                    ))
        except FileNotFoundError:
            log.warning(f"gobuster: output file not found for {host}")

        return findings
