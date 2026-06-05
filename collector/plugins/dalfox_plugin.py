import subprocess
import json
import logging
import os
from plugins.base import BasePlugin
from plugins.katana_plugin import katana_urls_file

log = logging.getLogger(__name__)


class DalfoxPlugin(BasePlugin):
    name = "dalfox"
    description = "XSS (Cross-Site Scripting) parameter scanner"

    def run(self, target: dict, config: dict) -> list[dict]:
        host = target["host"]
        timeout = config.get("timeout", 300)
        findings = []

        # ── Pipeline: prefer parameterized URLs from katana ─────────────────────
        pipeline_file = katana_urls_file(host)
        if os.path.exists(pipeline_file):
            try:
                with open(pipeline_file) as f:
                    urls = [l.strip() for l in f if l.strip()]
                log.info(f"dalfox: using {len(urls)} URLs from katana pipeline")
            except OSError:
                urls = [f"https://{host}"]
        else:
            urls = [f"https://{host}"]
            log.info(f"dalfox: no katana pipeline file found, scanning base URL only")

        for url in urls:
            self._scan_url(url, host, timeout, findings)

        return findings

    def _scan_url(self, url: str, host: str, timeout: int, findings: list):
        out_file = f"/tmp/dalfox_{abs(hash(url))}.json"

        cmd = [
            "dalfox",
            "url", url,
            "--format", "json",
            "--output", out_file,
            "--timeout", str(min(timeout, 300)),
            "--no-color",
            "--skip-bav",            # skip blind XSS (reduces noise/time)
            "--only-custom-payload", "false",
            "--silence",
        ]

        try:
            subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 60)
        except subprocess.TimeoutExpired:
            log.warning(f"dalfox timed out on {url}")
            return
        except FileNotFoundError:
            log.error("dalfox binary not found")
            return

        if not os.path.exists(out_file):
            return

        try:
            with open(out_file) as f:
                raw = f.read().strip()
        except OSError as e:
            log.warning(f"dalfox: could not read output for {url}: {e}")
            return
        finally:
            try:
                os.unlink(out_file)
            except OSError:
                pass

        if not raw:
            return

        try:
            items = json.loads(raw) if raw.startswith("[") else [json.loads(l) for l in raw.splitlines() if l.strip()]
        except json.JSONDecodeError as e:
            log.warning(f"dalfox: JSON parse error for {url}: {e}")
            return

        for item in items:
            if not isinstance(item, dict):
                continue

            vuln_type = item.get("type", "")  # "V" = verified, "R" = reflected, "G" = grep
            poc = item.get("poc", "")
            message = item.get("message", "")
            param = item.get("param", "")
            cve = item.get("cve", "")

            if vuln_type == "V":
                severity = "HIGH"
                title_prefix = "XSS Verificado"
            elif vuln_type == "R":
                severity = "MEDIUM"
                title_prefix = "XSS Reflejado (posible)"
            else:
                severity = "LOW"
                title_prefix = "XSS Potencial"

            title = f"{title_prefix} en parámetro '{param}'" if param else f"{title_prefix} detectado"

            finding = self._finding(
                asset_id=host,
                title=title,
                severity=severity,
                category="VULNERABILITY",
                source_tool="dalfox",
                description=(
                    f"Cross-Site Scripting detectado en {url}. "
                    f"Parámetro: {param}. {message}"
                ).strip(),
                evidence={"url": url, "type": vuln_type, "param": param, "poc": poc[:500] if poc else ""},
            )
            if cve:
                finding["cve"] = cve
            findings.append(finding)

