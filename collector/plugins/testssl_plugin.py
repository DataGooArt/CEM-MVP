import subprocess
import json
import logging
import os
from plugins.base import BasePlugin

log = logging.getLogger(__name__)


# testssl.sh severity → CEM severity (only MEDIUM and above pass through)
SEVERITY_MAP = {
    "CRITICAL": "CRITICAL",
    "HIGH":     "HIGH",
    "MEDIUM":   "MEDIUM",
    "LOW":      None,       # filtered: below MEDIUM threshold
    "OK":       None,       # skip — it's a pass
    "INFO":     None,       # filtered: informational noise
    "NOT ok":   "MEDIUM",
    "WARN":     None,       # filtered: below MEDIUM threshold
    "DEBUG":    None,
}

# testssl finding IDs that indicate serious issues
CRITICAL_IDS = {
    "BEAST", "CRIME", "POODLE_SSL", "POODLE_TLS", "FREAK", "LOGJAM",
    "DROWN", "LUCKY13", "RC4", "SWEET32", "HEARTBLEED", "CCS",
    "TICKETBLEED", "ROBOT", "RENEGOTIATION", "BREACH",
}


_NOT_VULN_PHRASES = (
    "not vulnerable",
    "not offered",
    "no ssl",
    "no tls",
    "no sslv",
    "no heartbeat",
    "no rc4",
    "no dh export",
    "no rsa key transport",
    "no gzip",
)


def _is_not_vulnerable(message: str) -> bool:
    """Return True if the testssl finding message describes a passing/clean check."""
    msg = message.lower()
    return any(phrase in msg for phrase in _NOT_VULN_PHRASES)


def _map_severity(testssl_sev: str, finding_id: str, message: str = "") -> str | None:
    # If testssl itself marked it OK/INFO/WARN/LOW → always filter, regardless of finding ID
    base = SEVERITY_MAP.get(testssl_sev.strip())
    if base is None:
        return None

    # If the message explicitly says the host is clean → filter (defence-in-depth)
    if _is_not_vulnerable(message):
        return None

    # Real problem detected: elevate known critical vuln IDs to CRITICAL
    if finding_id.upper() in CRITICAL_IDS:
        return "CRITICAL"

    return base


class TestsslPlugin(BasePlugin):
    name = "testssl"
    description = "Comprehensive TLS/SSL vulnerability scanner (testssl.sh)"

    def run(self, target: dict, config: dict) -> list[dict]:
        host = target["host"]
        port = config.get("port", 443)
        timeout = config.get("timeout", 300)
        out_file = f"/tmp/testssl_{host.replace('.', '_')}.json"
        findings = []

        cmd = [
            "testssl.sh",
            "--jsonfile", out_file,
            "--quiet",
            "--color", "0",
            "--warnings", "off",
            "--socket-timeout", "10",
            "--openssl-timeout", "5",
            f"{host}:{port}",
        ]

        # Add 60 s buffer so testssl.sh can finish writing the JSON output
        # file before the subprocess is killed (avoids empty/truncated files).
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 60)
        except subprocess.TimeoutExpired:
            log.warning(f"testssl.sh timed out against {host}:{port}")
            return []
        except FileNotFoundError:
            log.error("testssl.sh binary not found")
            return []

        if not os.path.exists(out_file):
            log.warning(
                f"testssl: output file not created for {host} "
                f"(exit={result.returncode}, stderr={result.stderr[:300]!r})"
            )
            return []

        try:
            with open(out_file) as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            log.warning(f"testssl: could not parse output for {host}: {e}")
            return []
        finally:
            try:
                os.unlink(out_file)
            except OSError:
                pass

        # testssl JSON has a "scanResult" array (v3.x) or flat array (v2.x)
        results = data if isinstance(data, list) else data.get("scanResult", [])

        seen_ids: set[str] = set()

        for item in results:
            if not isinstance(item, dict):
                continue

            finding_id = item.get("id", "")
            severity_raw = item.get("severity", "")
            message = item.get("finding", "")
            cve_raw = item.get("cve", "")

            if not message or message.lower() in ("not tested", "--"):
                continue

            severity = _map_severity(severity_raw, finding_id, message)
            if severity is None:
                continue

            dedup_key = f"{finding_id}:{message[:60]}"
            if dedup_key in seen_ids:
                continue
            seen_ids.add(dedup_key)

            cves = [c.strip() for c in cve_raw.split() if c.startswith("CVE-")]

            finding = self._finding(
                asset_id=host,
                title=f"[testssl] {finding_id}: {message[:100]}",
                severity=severity,
                category="MISCONFIGURATION",
                source_tool="testssl",
                description=message,
                evidence={"id": finding_id, "severity": severity_raw, "host": host, "port": port},
            )
            if cves:
                finding["cve"] = cves[0]
            findings.append(finding)

        return findings
