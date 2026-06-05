import subprocess
import json
import logging
import os
from plugins.base import BasePlugin

log = logging.getLogger(__name__)

# Paths and extensions that indicate security-relevant findings
SENSITIVE_PATHS = {
    '.git', '.env', '.htaccess', '.htpasswd', 'admin', 'administrator',
    'backup', 'config', 'debug', 'secret', 'private', 'api', 'swagger',
    'phpinfo', 'phpmyadmin', 'wp-admin', 'wp-login', 'wp-config',
    'database', 'db', 'dump', 'sql', 'log', 'logs', 'temp', 'tmp',
    'test', 'dev', 'staging', 'console', 'actuator', 'metrics', 'health',
    'graphql', 'graphiql', '.DS_Store', 'web.config', 'crossdomain.xml',
}

SENSITIVE_EXTS = {'.php', '.bak', '.sql', '.env', '.xml', '.json', '.log',
                  '.config', '.old', '.zip', '.tar', '.gz', '.war', '.jar'}


def _classify(path: str, status: int) -> str:
    p = path.lower().strip('/')
    ext = os.path.splitext(p)[1]
    if any(s in p for s in SENSITIVE_PATHS) or ext in SENSITIVE_EXTS:
        return 'HIGH'
    if status in (401, 403):
        return 'MEDIUM'
    return 'LOW'


class FfufPlugin(BasePlugin):
    name = "ffuf"
    description = "Fast web fuzzer — directory/file discovery (deep profile)"

    def run(self, target: dict, config: dict) -> list[dict]:
        host = target["host"]
        wordlist = config.get("wordlist", "/app/wordlists/common.txt")
        threads = config.get("threads", 40)
        out_file = "/tmp/ffuf_out.json"
        findings = []

        # Wordlist fallback chain (Debian: /usr/share/dirb/wordlists/, NOT Kali: /usr/share/wordlists/dirb/)
        for wl in [wordlist, "/app/wordlists/common.txt", "/usr/share/dirb/wordlists/common.txt", "/usr/share/wordlists/dirb/common.txt"]:
            if os.path.exists(wl):
                wordlist = wl
                break
        else:
            log.error(f"ffuf: no wordlist available for {host} — checked: {wordlist}, /app/wordlists/common.txt, /usr/share/dirb/wordlists/common.txt")
            return []  # No wordlist available

        cmd = [
            "ffuf",
            "-u", f"https://{host}/FUZZ",
            "-w", wordlist,
            "-t", str(threads),
            "-mc", "200,204,301,302,401,403,405",
            "-ac",           # auto-calibrate to suppress false positives
            "-of", "json",
            "-o", out_file,
            "-s",            # silent — no progress banner
            "-timeout", "10",
        ]

        try:
            subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        except subprocess.TimeoutExpired:
            log.info(f"ffuf: timeout reached for {host}, parsing partial results")
        except FileNotFoundError:
            log.error("ffuf binary not found")
            return []

        try:
            with open(out_file) as f:
                data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError) as e:
            log.warning(f"ffuf: could not parse output for {host}: {e}")
            return []

        seen = set()
        for item in data.get("results", []):
            url    = item.get("url", "")
            status = item.get("status", 200)
            path   = "/" + item.get("input", {}).get("FUZZ", "")
            length = item.get("length", 0)
            words  = item.get("words", 0)

            if path in seen:
                continue
            seen.add(path)

            severity = _classify(path, status)
            findings.append(self._finding(
                asset_id=host,
                title=f"Ruta descubierta: {path} (HTTP {status})",
                severity=severity,
                category="EXPOSURE",
                source_tool="ffuf",
                description=(
                    f"ffuf descubrió {url} con respuesta HTTP {status} "
                    f"({length} bytes, {words} palabras). "
                    "Verificar si la ruta debe ser accesible públicamente."
                ),
                evidence={"path": path, "status": status, "url": url, "length": length},
            ))

        return findings
