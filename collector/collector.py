"""
CEM Collector — Dynamic plugin-based security scanner
Discovers and loads plugins at runtime from plugins/ directory.
Supports CLI mode and HTTP server mode (--server).
"""
import importlib
import inspect
import pkgutil
import subprocess
import sys
import time
import logging
import argparse
import uuid as uuid_mod
import yaml
import requests
from pathlib import Path
from threading import Thread
from concurrent.futures import ThreadPoolExecutor, as_completed
from plugins.base import BasePlugin

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("collector")

# Module-level cache — populated once at first call; avoids re-importing on
# every Docker healthcheck (which fires every 30 s and spams the logs).
_plugin_registry: dict[str, type[BasePlugin]] | None = None


# ---------------------------------------------------------------------------
# Plugin registry — auto-discovers all BasePlugin subclasses in plugins/
# ---------------------------------------------------------------------------
def discover_plugins() -> dict[str, type[BasePlugin]]:
    global _plugin_registry
    if _plugin_registry is not None:
        return _plugin_registry

    registry: dict[str, type[BasePlugin]] = {}
    plugins_path = Path(__file__).parent / "plugins"

    for finder, module_name, _ in pkgutil.iter_modules([str(plugins_path)]):
        if module_name == "base":
            continue
        try:
            module = importlib.import_module(f"plugins.{module_name}")
            for _, cls in inspect.getmembers(module, inspect.isclass):
                if issubclass(cls, BasePlugin) and cls is not BasePlugin and cls.name:
                    registry[cls.name] = cls
                    log.debug(f"Loaded plugin: {cls.name}")
        except Exception as e:
            log.warning(f"Failed to load plugin {module_name}: {e}")

    log.info(f"Available plugins: {list(registry.keys())}")  # logged exactly once
    _plugin_registry = registry
    return registry


# ---------------------------------------------------------------------------
# API client
# ---------------------------------------------------------------------------
class ApiClient:
    def __init__(self, base_url: str, collector_id: str, scan_id: str = None):
        self.base_url = base_url.rstrip("/")
        self.scan_id = scan_id
        self.headers = {
            "Content-Type": "application/json",
            "x-collector-id": collector_id,
        }
        if scan_id:
            self.headers["x-scan-id"] = scan_id
        self.session = requests.Session()
        self.session.headers.update(self.headers)

    def ingest(self, finding: dict, max_retries: int = 4) -> bool:
        """Envía un finding al API con reintentos y backoff exponencial.

        Intentos: 1 inmediato + 3 reintentos con esperas de 2s, 4s, 8s.
        Si todos fallan, el finding se descarta con un log de error.
        """
        delay = 2.0
        for attempt in range(1, max_retries + 1):
            try:
                resp = self.session.post(
                    f"{self.base_url}/api/v1/findings/ingest",
                    json=finding,
                    timeout=10,
                )
                resp.raise_for_status()
                return True
            except requests.RequestException as e:
                if attempt < max_retries:
                    log.warning(
                        f"[ingest] Attempt {attempt}/{max_retries} failed: {e} "
                        f"— retrying in {delay:.0f}s"
                    )
                    time.sleep(delay)
                    delay *= 2  # backoff exponencial: 2s → 4s → 8s
                else:
                    log.error(
                        f"[ingest] All {max_retries} attempts failed for finding "
                        f"'{finding.get('title', '?')}': {e}"
                    )
        return False

    def report_progress(self, event: str, tool: str = None, count: int = 0):
        """Notifica al API el progreso del scan para broadcast por WebSocket."""
        if not self.scan_id:
            return
        try:
            self.session.post(
                f"{self.base_url}/api/v1/collectors/scan-progress",
                json={
                    "scanId": self.scan_id,
                    "collectorId": self.headers.get("x-collector-id", ""),
                    "event": event,
                    "tool": tool,
                    "findingsCount": count,
                },
                timeout=5,
            )
        except Exception as e:
            log.debug(f"Progress report failed: {e}")

    def health_check(self) -> bool:
        try:
            resp = self.session.get(f"{self.base_url}/api/v1/collectors/health", timeout=5)
            return resp.status_code in (200, 401, 404)  # any HTTP response means the API is up
        except requests.RequestException:
            return False


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

# These tools consume katana's URL pipeline output (/tmp/katana_urls_*.txt)
# and must run in a second wave, after all wave-1 tools (including katana) finish.
_WAVE2_TOOLS = frozenset({"dalfox", "sqlmap"})


