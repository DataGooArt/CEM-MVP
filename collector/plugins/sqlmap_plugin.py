import subprocess
import logging
import os
import re
import shutil
import tempfile
from plugins.base import BasePlugin
from plugins.katana_plugin import katana_urls_file

log = logging.getLogger(__name__)


# Regex patterns to detect confirmed/potential injections in sqlmap output
RE_INJECTABLE = re.compile(
    r"(Parameter|injection point|is vulnerable|injectable)", re.IGNORECASE
)
RE_TECHNIQUE = re.compile(
    r"Type:\s+(.+)", re.IGNORECASE
)
RE_PARAMETER = re.compile(
    r"Parameter:\s+(.+?)\s", re.IGNORECASE
)

# SQL injection technique → severity
TECHNIQUE_SEVERITY = {
    "boolean-based blind":    "HIGH",
    "time-based blind":       "HIGH",
    "error-based":            "CRITICAL",
    "union query":            "CRITICAL",
    "stacked queries":        "CRITICAL",
    "inline queries":         "HIGH",
}


class SqlmapPlugin(BasePlugin):
    name = "sqlmap"
    description = "Automated SQL injection detection"

    def run(self, target: dict, config: dict) -> list[dict]:
        host = target["host"]
        timeout = config.get("timeout", 600)
        findings = []

        # ── Pipeline: prefer parameterized URLs from katana ─────────────────────
        pipeline_file = katana_urls_file(host)
        if os.path.exists(pipeline_file):
            try:
                with open(pipeline_file) as f:
                    urls = [l.strip() for l in f if l.strip()]
                log.info(f"sqlmap: using {len(urls)} URLs from katana pipeline")
            except OSError:
                urls = [f"https://{host}"]
        else:
            # No katana pipeline — crawl from scratch via sqlmap's own --crawl
            urls = [f"https://{host}"]
            log.info(f"sqlmap: no katana pipeline file found, will use --crawl=2")

        out_dir = tempfile.mkdtemp(prefix="sqlmap_")
        try:
            for url in urls:
                cmd = [
                    "python3", "/opt/sqlmap/sqlmap.py",
                    "-u", url,
                    "--batch",
                    "--forms",
                    "--level=1",
                    "--risk=1",
                    "--output-dir", out_dir,
                    "--technique=BEUST",
                    "--threads=3",
                    "--timeout=10",
                    "--retries=1",
                    "-v", "0",
                ]
                # Only add --crawl when scanning from base host (no params yet)
                if "?" not in url:
                    cmd += ["--crawl=2"]

                try:
                    result = subprocess.run(
                        cmd, capture_output=True, text=True, timeout=timeout
                    )
                except subprocess.TimeoutExpired:
                    log.warning(f"sqlmap timed out on {url}")
                    continue
                except FileNotFoundError:
                    log.error("sqlmap (python3 /opt/sqlmap/sqlmap.py) not found")
                    break

                output = result.stdout + result.stderr
                self._parse_sqlmap_output(host, url, output, findings)

                # Also parse per-target log files under out_dir
                for dirpath, _, filenames in os.walk(out_dir):
                    for fname in filenames:
                        if fname == "log":
                            try:
                                with open(os.path.join(dirpath, fname)) as f:
                                    self._parse_sqlmap_output(host, url, f.read(), findings)
                            except OSError:
                                pass

        finally:
            shutil.rmtree(out_dir, ignore_errors=True)
            # Clean up the pipeline file — sqlmap is always last to use it
            try:
                os.unlink(pipeline_file)
            except OSError:
                pass

        # Deduplicate
        seen: set[str] = set()
        unique = []
        for f in findings:
            key = f["title"]
            if key not in seen:
                seen.add(key)
                unique.append(f)
        return unique

    def _parse_sqlmap_output(
        self, host: str, url: str, output: str, findings: list
    ) -> None:
        if not RE_INJECTABLE.search(output):
            return

        lines = output.splitlines()
        current_param = ""
        current_techniques: list[str] = []

        for line in lines:
            line = line.strip()

            pm = RE_PARAMETER.search(line)
            if pm:
                current_param = pm.group(1).strip()
                current_techniques = []

            tm = RE_TECHNIQUE.search(line)
            if tm:
                current_techniques.append(tm.group(1).strip())

            if "injectable" in line.lower() or "is vulnerable" in line.lower():
                sev = "HIGH"
                for tech in current_techniques:
                    for key, s in TECHNIQUE_SEVERITY.items():
                        if key in tech.lower():
                            sev = s if s == "CRITICAL" or sev != "CRITICAL" else sev

                param_label = f" parámetro '{current_param}'" if current_param else ""
                findings.append(self._finding(
                    asset_id=host,
                    title=f"SQL Injection detectado en{param_label}",
                    severity=sev,
                    category="VULNERABILITY",
                    source_tool="sqlmap",
                    description=(
                        f"Inyección SQL confirmada en {url}{param_label}. "
                        f"Técnicas: {', '.join(current_techniques) or 'no especificada'}."
                    ),
                    evidence={
                        "url": url,
                        "parameter": current_param,
                        "techniques": current_techniques,
                    },
                ))
