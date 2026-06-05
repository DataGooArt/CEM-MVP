import subprocess
import json
import logging
import os
from plugins.base import BasePlugin

log = logging.getLogger(__name__)


class AmassPlugin(BasePlugin):
    name = "amass"
    description = "In-depth subdomain enumeration (OWASP Amass)"

    def run(self, target: dict, config: dict) -> list[dict]:
        host = target["host"]
        timeout = config.get("timeout", 600)
        out_file = f"/tmp/amass_{host.replace('.', '_')}.json"
        findings = []

        cmd = [
            "amass",
            "enum",
            "-passive",           # passive only — no active brute forcing
            "-d", host,
            "-json", out_file,
            "-timeout", str(timeout // 60),  # amass uses minutes
            "-silent",
        ]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 60)
        except subprocess.TimeoutExpired:
            log.warning(f"amass timed out against {host}")
            return []
        except FileNotFoundError:
            log.error("amass binary not found")
            return []

        if not os.path.exists(out_file):
            return []

        try:
            seen: set[str] = set()
            with open(out_file) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        item = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    name = item.get("name", "").strip().lower()
                    if not name or name == host or name in seen:
                        continue
                    seen.add(name)

                    domain = item.get("domain", host)
                    tag = item.get("tag", "dns")
                    sources = item.get("sources", [])
                    addresses = item.get("addresses", [])
                    ips = [a.get("ip", "") for a in addresses if a.get("ip")]

                    findings.append(self._finding(
                        asset_id=host,
                        title=f"Subdominio enumerado: {name}",
                        severity="INFO",
                        category="ASSET_DISCOVERY",
                        source_tool="amass",
                        description=(
                            f"Subdominio '{name}' descubierto por OWASP Amass. "
                            f"Dominio raíz: {domain}. Fuentes: {', '.join(sources) if sources else tag}."
                        ),
                        evidence={
                            "subdomain": name,
                            "domain": domain,
                            "tag": tag,
                            "sources": sources,
                            "ips": ips,
                        },
                    ))
        finally:
            try:
                os.unlink(out_file)
            except OSError:
                pass

        return findings
