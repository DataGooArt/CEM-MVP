import subprocess
import logging
import xml.etree.ElementTree as ET
import re
from plugins.base import BasePlugin

log = logging.getLogger(__name__)

# Ports with known high risk — maps portid → (severity, reason)
PORT_SEVERITY: dict[int, tuple[str, str]] = {
    21:    ('HIGH',     'FTP sin cifrar expuesto'),
    22:    ('LOW',      'SSH expuesto'),
    23:    ('CRITICAL', 'Telnet sin cifrar expuesto'),
    25:    ('MEDIUM',   'SMTP expuesto'),
    53:    ('MEDIUM',   'DNS expuesto'),
    80:    ('LOW',      'HTTP (sin cifrar) expuesto'),
    110:   ('MEDIUM',   'POP3 sin cifrar'),
    111:   ('MEDIUM',   'RPC portmapper expuesto'),
    143:   ('MEDIUM',   'IMAP sin cifrar'),
    443:   ('INFO',     'HTTPS expuesto'),
    445:   ('HIGH',     'SMB expuesto'),
    1433:  ('HIGH',     'MSSQL expuesto'),
    1521:  ('HIGH',     'Oracle DB expuesto'),
    2049:  ('HIGH',     'NFS expuesto'),
    2375:  ('CRITICAL', 'Docker daemon sin TLS'),
    3306:  ('HIGH',     'MySQL expuesto'),
    3389:  ('HIGH',     'RDP expuesto'),
    4444:  ('CRITICAL', 'Puerto de backdoor (4444)'),
    5432:  ('HIGH',     'PostgreSQL expuesto'),
    5900:  ('HIGH',     'VNC expuesto'),
    6379:  ('HIGH',     'Redis sin autenticación'),
    8080:  ('MEDIUM',   'HTTP alternativo expuesto'),
    8443:  ('MEDIUM',   'HTTPS alternativo expuesto'),
    8888:  ('MEDIUM',   'Puerto de gestión expuesto'),
    9200:  ('HIGH',     'Elasticsearch expuesto'),
    9300:  ('HIGH',     'Elasticsearch cluster expuesto'),
    27017: ('HIGH',     'MongoDB expuesto'),
    27018: ('HIGH',     'MongoDB expuesto'),
}

INSECURE_SERVICES = {'telnet', 'ftp', 'rsh', 'rlogin', 'rexec', 'finger'}

CVE_RE = re.compile(r'CVE-\d{4}-\d+', re.IGNORECASE)
CVSS_RE = re.compile(r'(\d+\.\d+)\s+CVE', re.IGNORECASE)


def _default_port_severity(port: int, service: str) -> tuple[str, str]:
    if service in INSECURE_SERVICES:
        return ('HIGH', f'Servicio inseguro: {service}')
    if service in ('ssh', 'https', 'ssl'):
        return ('LOW', f'Servicio cifrado: {service}')
    if service in ('http', 'www'):
        return ('LOW', f'HTTP expuesto en puerto {port}')
    return ('MEDIUM', f'Servicio expuesto: {service} en puerto {port}')


