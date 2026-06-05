"""
Base class for all collector plugins.
Each plugin must implement: run(target, config) -> list[dict]
"""
from abc import ABC, abstractmethod
from typing import Any


class BasePlugin(ABC):
    name: str = ""
    description: str = ""

    @abstractmethod
    def run(self, target: dict, config: dict) -> list[dict]:
        """
        Run the tool against a target.
        Returns a list of normalized finding dicts.
        """
        ...

    def _finding(
        self,
        asset_id: str,
        title: str,
        severity: str,
        category: str,
        source_tool: str,
        description: str = "",
        cve: str | None = None,
        cvss: float | None = None,
        evidence: dict | None = None,
    ) -> dict:
        """Helper to build a normalized finding payload."""
        finding = {
            "assetId": asset_id,
            "title": title,
            "severity": severity.upper(),
            "category": category,
            "sourceTool": source_tool,
            "description": description,
            "evidence": evidence or {},
        }
        if cve:
            finding["cve"] = cve
        if cvss is not None:
            finding["cvss"] = cvss
        return finding