class CollectorRunner:
    def __init__(self, config: dict, scan_id: str = None, profile: str = "standard"):
        self.config = config
        self.scan_id = scan_id
        self.profile = profile
        self.api = ApiClient(
            base_url=config["api"]["url"],
            collector_id=config["api"]["collector_id"],
            scan_id=scan_id,
        )
        self.plugins = discover_plugins()

    def _run_plugin(self, plugin_name: str, plugin_cls: type, target: dict, plugin_config: dict) -> list[dict]:
        """Execute one plugin in a thread. Returns deduplicated, noise-filtered findings.
        Does NOT call api.ingest (main thread handles ingestion to avoid session races)."""
        host = target["host"]
        plugin = plugin_cls()
        log.info(f"[{host}] Starting plugin: {plugin_name}")
        self.api.report_progress("tool:started", tool=plugin_name)
        try:
            findings = plugin.run(target, plugin_config)
            findings = self._filter_noise(findings, plugin_name)
            seen: dict = {}
            for f in findings:
                key = (f.get("title", ""), f.get("source_tool", plugin_name))
                if key not in seen:
                    seen[key] = f
            findings = list(seen.values())
            log.info(f"[{host}] {plugin_name}: {len(findings)} findings")
            self.api.report_progress("tool:done", tool=plugin_name, count=len(findings))
            return findings
        except Exception as e:
            log.error(f"[{host}] Plugin {plugin_name} failed: {e}", exc_info=True)
            self.api.report_progress("tool:error", tool=plugin_name)
            return []

    def run_target(self, target: dict):
        host = target["host"]
        log.info(f"=== Scanning target: {host} (profile: {self.profile}) ===")
        total_sent = 0
        self.api.report_progress("scan:started")

        # Partition enabled plugins into two waves:
        # Wave 1 — all independent tools, run fully in parallel
        # Wave 2 — dalfox & sqlmap (depend on katana URL output), run after wave 1
        wave1: dict[str, tuple] = {}
        wave2: dict[str, tuple] = {}
        for plugin_name, plugin_config in self.config.get("plugins", {}).items():
            if not plugin_config.get("enabled", False):
                log.debug(f"Plugin {plugin_name} disabled, skipping")
                continue
            if plugin_name not in self.plugins:
                log.warning(f"Plugin '{plugin_name}' not found in registry")
                continue
            bucket = wave2 if plugin_name in _WAVE2_TOOLS else wave1
            bucket[plugin_name] = (self.plugins[plugin_name], plugin_config)

        log.info(f"[{host}] Wave 1 ({len(wave1)} tools, parallel): {list(wave1.keys())}")
        if wave2:
            log.info(f"[{host}] Wave 2 ({len(wave2)} tools, after wave 1): {list(wave2.keys())}")

        def _run_wave(wave: dict) -> int:
            """Submit all plugins in a ThreadPoolExecutor; ingest findings from the main thread."""
            if not wave:
                return 0
            sent = 0
            with ThreadPoolExecutor(max_workers=min(len(wave), 8), thread_name_prefix="cem-plugin") as ex:
                future_to_name = {
                    ex.submit(self._run_plugin, name, cls, target, cfg): name
                    for name, (cls, cfg) in wave.items()
                }
                for future in as_completed(future_to_name):
                    for finding in future.result():
                        if self.api.ingest(finding):
                            sent += 1
                        time.sleep(0.05)  # rate-limit per finding (main thread only)
            return sent

        total_sent += _run_wave(wave1)
        total_sent += _run_wave(wave2)

        self.api.report_progress("scan:done", count=total_sent)
        log.info(f"Target {host} complete. Sent {total_sent} findings.")
        return total_sent

    def _filter_noise(self, findings: list[dict], plugin_name: str) -> list[dict]:
        """Remove likely noise based on active scan profile.

        Deep profile: all findings kept.
        Standard:     nuclei INFO dropped.
        Quick:        nuclei INFO + nikto INFO dropped.
        """
        if self.profile == "deep":
            return findings
        filtered = []
        for f in findings:
            sev = f.get("severity", "INFO").upper()
            if plugin_name == "nuclei" and sev == "INFO":
                continue  # skip in quick and standard
            if plugin_name == "nikto" and sev == "INFO" and self.profile == "quick":
                continue
            filtered.append(f)
        return filtered

    def run_all(self):
        if not self.api.health_check():
            log.error("API is not reachable. Aborting.")
            sys.exit(1)

        targets = self.config.get("targets", [])
        log.info(f"Starting scan. Targets: {len(targets)}, Plugins: {list(self.config.get('plugins', {}).keys())}")

        for target in targets:
            self.run_target(target)

        log.info("All targets scanned.")


