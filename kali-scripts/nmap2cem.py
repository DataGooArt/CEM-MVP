#!/usr/bin/env python3
"""
nmap2cem.py — Envia hallazgos de Nmap al CEM Platform.

Uso:
    nmap -sV --open -oX /tmp/scan.xml <TARGET>
    python3 nmap2cem.py /tmp/scan.xml http://<CEM_HOST>:3001

Variables de entorno:
    CEM_API   — URL base del API (alternativa al argumento)
    CEM_TOKEN — valor del header x-collector-id (por defecto: kali-nmap)
"""

import sys
import os
import json
import xml.etree.ElementTree as ET
import requests
from urllib.parse import urlparse

SEVERITY_BY_PORT = {
    21: ('HIGH', 'FTP sin cifrar'),
    23: ('CRITICAL', 'Telnet sin cifrar'),
    445: ('HIGH', 'SMB expuesto'),
    3389: ('HIGH', 'RDP expuesto'),
    1433: ('HIGH', 'MSSQL expuesto'),
    3306: ('HIGH', 'MySQL expuesto'),
    5432: ('HIGH', 'PostgreSQL expuesto'),
    27017: ('HIGH', 'MongoDB expuesto'),
    6379: ('HIGH', 'Redis sin autenticación'),
    9200: ('HIGH', 'Elasticsearch expuesto'),
    2375: ('CRITICAL', 'Docker daemon sin TLS'),
    4444: ('CRITICAL', 'Puerto de backdoor common (4444)'),
    8080: ('MEDIUM', 'HTTP alternativo expuesto'),
    8443: ('MEDIUM', 'HTTPS alternativo expuesto'),
}

def severity_for_port(portid: int, service: str) -> tuple[str, str]:
    if portid in SEVERITY_BY_PORT:
        return SEVERITY_BY_PORT[portid]
    if service in ('ftp', 'telnet', 'rsh', 'rlogin'):
        return ('HIGH', f'Servicio inseguro: {service}')
    if service in ('ssh', 'https', 'ssl'):
        return ('LOW', f'Servicio seguro: {service}')
    return ('MEDIUM', f'Puerto abierto: {portid}/{service}')

def parse_and_send(xml_file: str, api_url: str, collector_id: str) -> None:
    tree = ET.parse(xml_file)
    root = tree.getroot()
    sent = 0
    errors = 0

    for host in root.findall('.//host'):
        state_el = host.find('.//status')
        if state_el is None or state_el.get('state') != 'up':
            continue

        addr_el = host.find('.//address[@addrtype="ipv4"]')
        if addr_el is None:
            addr_el = host.find('.//address[@addrtype="ipv6"]')
        if addr_el is None:
            continue
        ip = addr_el.get('addr', 'unknown')

        hostname_el = host.find('.//hostname')
        asset_id = hostname_el.get('name', ip) if hostname_el is not None else ip

        for port in host.findall('.//port'):
            port_state = port.find('state')
            if port_state is None or port_state.get('state') != 'open':
                continue

            portid = int(port.get('portid', 0))
            proto = port.get('protocol', 'tcp')
            svc_el = port.find('service')
            service = svc_el.get('name', 'unknown') if svc_el is not None else 'unknown'
            product = svc_el.get('product', '') if svc_el is not None else ''
            version = svc_el.get('version', '') if svc_el is not None else ''

            severity, reason = severity_for_port(portid, service)
            title = f'{reason} — {ip}:{portid}/{proto}'
            if product:
                title += f' ({product} {version})'.rstrip()

            evidence = {
                'ip': ip,
                'port': portid,
                'protocol': proto,
                'service': service,
                'product': product,
                'version': version,
            }

            payload = {
                'assetId': asset_id,
                'category': 'OPEN_PORT',
                'severity': severity,
                'title': title[:200],
                'description': f'Puerto {portid}/{proto} abierto en {ip}. Servicio detectado: {product} {version}'.strip(),
                'sourceTool': 'nmap',
                'evidence': evidence,
            }

            try:
                resp = requests.post(
                    f'{api_url}/api/v1/findings/ingest',
                    headers={'Content-Type': 'application/json', 'x-collector-id': collector_id},
                    json=payload,
                    timeout=10,
                )
                resp.raise_for_status()
                print(f'[OK] {ip}:{portid}/{service} → {severity}')
                sent += 1
            except requests.RequestException as e:
                print(f'[ERR] {ip}:{portid} — {e}')
                errors += 1

    print(f'\nResumen: {sent} enviados, {errors} errores')

if __name__ == '__main__':
    xml_file = sys.argv[1] if len(sys.argv) > 1 else None
    api_url = sys.argv[2] if len(sys.argv) > 2 else os.environ.get('CEM_API', 'http://localhost:3001')
    collector_id = os.environ.get('CEM_TOKEN', 'kali-nmap')

    if not xml_file:
        print('Uso: python3 nmap2cem.py <scan.xml> [http://cem-host:3001]')
        sys.exit(1)

    api_url = api_url.rstrip('/')
    parse_and_send(xml_file, api_url, collector_id)
