import subprocess
import json
import logging
import re
from plugins.base import BasePlugin

log = logging.getLogger(__name__)


def katana_urls_file(host: str) -> str:
    """Return the path to the shared URL pipeline file for this host.
    Written by KatanaPlugin, consumed by DalfoxPlugin and SqlmapPlugin."""
    return f"/tmp/katana_urls_{host.replace('.', '_').replace('/', '_')}.txt"


# URL path patterns that are interesting security-wise
SENSITIVE_PATH_RE = re.compile(
    r"/(admin|login|dashboard|wp-admin|phpmyadmin|cpanel|manager|console|"
    r"backup|\.git|\.env|config|api|swagger|graphql|actuator|debug|"
    r"setup|install|upload|uploads|files|private|secret|internal)",
    re.IGNORECASE,
)

# File extensions that indicate sensitive data
SENSITIVE_EXT_RE = re.compile(
    r"\.(sql|bak|backup|log|config|conf|cfg|env|old|key|pem|p12|pfx|"
    r"zip|tar|gz|7z|rar|dump|db|sqlite)$",
    re.IGNORECASE,
)


def _endpoint_severity(url: str) -> tuple[str, str]:
    """Return (severity, reason) based on URL content."""
    path = url.split("?")[0].lower()
    if SENSITIVE_EXT_RE.search(path):
        return ("HIGH", "Archivo sensible expuesto (backup/config/credencial)")
    if SENSITIVE_PATH_RE.search(path):
        return ("MEDIUM", "Ruta sensible descubierta (panel admin/API/config)")
    return ("INFO", "Endpoint descubierto durante rastreo web")


class KatanaPlugin(BasePlugin):
    name = "katana"
    description = "Fast web crawler for endpoint and attack-surface discovery"

    def run(self, target: dict, config: dict) -> list[dict]:
        host = target["host"]
        depth = config.get("depth", 3)
        timeout = config.get("timeout", 300)
        max_urls = config.get("max_urls", 500)
        findings = []

        cmd = [
            "katana",
            "-u", f"https://{host}",
            "-d", str(depth),
            "-jc",               # include JS parsing
            "-json",
            "-silent",
            "-nc",               # no color
            "-timeout", str(timeout),
            "-max-response-size", "5242880",  # 5 MB max per page
        ]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 60)
        except subprocess.TimeoutExpired:
            log.warning(f"katana timed out against {host}")
            return []
        except FileNotFoundError:
            log.error("katana binary not found")
            return []

        seen_urls: set[str] = set()
        findings_count = 0

        for line in result.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                # katana sometimes outputs raw URLs without JSON in certain modes
                url = line if line.startswith("http") else ""
                if not url:
                    continue
                item = {"request": {"endpoint": url}}

            endpoint = (
                item.get("request", {}).get("endpoint", "")
                or item.get("endpoint", "")
                or item.get("url", "")
            )

            if not endpoint or endpoint in seen_urls:
                continue

            # Only report URLs from this host
            if host not in endpoint:
                continue

            seen_urls.add(endpoint)

            severity, reason = _endpoint_severity(endpoint)

            # Limit findings volume but always collect all URLs for the pipeline
            if findings_count >= max_urls:
                continue
            if severity == "INFO" and findings_count > 200:
                continue
            findings_count += 1

            findings.append(self._finding(
                asset_id=host,
                title=f"Endpoint descubierto: {endpoint[:120]}",
                severity=severity,
                category="ASSET_DISCOVERY" if severity == "INFO" else "EXPOSURE",
                source_tool="katana",
                description=f"{reason}: {endpoint}",
                evidence={"url": endpoint},
            ))

        # ── Pipeline: write parameterized URLs for dalfox / sqlmap ──────────────
        # URLs with query strings are the most useful injection targets.
        param_urls = [u for u in seen_urls if "?" in u]
        pipeline_file = katana_urls_file(host)
        if param_urls:
            try:
                with open(pipeline_file, "w") as f:
                    f.write("\n".join(param_urls))
                log.info(f"katana: wrote {len(param_urls)} parameterized URLs to {pipeline_file}")
            except OSError as e:
                log.warning(f"katana: could not write pipeline file: {e}")
        else:
            log.info(f"katana: no parameterized URLs found for {host} — dalfox/sqlmap will use base URL")

        return findings