# ---------------------------------------------------------------------------
# HTTP server mode
# ---------------------------------------------------------------------------
def run_server(config: dict, host: str = "0.0.0.0", port: int = 5000):
    try:
        from flask import Flask, request, jsonify
    except ImportError:
        log.error("Flask not installed. Add 'flask' to requirements.txt and rebuild.")
        sys.exit(1)

    app = Flask(__name__)

    # Update nuclei templates in background at startup (non-blocking)
    try:
        log.info("Starting nuclei template update in background...")
        subprocess.Popen(
            ["nuclei", "-update-templates", "-silent"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as e:
        log.warning(f"Could not start nuclei template update: {e}")

    @app.route("/health", methods=["GET"])
    def health():
        plugins = list(discover_plugins().keys())
        return jsonify({"status": "ok", "plugins": plugins})

    @app.route("/scan", methods=["POST"])
    def start_scan():
        data = request.get_json(force=True) or {}
        target = data.get("target")
        if not target:
            return jsonify({"error": "target is required"}), 400

        plugins_requested = data.get("plugins")       # list or None = all enabled
        scan_id = data.get("scan_id") or str(uuid_mod.uuid4())
        api_url = data.get("api_url", config["api"]["url"])
        profile = data.get("profile") or config.get("default_profile", "standard")

        # Build per-request config so concurrent scans don't share state
        req_config = {
            **config,
            "api": {**config.get("api", {}), "url": api_url, "collector_id": target},
            "targets": [{"id": "scan-target", "host": target, "tags": ["ui-triggered"], "scan_id": scan_id}],
        }

        # Build plugin section from profile
        # Order matters: recon first, then surface discovery (katana/gobuster/ffuf),
        # then vuln scanners, then injection tools that consume katana's URL output.
        ALL_TOOLS = [
            "nmap", "whatweb", "httpx", "subfinder", "amass",  # reconnaissance
            "katana", "gobuster", "ffuf",                      # surface discovery
            "nuclei", "nikto", "sslscan", "testssl",           # vulnerability scanners
            "dalfox", "sqlmap",                               # injection (consume katana urls)
            "trufflehog",                                     # secrets
        ]
        perfiles = config.get("perfiles", {})
        if profile in perfiles:
            profile_data = perfiles[profile]
            habilitado = profile_data.get("habilitado", {})
            plugins_cfg = {}
            for tool in ALL_TOOLS:
                tool_cfg = dict(profile_data.get(tool) or {})
                # plugins_requested is a user-defined subset filter:
                # a tool runs only if BOTH the profile enables it AND the
                # caller explicitly included it.  This prevents a quick-profile
                # tool list from silently disabling standard/deep-only tools
                # when the caller sends its stored domain.tools list.
                profile_on = habilitado.get(tool, False)
                if plugins_requested is not None:
                    tool_cfg["enabled"] = profile_on and (tool in plugins_requested)
                else:
                    tool_cfg["enabled"] = profile_on
                plugins_cfg[tool] = tool_cfg
            req_config["plugins"] = plugins_cfg
        elif plugins_requested is not None:
            # Legacy fallback: no matching profile, apply caller's tool list
            req_config["plugins"] = {
                name: {**cfg, "enabled": name in plugins_requested}
                for name, cfg in config.get("plugins", {}).items()
            }

        def _run():
            try:
                runner = CollectorRunner(req_config, scan_id=scan_id, profile=profile)
                runner.run_all()
            except SystemExit:
                pass  # health_check failure — already logged
            except Exception as e:
                log.error(f"Scan error [{scan_id}]: {e}", exc_info=True)

        Thread(target=_run, daemon=True).start()
        log.info(f"Scan queued: target={target} scan_id={scan_id} profile={profile} plugins={plugins_requested or 'all'}")
        return jsonify({"scan_id": scan_id, "status": "started", "target": target, "profile": profile})

    log.info(f"Collector HTTP server starting on {host}:{port} (waitress)")
    try:
        from waitress import serve
        serve(app, host=host, port=port, threads=8, connection_limit=100)
    except ImportError:
        log.warning("waitress not installed — falling back to Flask dev server")
        app.run(host=host, port=port, threaded=True)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="CEM Dynamic Collector")
    parser.add_argument("--config", default="/app/config.yml", help="Path to config.yml")
    parser.add_argument("--target", help="Override: scan a single host (skips config targets)")
    parser.add_argument("--plugins", help="Override: comma-separated list of plugins to run")
    parser.add_argument("--list-plugins", action="store_true", help="List available plugins and exit")
    parser.add_argument("--server", action="store_true", help="Run as HTTP server (default port 5000)")
    parser.add_argument("--port", type=int, default=5000, help="HTTP server port (used with --server)")
    args = parser.parse_args()

    with open(args.config) as f:
        config = yaml.safe_load(f)

    if args.list_plugins:
        registry = discover_plugins()
        for name, cls in registry.items():
            print(f"  {name:15} — {cls.description}")
        sys.exit(0)

    if args.server:
        run_server(config, port=args.port)
        return

    # CLI overrides
    if args.target:
        config["targets"] = [{"id": "cli-target", "host": args.target, "tags": ["manual"]}]

    if args.plugins:
        enabled = set(args.plugins.split(","))
        for plugin_name in config.get("plugins", {}):
            config["plugins"][plugin_name]["enabled"] = plugin_name in enabled

    runner = CollectorRunner(config)
    runner.run_all()


if __name__ == "__main__":
    main()