class NmapPlugin(BasePlugin):
    name = "nmap"
    description = "Port scanner + service/version detection + NSE scripts"

    def run(self, target: dict, config: dict) -> list[dict]:
        host = target["host"]
        args = config.get("args", "-sV -sC --script vuln,auth,banner -T4 --open")
        findings = []

        cmd = ["nmap"] + args.split() + ["-oX", "-", host]
        timeout = config.get("timeout", 300)
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            log.warning(f"nmap timed out against {host}")
            return []
        except FileNotFoundError:
            log.error("nmap binary not found")
            return []
        if result.returncode not in (0, 1):
            log.warning(f"nmap exited {result.returncode} on {host}: {result.stderr[:200]}")
            return []

        try:
            root = ET.fromstring(result.stdout)
        except ET.ParseError as e:
            log.warning(f"nmap: XML parse error for {host}: {e}")
            return []

        for host_el in root.findall("host"):
            addr_el = host_el.find("address")
            ip = addr_el.attrib.get("addr", host) if addr_el is not None else host

            for port_el in host_el.findall(".//port"):
                portid = int(port_el.attrib.get("portid", "0"))
                protocol = port_el.attrib.get("protocol", "tcp")
                state_el = port_el.find("state")
                if state_el is None or state_el.attrib.get("state") != "open":
                    continue

                service_el = port_el.find("service")
                service_name = service_el.attrib.get("name", "unknown") if service_el is not None else "unknown"
                product = service_el.attrib.get("product", "") if service_el is not None else ""
                version = service_el.attrib.get("version", "") if service_el is not None else ""
                banner = f"{product} {version}".strip()

                # Classify by well-known port or service name
                if portid in PORT_SEVERITY:
                    severity, reason = PORT_SEVERITY[portid]
                else:
                    severity, reason = _default_port_severity(portid, service_name)

                findings.append(self._finding(
                    asset_id=host,
                    title=f"{reason} — {ip}:{portid}/{protocol}" + (f" ({banner})" if banner else ""),
                    severity=severity,
                    category="OPEN_PORT",
                    source_tool="nmap",
                    description=f"Puerto {portid}/{protocol} abierto. Servicio: {service_name}" + (f" — {banner}" if banner else ""),
                    evidence={"ip": ip, "port": portid, "protocol": protocol, "service": service_name, "product": product, "version": version},
                ))

                # NSE script output — extract CVEs and vulnerability findings
                for script_el in port_el.findall("script"):
                    script_id = script_el.attrib.get("id", "")
                    output = script_el.attrib.get("output", "")
                    if not output:
                        continue

                    cve, cvss = self._extract_cve_cvss(output)

                    # Emit finding for any script with CVE reference or known vuln scripts
                    is_vuln_script = any(v in script_id for v in ('vuln', 'exploit', 'cve', 'auth'))
                    if cve or is_vuln_script:
                        script_severity = self._cvss_to_severity(cvss)
                        findings.append(self._finding(
                            asset_id=host,
                            title=f"[NSE:{script_id}] Vulnerabilidad en {ip}:{portid}",
                            severity=script_severity,
                            category="VULNERABILITY",
                            source_tool="nmap",
                            description=output[:800],
                            cve=cve,
                            cvss=cvss,
                            evidence={"port": portid, "script": script_id, "raw": output[:2000]},
                        ))

            # Host-level scripts (e.g. ssl-cert, ssl-enum-ciphers)
            for script_el in host_el.findall(".//hostscript/script"):
                script_id = script_el.attrib.get("id", "")
                output = script_el.attrib.get("output", "")
                if not output:
                    continue
                cve, cvss = self._extract_cve_cvss(output)
                if cve or 'vuln' in script_id:
                    findings.append(self._finding(
                        asset_id=host,
                        title=f"[NSE:{script_id}] Hallazgo en host {ip}",
                        severity=self._cvss_to_severity(cvss),
                        category="VULNERABILITY",
                        source_tool="nmap",
                        description=output[:800],
                        cve=cve,
                        cvss=cvss,
                        evidence={"script": script_id, "raw": output[:2000]},
                    ))

        return findings

    def _extract_cve_cvss(self, text: str) -> tuple[str | None, float | None]:
        cve = None
        cvss = None
        cve_match = CVE_RE.search(text)
        if cve_match:
            cve = cve_match.group(0).upper()
        # Vulners output: "9.8 CVE-2021-..."
        scores = [float(m.group(1)) for m in CVSS_RE.finditer(text)]
        if scores:
            cvss = max(scores)
        return cve, cvss

    def _cvss_to_severity(self, cvss: float | None) -> str:
        if cvss is None:
            return 'MEDIUM'
        if cvss >= 9.0:
            return 'CRITICAL'
        if cvss >= 7.0:
            return 'HIGH'
        if cvss >= 4.0:
            return 'MEDIUM'
        return 'LOW'


    def _extract_cve(self, text: str):
        import re
        cve_match = re.search(r"(CVE-\d{4}-\d+)", text)
        cvss_match = re.search(r"(\d+\.\d+)\s", text)
        cve = cve_match.group(1) if cve_match else None
        cvss = float(cvss_match.group(1)) if cvss_match else None
        if cvss and (cvss > 10.0 or cvss < 0):
            cvss = None
        return cve, cvss
