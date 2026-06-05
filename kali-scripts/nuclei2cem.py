#!/usr/bin/env python3
"""
nuclei2cem.py — Envia hallazgos de Nuclei al CEM Platform.

Uso:
    nuclei -u https://target.com -json -o nuclei.json
    python3 nuclei2cem.py nuclei.json http://<CEM_HOST>:3001

  O en pipeline:
    nuclei -u https://target.com -json -silent | python3 nuclei2cem.py - http://<CEM_HOST>:3001

Variables de entorno:
    CEM_API   — URL base del API (alternativa al argumento)
    CEM_TOKEN — valor del header x-collector-id (por defecto: kali-nuclei)
"""

import sys
import os
import json
import re
import requests

SEVERITY_MAP = {
    'critical': 'CRITICAL',
    'high':     'HIGH',
    'medium':   'MEDIUM',
    'low':      'LOW',
    'info':     'INFO',
    'unknown':  'INFO',
}

CATEGORY_MAP = {
    'cve':                 'CVE',
    'rce':                 'RCE',
    'sqli':                'SQL_INJECTION',
    'xss':                 'XSS',
    'lfi':                 'LFI',
    'ssrf':                'SSRF',
    'xxe':                 'XXE',
    'idor':                'IDOR',
    'exposure':            'INFO_DISCLOSURE',
    'misconfiguration':    'MISCONFIGURATION',
    'default-credentials': 'WEAK_CREDENTIALS',
    'auth-bypass':         'AUTH_BYPASS',
    'injection':           'INJECTION',
    'file-inclusion':      'LFI',
    'open-redirect':       'OPEN_REDIRECT',
    'takeover':            'SUBDOMAIN_TAKEOVER',
}

CVE_RE = re.compile(r'CVE-\d{4}-\d+', re.IGNORECASE)

def classify_category(template_id: str, tags: list) -> str:
    tid_lower = template_id.lower()
    if CVE_RE.search(template_id):
        return 'CVE'
    for tag in tags:
        t = tag.lower()
        if t in CATEGORY_MAP:
            return CATEGORY_MAP[t]
    for key in CATEGORY_MAP:
        if key in tid_lower:
            return CATEGORY_MAP[key]
    return 'VULNERABILITY'

def extract_cve(template_id: str, tags: list, refs: list) -> str | None:
    m = CVE_RE.search(template_id)
    if m:
        return m.group(0).upper()
    for tag in tags:
        m = CVE_RE.search(tag)
        if m:
            return m.group(0).upper()
    for ref in refs:
        m = CVE_RE.search(ref)
        if m:
            return m.group(0).upper()
    return None

def process_line(line: str, api_url: str, collector_id: str) -> bool:
    line = line.strip()
    if not line:
        return True
    try:
        r = json.loads(line)
    except json.JSONDecodeError:
        return True  # línea no JSON (ej. banner de nuclei), ignorar

    info = r.get('info', {})
    template_id = r.get('template-id', r.get('templateID', 'unknown'))
    name = info.get('name', template_id)
    severity_raw = info.get('severity', 'unknown').lower()
    severity = SEVERITY_MAP.get(severity_raw, 'INFO')
    host = r.get('host', r.get('url', 'unknown'))
    matched_at = r.get('matched-at', r.get('matched', host))
    description = info.get('description', '')
    tags = info.get('tags', [])
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(',')]
    refs = info.get('reference', [])
    if isinstance(refs, str):
        refs = [refs]

    category = classify_category(template_id, tags)
    cve = extract_cve(template_id, tags, refs)

    # Extraer asset_id del host (sin esquema, sin path)
    asset_id = host
    try:
        from urllib.parse import urlparse
        p = urlparse(host)
        asset_id = p.hostname or host
    except Exception:
        pass

    evidence = {
        'template': template_id,
        'matched_at': matched_at,
        'tags': tags,
        'references': refs[:5],
    }
    if r.get('extracted-results'):
        evidence['extracted'] = r['extracted-results']
    if r.get('curl-command'):
        evidence['curl_command'] = r['curl-command']

    payload = {
        'assetId': asset_id,
        'category': category,
        'severity': severity,
        'title': name[:200],
        'description': description[:1000] if description else f'Nuclei encontró {template_id} en {matched_at}',
        'sourceTool': 'nuclei',
        'evidence': evidence,
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
        print(f'[OK] {template_id} → {severity} ({asset_id})')
        return True
    except requests.RequestException as e:
        print(f'[ERR] {template_id} — {e}')
        return False

def main():
    source = sys.argv[1] if len(sys.argv) > 1 else None
    api_url = sys.argv[2] if len(sys.argv) > 2 else os.environ.get('CEM_API', 'http://localhost:3001')
    collector_id = os.environ.get('CEM_TOKEN', 'kali-nuclei')
    api_url = api_url.rstrip('/')

    if not source:
        print('Uso: python3 nuclei2cem.py <nuclei.json|-> [http://cem-host:3001]')
        sys.exit(1)

    sent = errors = 0
    lines = []

    if source == '-':
        lines = sys.stdin.readlines()
    else:
        with open(source, 'r', encoding='utf-8') as f:
            lines = f.readlines()

    for line in lines:
        ok = process_line(line, api_url, collector_id)
        if ok:
            sent += 1
        else:
            errors += 1

    print(f'\nResumen: {sent} enviados, {errors} errores')

if __name__ == '__main__':
    main()
