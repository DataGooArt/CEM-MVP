import subprocess
import json
import logging
from plugins.base import BasePlugin

log = logging.getLogger(__name__)

SEVERITY_MAP = {
    "critical": "CRITICAL",
    "high": "HIGH",
    "medium": "MEDIUM",
    "low": "LOW",
    "info": "INFO",
    "unknown": "INFO",
}

CATEGORY_MAP = {
    "cves": "VULNERABILITY",
    "misconfigurations": "MISCONFIGURATION",
    "exposures": "EXPOSURE",
    "technologies": "ASSET_DISCOVERY",
    "default-logins": "VULNERABILITY",
    "takeovers": "EXPOSURE",
    "network": "VULNERABILITY",
}


class NucleiPlugin(BasePlugin):
    name = "nuclei"
    description = "Template-based vulnerability scanner"

    def run(self, target: dict, config: dict) -> list[dict]:
        host = target["host"]
        templates = config.get("templates", ["cves", "misconfigurations", "exposures"])
        severity_filter = config.get("severity", ["critical", "high", "medium"])
        findings = []

        tags_arg = ",".join(templates)
        sev_arg = ",".join(severity_filter)

        rate_limit = config.get("rate_limit", 100)
        cmd = [
            "nuclei",
            "-u", f"https://{host}",
            "-tags", tags_arg,
            "-severity", sev_arg,
            "-rate-limit", str(rate_limit),
            "-json-export", "/tmp/nuclei_out.json",
            "-silent",
            "-no-color",
        ]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        except subprocess.TimeoutExpired:
            log.warning(f"nuclei timed out against {host}")
            return []
        except FileNotFoundError:
            log.error("nuclei binary not found")
            return []

        try:
            with open("/tmp/nuclei_out.json") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        item = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    if not isinstance(item, dict):
                        continue

                    info = item.get("info", {})
                    template_id = item.get("template-id", "")
                    severity = SEVERITY_MAP.get(info.get("severity", "info").lower(), "INFO")
                    tags = info.get("tags", [])
                    category = "VULNERABILITY"
                    for tag in (tags if isinstance(tags, list) else tags.split(",")):
                        if tag in CATEGORY_MAP:
                            category = CATEGORY_MAP[tag]
                            break

                    cve = None
                    cvss = None
                    classification = info.get("classification", {})
                    cve_ids = classification.get("cve-id", [])
                    if cve_ids:
                        cve = cve_ids[0] if isinstance(cve_ids, list) else cve_ids
                    cvss_score = classification.get("cvss-score")
                    if cvss_score:
                        try:
                            cvss = float(cvss_score)
                        except (ValueError, TypeError):
                            pass

                    findings.append(self._finding(
                        asset_id=host,
                        title=info.get("name", template_id),
                        severity=severity,
                        category=category,
                        source_tool="nuclei",
                        description=info.get("description", ""),
                        cve=cve,
                        cvss=cvss,
                        evidence={
                            "template": template_id,
                            "matched_at": item.get("matched-at", ""),
                            "extracted_results": item.get("extracted-results", []),
                            "curl_command": item.get("curl-command", ""),
                            "tags": tags,
                        },
                    ))
        except FileNotFoundError:
            log.warning(f"nuclei: output file not found for {host} (no findings or crash)")

        return findings
