import subprocess
import json
import logging
from plugins.base import BasePlugin

log = logging.getLogger(__name__)


class SubfinderPlugin(BasePlugin):
    name = "subfinder"
    description = "Passive subdomain discovery via public sources"

    def run(self, target: dict, config: dict) -> list[dict]:
        host = target["host"]
        timeout = config.get("timeout", 120)
        findings = []

        cmd = [
            "subfinder",
            "-d", host,
            "-json",
            "-silent",
            "-t", str(config.get("threads", 10)),
            "-timeout", str(timeout),
        ]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 30)
        except subprocess.TimeoutExpired:
            log.warning(f"subfinder timed out against {host}")
            return []
        except FileNotFoundError:
            log.error("subfinder binary not found")
            return []

        seen = set()
        for line in result.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue

            subdomain = item.get("host", "").strip().lower()
            if not subdomain or subdomain == host or subdomain in seen:
                continue
            seen.add(subdomain)

            source = item.get("source", "unknown")
            ip = item.get("ip", "")

            findings.append(self._finding(
                asset_id=host,
                title=f"Subdominio descubierto: {subdomain}",
                severity="INFO",
                category="ASSET_DISCOVERY",
                source_tool="subfinder",
                description=(
                    f"Subdominio '{subdomain}' descubierto via enumeración pasiva de DNS. "
                    f"Fuente: {source}."
                ),
                evidence={"subdomain": subdomain, "source": source, "ip": ip},
            ))

        return findings
