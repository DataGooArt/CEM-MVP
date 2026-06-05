import subprocess
import logging
import re
from plugins.base import BasePlugin

log = logging.getLogger(__name__)

# TLS protocols that are considered weak
TLS_WEAK_RE = re.compile(r'(TLSv1\.0|TLSv1\.1|SSLv\d)', re.IGNORECASE)
TLS_ENABLED_RE = re.compile(r'enabled', re.IGNORECASE)

# Cipher patterns
WEAK_CIPHER_KW = re.compile(r'\b(DES|RC4|NULL|EXPORT|anon)\b', re.IGNORECASE)
MEDIUM_CIPHER_KW = re.compile(r'\b(3DES|RC2|SEED)\b', re.IGNORECASE)

# Certificate patterns
CERT_EXPIRED_RE = re.compile(r'Not valid after\s*:\s*(.+)', re.IGNORECASE)
SELF_SIGNED_RE = re.compile(r'Self-[Ss]igned', re.IGNORECASE)


class SslscanPlugin(BasePlugin):
    name = "sslscan"
    description = "SSL/TLS protocol and cipher suite scanner"

    def run(self, target: dict, config: dict) -> list[dict]:
        host = target["host"]
        args = config.get("args", "--no-colour")
        findings = []

        cmd = ["sslscan"] + args.split() + [f"{host}:443"]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        except subprocess.TimeoutExpired:
            log.warning(f"sslscan timed out against {host}")
            return []
        except FileNotFoundError:
            log.error("sslscan binary not found")
            return []

        output = result.stdout + result.stderr
        if not output.strip():
            return []

        lines = output.splitlines()

        # ── Weak TLS protocols ────────────────────────────────────────────────
        weak_protocols = []
        for line in lines:
            m = TLS_WEAK_RE.search(line)
            if m and TLS_ENABLED_RE.search(line):
                proto = m.group(1)
                if proto not in weak_protocols:
                    weak_protocols.append(proto)

        if weak_protocols:
            findings.append(self._finding(
                asset_id=host,
                title=f"Protocolo TLS débil habilitado: {', '.join(weak_protocols)}",
                severity="HIGH",
                category="MISCONFIGURATION",
                source_tool="sslscan",
                description=(
                    f"El servidor acepta protocolos TLS obsoletos: {', '.join(weak_protocols)}. "
                    "TLS 1.0/1.1 son vulnerables a BEAST, POODLE y ataques de downgrade. "
                    "Se recomienda deshabilitar todo excepto TLS 1.2 y TLS 1.3."
                ),
                evidence={"weak_protocols": weak_protocols, "host": host},
            ))

        # ── Weak cipher suites ────────────────────────────────────────────────
        weak_ciphers = []
        for line in lines:
            if WEAK_CIPHER_KW.search(line) and "accepted" in line.lower():
                cipher_m = re.search(r'([\w-]+)\s+\d+\s+bits', line)
                if cipher_m:
                    cipher = cipher_m.group(1)
                    if cipher not in weak_ciphers:
                        weak_ciphers.append(cipher)

        if weak_ciphers:
            findings.append(self._finding(
                asset_id=host,
                title=f"Cipher suites criptográficamente débiles aceptadas ({len(weak_ciphers)})",
                severity="HIGH",
                category="MISCONFIGURATION",
                source_tool="sslscan",
                description=(
                    f"Se detectaron cipher suites inseguros: {', '.join(weak_ciphers[:8])}. "
                    "Estos algoritmos son susceptibles a ataques de descifrado. "
                    "Configurar únicamente cipher suites AEAD (AES-GCM, ChaCha20)."
                ),
                evidence={"weak_ciphers": weak_ciphers[:10]},
            ))

        # ── Expired or soon-to-expire certificate ────────────────────────────
        for line in lines:
            m = CERT_EXPIRED_RE.search(line)
            if m:
                expiry = m.group(1).strip()
                findings.append(self._finding(
                    asset_id=host,
                    title="Certificado SSL expirado o próximo a vencer",
                    severity="HIGH",
                    category="MISCONFIGURATION",
                    source_tool="sslscan",
                    description=f"El certificado SSL expira: {expiry}. Un certificado vencido interrumpe el servicio y genera advertencias en los navegadores.",
                    evidence={"expiry_date": expiry},
                ))
                break

        # ── Self-signed certificate ───────────────────────────────────────────
        for line in lines:
            if SELF_SIGNED_RE.search(line):
                findings.append(self._finding(
                    asset_id=host,
                    title="Certificado SSL autofirmado detectado",
                    severity="MEDIUM",
                    category="MISCONFIGURATION",
                    source_tool="sslscan",
                    description="El servidor usa un certificado autofirmado. Los clientes externos recibirán una advertencia de seguridad y la conexión no es de confianza.",
                    evidence={"detail": line.strip()},
                ))
                break

        # ── No issues found ───────────────────────────────────────────────────
        if not findings and result.returncode == 0:
            findings.append(self._finding(
                asset_id=host,
                title="Configuración SSL/TLS analizada — sin vulnerabilidades detectadas",
                severity="INFO",
                category="MISCONFIGURATION",
                source_tool="sslscan",
                description="El escaneo SSL no encontró protocolos débiles, cipher suites inseguros ni problemas de certificado.",
                evidence={"raw_lines": len(lines)},
            ))

        return findings
