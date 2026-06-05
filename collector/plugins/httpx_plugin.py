import subprocess
import json
import logging
from plugins.base import BasePlugin

log = logging.getLogger(__name__)


# Status codes worth reporting as findings
INTERESTING_STATUS = {
    401: ("MEDIUM", "EXPOSURE", "Recurso protegido (HTTP 401 Unauthorized)"),
    403: ("LOW",    "EXPOSURE", "Recurso prohibido (HTTP 403 Forbidden)"),
    500: ("MEDIUM", "VULNERABILITY", "Error interno del servidor (HTTP 500)"),
    502: ("LOW",    "MISCONFIGURATION", "Bad Gateway (HTTP 502) — posible proxy/backend expuesto"),
    503: ("LOW",    "MISCONFIGURATION", "Service Unavailable (HTTP 503)"),
}

# Technologies that warrant attention
NOTABLE_TECH_KW = [
    "apache", "nginx", "iis", "tomcat", "jboss", "weblogic", "websphere",
    "php", "asp.net", "ruby", "django", "laravel", "spring",
    "wordpress", "joomla", "drupal", "magento", "sharepoint",
    "jquery", "angular", "react", "vue",
]


class HttpxPlugin(BasePlugin):
    name = "httpx"
    description = "Fast HTTP probing and technology fingerprinting"

    def run(self, target: dict, config: dict) -> list[dict]:
        host = target["host"]
        timeout = config.get("timeout", 30)
        findings = []

        cmd = [
            "httpx",
            "-u", host,
            "-json",
            "-silent",
            "-tech-detect",
            "-status-code",
            "-title",
            "-web-server",
            "-content-length",
            "-follow-redirects",
            "-timeout", str(timeout),
        ]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 60)
        except subprocess.TimeoutExpired:
            log.warning(f"httpx timed out against {host}")
            return []
        except FileNotFoundError:
            log.error("httpx binary not found")
            return []

        seen_tech: set[str] = set()

        for line in result.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue

            # httpx uses hyphenated keys in JSON output
            url = item.get("url", f"https://{host}")
            status = item.get("status-code") or item.get("status_code", 0)
            title = item.get("title", "")
            webserver = item.get("webserver", "")
            tech_list = item.get("tech", []) or []
            if isinstance(tech_list, str):
                tech_list = [tech_list]

            # ── Interesting HTTP status codes ─────────────────────────────
            if status in INTERESTING_STATUS:
                sev, cat, desc = INTERESTING_STATUS[status]
                findings.append(self._finding(
                    asset_id=host,
                    title=f"HTTP {status} en {url}",
                    severity=sev,
                    category=cat,
                    source_tool="httpx",
                    description=f"{desc}. Título: '{title}'.",
                    evidence={"url": url, "status_code": status, "title": title},
                ))

            # ── Web server version disclosure ─────────────────────────────
            if webserver:
                findings.append(self._finding(
                    asset_id=host,
                    title=f"Web server identificado: {webserver}",
                    severity="INFO",
                    category="ASSET_DISCOVERY",
                    source_tool="httpx",
                    description=(
                        f"Servidor web '{webserver}' detectado en {url}. "
                        "La divulgación de versión puede facilitar ataques dirigidos."
                    ),
                    evidence={"url": url, "webserver": webserver, "title": title},
                ))

            # ── Technology detection ───────────────────────────────────────
            for tech in tech_list:
                tech_lower = tech.lower()
                if tech_lower in seen_tech:
                    continue
                seen_tech.add(tech_lower)

                is_notable = any(kw in tech_lower for kw in NOTABLE_TECH_KW)
                severity = "LOW" if is_notable else "INFO"

                findings.append(self._finding(
                    asset_id=host,
                    title=f"Tecnología detectada: {tech}",
                    severity=severity,
                    category="ASSET_DISCOVERY",
                    source_tool="httpx",
                    description=f"Tecnología '{tech}' detectada en {url}.",
                    evidence={"url": url, "technology": tech},
                ))

        return findings
