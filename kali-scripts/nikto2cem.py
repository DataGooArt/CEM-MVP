#!/usr/bin/env python3
"""
nikto2cem.py — Envia hallazgos de Nikto al CEM Platform.

Uso:
    nikto -h http://target.com -Format json -output nikto.json
    python3 nikto2cem.py nikto.json http://<CEM_HOST>:3001

Variables de entorno:
    CEM_API   — URL base del API (alternativa al argumento)
    CEM_TOKEN — valor del header x-collector-id (por defecto: kali-nikto)
"""

import sys
import os
import json
import re
import requests

CVE_RE = re.compile(r'CVE-\d{4}-\d+', re.IGNORECASE)
OSVDB_RE = re.compile(r'OSVDB-\d+', re.IGNORECASE)

# Palabras clave → severidad
HIGH_KEYWORDS = [
    'sql injection', 'sqli', 'xss', 'cross-site scripting',
    'remote code execution', 'rce', 'command injection',
    'file inclusion', 'lfi', 'rfi', 'path traversal',
    'authentication bypass', 'default password', 'default credential',
    'buffer overflow', 'csrf', 'xxe', 'ssrf',
]
CRITICAL_KEYWORDS = [
    'remote code execution', 'rce', 'sql injection', 'sqli',
    'authentication bypass', 'arbitrary file upload',
]
MEDIUM_KEYWORDS = [
    'information disclosure', 'directory listing', 'error message',
    'version disclosure', 'debug', 'backup file', 'config file',
    'robots.txt', 'phpinfo', 'server-status', 'server-info',
    'admin interface', 'login page',
]

def classify_severity(msg: str) -> str:
    msg_lower = msg.lower()
    for kw in CRITICAL_KEYWORDS:
        if kw in msg_lower:
            return 'CRITICAL'
    for kw in HIGH_KEYWORDS:
        if kw in msg_lower:
            return 'HIGH'
    for kw in MEDIUM_KEYWORDS:
        if kw in msg_lower:
            return 'MEDIUM'
    return 'LOW'

def classify_category(msg: str) -> str:
    msg_lower = msg.lower()
    if 'sql' in msg_lower:
        return 'SQL_INJECTION'
    if 'xss' in msg_lower or 'cross-site scripting' in msg_lower:
        return 'XSS'
    if 'file inclusion' in msg_lower or 'lfi' in msg_lower or 'rfi' in msg_lower:
        return 'LFI'
    if 'rce' in msg_lower or 'remote code' in msg_lower:
        return 'RCE'
    if 'directory listing' in msg_lower or 'directory traversal' in msg_lower:
        return 'PATH_TRAVERSAL'
    if 'information' in msg_lower or 'disclosure' in msg_lower or 'version' in msg_lower:
        return 'INFO_DISCLOSURE'
    if 'default' in msg_lower and ('password' in msg_lower or 'credential' in msg_lower):
        return 'WEAK_CREDENTIALS'
    if 'csrf' in msg_lower:
        return 'CSRF'
    if 'config' in msg_lower or 'backup' in msg_lower:
        return 'MISCONFIGURATION'
    return 'WEB_VULNERABILITY'

def process_nikto(data: dict, api_url: str, collector_id: str) -> tuple[int, int]:
    sent = errors = 0

    # Nikto JSON puede tener estructura {host, port, vulnerabilities:[]}
    # o lista directa de hosts
    hosts = []
    if isinstance(data, list):
        hosts = data
    elif 'vulnerabilities' in data:
        hosts = [data]
    elif 'host' in data:
        hosts = [data]

    for host_data in hosts:
        target_host = host_data.get('host', host_data.get('ip', 'unknown'))
        target_port = host_data.get('port', 80)
        asset_id = target_host

        vulns = host_data.get('vulnerabilities', host_data.get('items', []))
        if not vulns:
            # Formato antiguo plano
            if 'id' in host_data and 'msg' in host_data:
                vulns = [host_data]

        for vuln in vulns:
            msg = vuln.get('msg', vuln.get('message', vuln.get('description', '')))
            if not msg:
                continue

            url = vuln.get('url', vuln.get('uri', ''))
            osvdb = vuln.get('id', vuln.get('osvdbid', ''))
            method = vuln.get('method', 'GET')

            severity = classify_severity(msg)
            category = classify_category(msg)

            cve_match = CVE_RE.search(msg)
            cve = cve_match.group(0).upper() if cve_match else None

            title = msg[:200]
            evidence = {
                'url': url,
                'method': method,
                'osvdb': str(osvdb) if osvdb else None,
                'port': target_port,
            }

            payload = {
                'assetId': asset_id,
                'category': category,
                'severity': severity,
                'title': title,
                'description': msg[:1000],
                'sourceTool': 'nikto',
                'evidence': {k: v for k, v in evidence.items() if v},
            }
            if cve:
                payload['cve'] = cve

            try:
                resp = requests.post(
                    f'{api_url}/api/v1/findings/ingest',
                    headers={'Content-Type': 'application/json', 'x-collector-id': collector_id},
                    json=payload,
                    timeout=10,
                )
                resp.raise_for_status()
                print(f'[OK] {severity} — {title[:80]}')
                sent += 1
            except requests.RequestException as e:
                print(f'[ERR] {title[:60]} — {e}')
                errors += 1

    return sent, errors

def main():
    source = sys.argv[1] if len(sys.argv) > 1 else None
    api_url = sys.argv[2] if len(sys.argv) > 2 else os.environ.get('CEM_API', 'http://localhost:3001')
    collector_id = os.environ.get('CEM_TOKEN', 'kali-nikto')
    api_url = api_url.rstrip('/')

    if not source:
        print('Uso: python3 nikto2cem.py <nikto.json> [http://cem-host:3001]')
        sys.exit(1)

    with open(source, 'r', encoding='utf-8') as f:
        try:
            data = json.load(f)
        except json.JSONDecodeError as e:
            print(f'Error leyendo JSON: {e}')
            sys.exit(1)

    sent, errors = process_nikto(data, api_url, collector_id)
    print(f'\nResumen: {sent} enviados, {errors} errores')

if __name__ == '__main__':
    main()
