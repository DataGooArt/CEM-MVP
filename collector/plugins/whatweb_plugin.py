import subprocess
import json
import logging
import os
import re
from plugins.base import BasePlugin

log = logging.getLogger(__name__)

# Regex to parse whatweb's plain-text output: PluginName[value, ...]
_PLAIN_PLUGIN_RE = re.compile(r'([A-Za-z0-9_\-]+)\[([^\]]+)\]')


class WhatwebPlugin(BasePlugin):
    name = "whatweb"
    description = "Web technology fingerprinting"

    def run(self, target: dict, config: dict) -> list[dict]:
        host = target["host"]
        args = config.get("args", "--aggression 3")
        out_file = "/tmp/whatweb_out.json"
        findings = []

        cmd = ["whatweb", f"--log-json={out_file}"] + args.split() + [f"https://{host}"]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        except subprocess.TimeoutExpired:
            log.warning(f"whatweb timed out against {host}")
            return []
        except FileNotFoundError:
            log.error("whatweb binary not found")
            return []

        if result.returncode != 0 and result.returncode != 1:
            # returncode 1 is normal (target accessible but not 200)
            log.warning(f"whatweb exited {result.returncode} on {host}: {result.stderr[:300]}")

        # Try JSON output first
        try:
            with open(out_file) as f:
                raw = f.read().strip()
            os.unlink(out_file)

            data = json.loads(raw) if raw.startswith("[") or raw.startswith("{") else None
            if data:
                items = data if isinstance(data, list) else [data]
                return self._parse_json(host, items)
        except (FileNotFoundError, json.JSONDecodeError, OSError) as e:
            log.debug(f"whatweb JSON output unavailable ({e}), falling back to text parsing")

        # Fallback: parse whatweb's plain-text stdout
        return self._parse_text(host, result.stdout)

    def _parse_json(self, host: str, items: list) -> list[dict]:
        findings = []
        for item in items:
            plugins = item.get("plugins", {})
            technologies = []
            for name, details in plugins.items():
                version = details.get("version", [])
                ver_str = version[0] if version else ""
                technologies.append(f"{name} {ver_str}".strip())

            if technologies:
                findings.append(self._finding(
                    asset_id=host,
                    title=f"Technologies detected on {host}",
                    severity="INFO",
                    category="ASSET_DISCOVERY",
                    source_tool="whatweb",
                    description="Detected technologies and versions",
                    evidence={"technologies": technologies, "url": item.get("target", "")},
                ))

            for plugin_name, details in plugins.items():
                for ver in details.get("version", []):
                    if self._is_interesting(plugin_name, ver):
                        findings.append(self._finding(
                            asset_id=host,
                            title=f"Outdated/notable version: {plugin_name} {ver}",
                            severity="LOW",
                            category="MISCONFIGURATION",
                            source_tool="whatweb",
                            description=f"{plugin_name} version {ver} detected. Verify if up to date.",
                            evidence={"plugin": plugin_name, "version": ver},
                        ))
        return findings

    def _parse_text(self, host: str, stdout: str) -> list[dict]:
        """Parse whatweb plain-text output when JSON log is unavailable."""
        technologies = []
        for line in stdout.splitlines():
            for match in _PLAIN_PLUGIN_RE.finditer(line):
                name, value = match.group(1), match.group(2).strip()
                technologies.append(f"{name}[{value}]")

        if not technologies:
            log.info(f"whatweb: no technologies detected on {host} (text fallback)")
            return []

        log.info(f"whatweb: text fallback detected {len(technologies)} entries on {host}")
        findings = [self._finding(
            asset_id=host,
            title=f"Technologies detected on {host}",
            severity="INFO",
            category="ASSET_DISCOVERY",
            source_tool="whatweb",
            description="Detected technologies and versions (parsed from text output)",
            evidence={"technologies": technologies},
        )]

        # Check for notable versions in text output
        for tech in technologies:
            m = re.match(r'([A-Za-z0-9_\-]+)\[([^\]]+)\]', tech)
            if m and self._is_interesting(m.group(1), m.group(2)):
                findings.append(self._finding(
                    asset_id=host,
                    title=f"Outdated/notable version: {tech}",
                    severity="LOW",
                    category="MISCONFIGURATION",
                    source_tool="whatweb",
                    description=f"{m.group(1)} version {m.group(2)} detected. Verify if up to date.",
                    evidence={"plugin": m.group(1), "version": m.group(2)},
                ))
        return findings

    def _is_interesting(self, name: str, version: str) -> bool:
        interesting = {"Apache", "nginx", "PHP", "WordPress", "jQuery", "Bootstrap", "OpenSSL"}
        return name in interesting and bool(version)

