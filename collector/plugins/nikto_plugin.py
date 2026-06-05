import subprocess
import logging
import re
from plugins.base import BasePlugin

log = logging.getLogger(__name__)

CVE_RE = re.compile(r'(CVE-\d{4}-\d+)', re.IGNORECASE)

# Keywords that indicate higher severity findings
CRITICAL_KW = ['sql injection', 'sqli', 'remote code execution', 'rce', 'command injection',
                'auth bypass', 'arbitrary file', 'unauthenticated', 'unrestricted upload']
HIGH_KW = ['xss', 'cross-site scripting', 'file inclusion', 'lfi', 'rfi',
            'path traversal', 'directory traversal', 'default password', 'default credentials',
            'buffer overflow', 'ssrf', 'csrf', 'open redirect', 'insecure deserialization',
            'arbitrary read', 'privilege escalation']
MEDIUM_KW = ['directory listing', 'directory index', 'phpinfo', 'server-status',
              'admin interface', 'debug', 'backup file', 'config file', 'htpasswd',
              'robots.txt', 'crossdomain.xml', 'sensitive', 'wp-admin', 'phpmyadmin',
              'webdav', 'put method', 'trace method', 'delete method']
LOW_KW = ['version disclosure', 'server banner', 'information disclosure', 'x-powered-by',
           'x-aspnet', 'cookie without', 'httponly', 'secure flag', 'missing header',
           'clickjacking', 'content-type', 'cors']


def classify_severity(description: str) -> str:
    m = description.lower()
    if any(k in m for k in CRITICAL_KW):
        return 'CRITICAL'
    if any(k in m for k in HIGH_KW):
        return 'HIGH'
    if any(k in m for k in MEDIUM_KW):
        return 'MEDIUM'
    if any(k in m for k in LOW_KW):
        return 'LOW'
    return 'LOW'  # safe default — anything nikto finds is at least worth noting


def classify_category(description: str) -> str:
    m = description.lower()
    if 'sql' in m:
        return 'SQL_INJECTION'
    if 'xss' in m or 'cross-site' in m:
        return 'XSS'
    if 'inclusion' in m or 'lfi' in m or 'rfi' in m:
        return 'LFI'
    if 'rce' in m or 'remote code' in m or 'command injection' in m:
        return 'RCE'
    if 'traversal' in m or 'directory listing' in m or 'directory index' in m:
        return 'PATH_TRAVERSAL'
    if 'csrf' in m:
        return 'CSRF'
    if 'redirect' in m:
        return 'OPEN_REDIRECT'
    if 'credential' in m or 'password' in m or 'default login' in m:
        return 'WEAK_CREDENTIALS'
    if 'disclosure' in m or 'banner' in m or 'version' in m or 'header' in m:
        return 'INFO_DISCLOSURE'
    if 'config' in m or 'backup' in m or 'phpinfo' in m:
        return 'CONFIG_EXPOSURE'
    return 'WEB_VULNERABILITY'


class NiktoPlugin(BasePlugin):
    name = "nikto"
    description = "Web server scanner"

    def run(self, target: dict, config: dict) -> list[dict]:
        host = target["host"]
        args = config.get("args", "-Tuning 123456789")
        # subprocess timeout must be nikto's -maxtime + 60 s so nikto can finish
        # writing the JSON output file before the process gets killed.
        proc_timeout = config.get("timeout", 360)
        findings = []

        # Run against both HTTP and HTTPS
        # Call nikto.pl directly via perl; cwd must be /opt/nikto/program so FindBin resolves plugins correctly
        for scheme in ("https", "http"):
            cmd = ["perl", "/opt/nikto/program/nikto.pl", "-host", f"{scheme}://{host}", "-Format", "json", "-output", f"/tmp/nikto_{scheme}.json"] + args.split()
            try:
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=proc_timeout, cwd="/opt/nikto/program")
            except subprocess.TimeoutExpired:
                log.warning(f"nikto timed out on {scheme}://{host}")
                continue
            except FileNotFoundError:
                log.error("nikto binary not found")
                return []

            if result.returncode != 0:
                log.warning(f"nikto exited {result.returncode} for {scheme}://{host}: {result.stderr[:200]!r}")

            try:
                with open(f"/tmp/nikto_{scheme}.json") as f:
                    import json
                    raw = json.load(f)

                hosts_data = raw if isinstance(raw, list) else [raw]
                for h in hosts_data:
                    asset_id = h.get("host", host)
                    vulns = h.get("vulnerabilities", [])
                    for vuln in vulns:
                        msg = vuln.get("msg", "")
                        if not msg:
                            continue
                        severity = classify_severity(msg)
                        category = classify_category(msg)
                        cve_match = CVE_RE.search(msg)
                        findings.append(self._finding(
                            asset_id=asset_id,
                            title=f"Nikto: {msg[:120]}",
                            severity=severity,
                            category=category,
                            source_tool="nikto",
                            description=msg,
                            cve=cve_match.group(1) if cve_match else None,
                            evidence={"url": vuln.get("url", ""), "method": vuln.get("method", "GET"), "scheme": scheme},
                        ))
            except (FileNotFoundError, KeyError, ValueError) as e:
                log.warning(f"nikto: could not parse output for {scheme}://{host}: {e}")

        return findings
