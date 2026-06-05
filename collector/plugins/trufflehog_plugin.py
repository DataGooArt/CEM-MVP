import subprocess
import json
import logging
import os
import tempfile
import shutil
import urllib.request
import urllib.error
from plugins.base import BasePlugin

log = logging.getLogger(__name__)


# URLs to fetch and scan for secrets
SCAN_PATHS = [
    "/",
    "/robots.txt",
    "/sitemap.xml",
    "/.git/config",
    "/.env",
    "/wp-config.php",
    "/config.php",
    "/config.js",
    "/app.js",
]

# TruffleHog detector type → severity
DETECTOR_SEVERITY: dict[str, str] = {
    "AWS": "CRITICAL",
    "GCP": "CRITICAL",
    "Azure": "CRITICAL",
    "PrivateKey": "CRITICAL",
    "Github": "HIGH",
    "Gitlab": "HIGH",
    "Slack": "HIGH",
    "Stripe": "HIGH",
    "SendGrid": "HIGH",
    "Twilio": "HIGH",
    "JWT": "HIGH",
    "GenericApiKey": "MEDIUM",
}


def _fetch(url: str, timeout: int = 10) -> bytes | None:
    """Fetch URL content; return None on any error."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read(524288)  # max 512 KB per file
    except Exception:
        return None


class TrufflehogPlugin(BasePlugin):
    name = "trufflehog"
    description = "Detect secrets and credentials exposed in web-accessible files"

    def run(self, target: dict, config: dict) -> list[dict]:
        host = target["host"]
        timeout = config.get("timeout", 120)
        findings = []

        scan_dir = tempfile.mkdtemp(prefix="trufflehog_")

        try:
            # ── Download web-accessible files ─────────────────────────────
            for path in SCAN_PATHS:
                for scheme in ("https", "http"):
                    content = _fetch(f"{scheme}://{host}{path}", timeout=10)
                    if content:
                        safe_name = path.strip("/").replace("/", "_") or "index"
                        fpath = os.path.join(scan_dir, f"{safe_name}.txt")
                        with open(fpath, "wb") as fh:
                            fh.write(content)
                        break  # got content, no need to try http

            if not os.listdir(scan_dir):
                return []

            # ── Run trufflehog filesystem scan ────────────────────────────
            cmd = [
                "trufflehog",
                "filesystem",
                scan_dir,
                "--json",
                "--no-update",
                "--concurrency", "4",
            ]

            try:
                result = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=timeout
                )
            except subprocess.TimeoutExpired:
                log.warning(f"trufflehog timed out on {host}")
                return []
            except FileNotFoundError:
                log.error("trufflehog binary not found")
                return []

            # ── Parse JSONL output ────────────────────────────────────────
            seen: set[str] = set()
            for line in result.stdout.splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    continue

                detector = item.get("DetectorName", item.get("detector_name", "Unknown"))
                verified = item.get("Verified", item.get("verified", False))
                raw = item.get("Redacted", item.get("redacted", item.get("Raw", "")))
                source_file = ""

                # Extract source file from metadata
                meta = item.get("SourceMetadata", {}).get("Data", {})
                for source_type in meta.values():
                    if isinstance(source_type, dict):
                        source_file = source_type.get("file", "")
                        break

                dedup_key = f"{detector}:{raw[:40]}"
                if dedup_key in seen:
                    continue
                seen.add(dedup_key)

                severity = DETECTOR_SEVERITY.get(detector, "MEDIUM")
                if not verified:
                    # Downgrade unverified findings
                    sev_order = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]
                    idx = sev_order.index(severity) if severity in sev_order else 2
                    severity = sev_order[min(idx + 1, len(sev_order) - 1)]

                verified_label = "verificado" if verified else "no verificado"
                findings.append(self._finding(
                    asset_id=host,
                    title=f"Secreto expuesto: {detector} ({verified_label})",
                    severity=severity,
                    category="EXPOSURE",
                    source_tool="trufflehog",
                    description=(
                        f"Credencial/secreto de tipo '{detector}' encontrado en archivos "
                        f"web-accesibles de {host}. "
                        f"Archivo: {source_file or 'desconocido'}. "
                        f"Estado de verificación: {verified_label}."
                    ),
                    evidence={
                        "detector": detector,
                        "verified": verified,
                        "redacted": raw[:80] if raw else "",
                        "source_file": source_file,
                    },
                ))

        finally:
            shutil.rmtree(scan_dir, ignore_errors=True)

        return findings
