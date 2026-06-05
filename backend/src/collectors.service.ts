import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { FindingsService } from './findings.service';
import { PrismaService } from './prisma.service';
import { TelemetryService } from './telemetry.service';
import { ReportsService } from './reports.service';
import * as xml2js from 'xml2js';

// ─── Interfaz común para todos los parsers ────────────────────────────────────
export interface ParsedFinding {
  assetId: string;
  category: string;
  severity: string;
  title: string;
  description?: string;
  sourceTool: string;
  evidence?: Record<string, unknown>;
  cve?: string;
  cvss?: number;
}

export interface ToolParser {
  readonly name: string;
  readonly description: string;
  readonly category: string;
  parse(rawContent: string, meta?: Record<string, string>): Promise<ParsedFinding[]>;
}

// ─── Mapa de severidad por puerto (Nmap) ──────────────────────────────────────
const PORT_SEVERITY: Record<number, [string, string]> = {
  21:    ['HIGH',     'FTP sin cifrar expuesto'],
  23:    ['CRITICAL', 'Telnet sin cifrar expuesto'],
  445:   ['HIGH',     'SMB expuesto'],
  3389:  ['HIGH',     'RDP expuesto'],
  1433:  ['HIGH',     'MSSQL expuesto'],
  3306:  ['HIGH',     'MySQL expuesto'],
  5432:  ['HIGH',     'PostgreSQL expuesto'],
  27017: ['HIGH',     'MongoDB expuesto'],
  6379:  ['HIGH',     'Redis sin autenticación'],
  9200:  ['HIGH',     'Elasticsearch expuesto'],
  2375:  ['CRITICAL', 'Docker daemon sin TLS'],
  4444:  ['CRITICAL', 'Puerto de backdoor (4444)'],
  8080:  ['MEDIUM',   'HTTP alternativo expuesto'],
  8443:  ['MEDIUM',   'HTTPS alternativo expuesto'],
  5900:  ['HIGH',     'VNC expuesto'],
  2049:  ['HIGH',     'NFS expuesto'],
  111:   ['MEDIUM',   'RPC portmapper expuesto'],
};

const CVE_RE = /CVE-\d{4}-\d+/i;

// ─── Parser: Nmap XML ─────────────────────────────────────────────────────────
class NmapParser implements ToolParser {
  readonly name = 'nmap';
  readonly description = 'Port scanner + service/version detection (Nmap XML output)';
  readonly category = 'DISCOVERY';

  async parse(rawContent: string): Promise<ParsedFinding[]> {
    const result = await xml2js.parseStringPromise(rawContent, { explicitArray: true });
    const findings: ParsedFinding[] = [];
    const hosts: any[] = result?.nmaprun?.host ?? [];

    for (const host of hosts) {
      const status = host.status?.[0]?.$.state;
      if (status !== 'up') continue;

      const ipEl = (host.address ?? []).find((a: any) => a.$.addrtype === 'ipv4' || a.$.addrtype === 'ipv6');
      const ip: string = ipEl?.$.addr ?? 'unknown';
      const hostname: string = host.hostnames?.[0]?.hostname?.[0]?.$.name ?? ip;
      const assetId = hostname !== ip ? hostname : ip;

      const ports: any[] = host.ports?.[0]?.port ?? [];
      for (const port of ports) {
        if (port.state?.[0]?.$.state !== 'open') continue;

        const portid = parseInt(port.$.portid, 10);
        const proto = port.$.protocol ?? 'tcp';
        const svc = port.service?.[0]?.$;
        const service = svc?.name ?? 'unknown';
        const product = svc?.product ?? '';
        const version = svc?.version ?? '';

        const [severity, reason] = PORT_SEVERITY[portid] ?? this.defaultSeverity(service);
        const banner = [product, version].filter(Boolean).join(' ');
        const title = `${reason} — ${ip}:${portid}/${proto}${banner ? ` (${banner})` : ''}`;

        findings.push({
          assetId,
          category: 'OPEN_PORT',
          severity,
          title: title.slice(0, 200),
          description: `Puerto ${portid}/${proto} abierto en ${ip}. Servicio: ${service}${banner ? ` ${banner}` : ''}`.trim(),
          sourceTool: 'nmap',
          evidence: { ip, port: portid, protocol: proto, service, product, version },
        });
      }
    }
    return findings;
  }

  private defaultSeverity(service: string): [string, string] {
    if (['telnet', 'ftp', 'rsh', 'rlogin'].includes(service)) return ['HIGH', `Servicio inseguro: ${service}`];
    if (['ssh', 'https'].includes(service)) return ['LOW', `Servicio cifrado: ${service}`];
    return ['MEDIUM', `Servicio expuesto: ${service}`];
  }
}

// ─── Parser: Nuclei JSONL ─────────────────────────────────────────────────────
class NucleiParser implements ToolParser {
  readonly name = 'nuclei';
  readonly description = 'Template-based vulnerability scanner (Nuclei JSONL output)';
  readonly category = 'VULNERABILITY';

  private readonly severityMap: Record<string, string> = {
    critical: 'CRITICAL', high: 'HIGH', medium: 'MEDIUM', low: 'LOW', info: 'INFO',
  };

  private readonly categoryMap: Record<string, string> = {
    cve: 'CVE', rce: 'RCE', sqli: 'SQL_INJECTION', xss: 'XSS',
    lfi: 'LFI', ssrf: 'SSRF', xxe: 'XXE', exposure: 'INFO_DISCLOSURE',
    misconfiguration: 'MISCONFIGURATION', 'default-credentials': 'WEAK_CREDENTIALS',
    takeover: 'SUBDOMAIN_TAKEOVER', injection: 'INJECTION',
  };

  async parse(rawContent: string): Promise<ParsedFinding[]> {
    const findings: ParsedFinding[] = [];
    const lines = rawContent.split('\n').filter(l => l.trim());

    for (const line of lines) {
      try {
        const r = JSON.parse(line);
        const info = r.info ?? {};
        const templateId: string = r['template-id'] ?? r.templateID ?? 'unknown';
        const tags: string[] = Array.isArray(info.tags) ? info.tags
          : typeof info.tags === 'string' ? info.tags.split(',').map((t: string) => t.trim()) : [];
        const refs: string[] = Array.isArray(info.reference) ? info.reference
          : typeof info.reference === 'string' ? [info.reference] : [];

        const severity = this.severityMap[info.severity?.toLowerCase() ?? ''] ?? 'INFO';
        const category = this.resolveCategory(templateId, tags);
        const cve = this.extractCve(templateId, tags, refs);

        const host: string = r.host ?? r.url ?? 'unknown';
        let assetId = host;
        try { assetId = new URL(host).hostname; } catch { /* not a URL */ }

        findings.push({
          assetId,
          category,
          severity,
          title: (info.name ?? templateId).slice(0, 200),
          description: (info.description ?? `Nuclei: ${templateId} en ${r['matched-at'] ?? host}`).slice(0, 1000),
          sourceTool: 'nuclei',
          evidence: {
            template: templateId,
            matched_at: r['matched-at'] ?? r.matched,
            tags,
            references: refs.slice(0, 5),
          },
          ...(cve ? { cve } : {}),
        });
      } catch { /* non-JSON line (banner), skip */ }
    }
    return findings;
  }

  private resolveCategory(templateId: string, tags: string[]): string {
    if (CVE_RE.test(templateId)) return 'CVE';
    for (const tag of tags) {
      const mapped = this.categoryMap[tag.toLowerCase()];
      if (mapped) return mapped;
    }
    const lower = templateId.toLowerCase();
    for (const [key, val] of Object.entries(this.categoryMap)) {
      if (lower.includes(key)) return val;
    }
    return 'VULNERABILITY';
  }

  private extractCve(templateId: string, tags: string[], refs: string[]): string | undefined {
    for (const src of [templateId, ...tags, ...refs]) {
      const m = CVE_RE.exec(src);
      if (m) return m[0].toUpperCase();
    }
    return undefined;
  }
}

// ─── Parser: Nikto JSON ───────────────────────────────────────────────────────
class NiktoParser implements ToolParser {
  readonly name = 'nikto';
  readonly description = 'Web server misconfiguration and vulnerability scanner (Nikto JSON)';
  readonly category = 'MISCONFIGURATION';

  private readonly criticalKw = ['sql injection', 'sqli', 'remote code execution', 'rce', 'auth bypass', 'arbitrary file'];
  private readonly highKw = ['xss', 'cross-site scripting', 'file inclusion', 'lfi', 'rfi', 'path traversal', 'default password', 'buffer overflow', 'ssrf', 'csrf'];
  private readonly mediumKw = ['directory listing', 'information disclosure', 'version disclosure', 'debug', 'backup', 'phpinfo', 'server-status', 'admin interface'];

  async parse(rawContent: string): Promise<ParsedFinding[]> {
    const data = JSON.parse(rawContent);
    const hosts: any[] = Array.isArray(data) ? data : [data];
    const findings: ParsedFinding[] = [];

    for (const host of hosts) {
      const assetId: string = host.host ?? host.ip ?? 'unknown';
      const port: number = host.port ?? 80;
      const vulns: any[] = host.vulnerabilities ?? host.items ?? (host.msg ? [host] : []);

      for (const vuln of vulns) {
        const msg: string = vuln.msg ?? vuln.message ?? vuln.description ?? '';
        if (!msg) continue;

        const severity = this.classifySeverity(msg);
        const category = this.classifyCategory(msg);
        const cveMatch = CVE_RE.exec(msg);

        findings.push({
          assetId,
          category,
          severity,
          title: msg.slice(0, 200),
          description: msg.slice(0, 1000),
          sourceTool: 'nikto',
          evidence: {
            url: vuln.url ?? vuln.uri,
            method: vuln.method ?? 'GET',
            osvdb: vuln.id ? String(vuln.id) : undefined,
            port,
          },
          ...(cveMatch ? { cve: cveMatch[0].toUpperCase() } : {}),
        });
      }
    }
    return findings;
  }

  private classifySeverity(msg: string): string {
    const m = msg.toLowerCase();
    if (this.criticalKw.some(k => m.includes(k))) return 'CRITICAL';
    if (this.highKw.some(k => m.includes(k))) return 'HIGH';
    if (this.mediumKw.some(k => m.includes(k))) return 'MEDIUM';
    return 'LOW';
  }

  private classifyCategory(msg: string): string {
    const m = msg.toLowerCase();
    if (m.includes('sql')) return 'SQL_INJECTION';
    if (m.includes('xss') || m.includes('cross-site')) return 'XSS';
    if (m.includes('inclusion') || m.includes('lfi')) return 'LFI';
    if (m.includes('rce') || m.includes('remote code')) return 'RCE';
    if (m.includes('directory') || m.includes('traversal')) return 'PATH_TRAVERSAL';
    if (m.includes('disclosure') || m.includes('version')) return 'INFO_DISCLOSURE';
    if (m.includes('credential') || m.includes('password')) return 'WEAK_CREDENTIALS';
    if (m.includes('csrf')) return 'CSRF';
    return 'WEB_VULNERABILITY';
  }
}

// ─── Parser: Gobuster ─────────────────────────────────────────────────────────
class GobusterParser implements ToolParser {
  readonly name = 'gobuster';
  readonly description = 'Directory brute-force scanner';
  readonly category = 'EXPOSURE';

  private readonly SENSITIVE_KW = ['admin', 'backup', 'config', '.git', '.env', 'debug', 'secret', 'private', 'sql', 'test', 'phpmy'];
  private readonly SENSITIVE_EXT = ['.php', '.bak', '.sql', '.env', '.config', '.xml', '.json', '.log', '.key', '.pem'];

  async parse(rawContent: string, meta?: Record<string, string>): Promise<ParsedFinding[]> {
    // Derive host: prefer explicit meta, otherwise extract from redirect lines like [--> https://host/path]
    const redirectMatch = rawContent.match(/\[-->\s*https?:\/\/([^\s\/\]]+)/);
    const assetId = meta?.host ?? redirectMatch?.[1] ?? 'unknown';

    const findings: ParsedFinding[] = [];
    for (const raw of rawContent.split('\n')) {
      const line = raw.trim();
      // Gobuster dir output: "/path  (Status: 200) [Size: 1234]"
      if (!line.startsWith('/')) continue;
      const path = line.split(/\s+/)[0];
      if (!path || path === '/') continue;
      const statusMatch = line.match(/Status:\s*(\d+)/);
      const status = statusMatch?.[1] ?? '200';
      findings.push({
        assetId,
        category: 'EXPOSURE',
        severity: this.pathSeverity(path, status),
        title: `Ruta expuesta: ${path}`,
        description: `Gobuster encontró HTTP ${status} en ${path}`,
        sourceTool: 'gobuster',
        evidence: { path, statusCode: status },
      });
    }
    return findings;
  }

  private pathSeverity(path: string, status: string): string {
    const lower = path.toLowerCase();
    const ext = path.includes('.') ? `.${path.split('.').pop()?.toLowerCase()}` : '';
    if (this.SENSITIVE_KW.some(k => lower.includes(k)) || this.SENSITIVE_EXT.includes(ext)) return 'HIGH';
    if (['200', '301', '302'].includes(status)) return 'LOW';
    return 'INFO';
  }
}

// ─── Parser: WhatWeb JSON ─────────────────────────────────────────────────────
class WhatWebParser implements ToolParser {
  readonly name = 'whatweb';
  readonly description = 'Web technology fingerprinting';
  readonly category = 'RECON';

  // CMS/frameworks con historial de vulnerabilidades frecuentes
  private readonly RISKY_CMS = new Set(['WordPress', 'Joomla', 'Drupal', 'Magento', 'phpMyAdmin', 'TYPO3']);

  async parse(rawContent: string): Promise<ParsedFinding[]> {
    const findings: ParsedFinding[] = [];
    let hosts: any[] = [];

    try {
      const parsed = JSON.parse(rawContent.trim());
      hosts = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // Formato JSONL (una línea por host)
      hosts = rawContent.split('\n')
        .filter(l => l.trim().startsWith('{'))
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
    }

    for (const host of hosts) {
      const target: string = host.target ?? host.url ?? 'unknown';
      const plugins: Record<string, any> = host.plugins ?? {};
      const assetId = this.extractHost(target);
      const techList = Object.keys(plugins);
      if (techList.length === 0) continue;

      // Hallazgo resumen: stack tecnológico completo → INFO
      const techSummary = techList.map(tech => {
        const versions: string[] = plugins[tech]?.version ?? [];
        return versions.length ? `${tech}/${versions[0]}` : tech;
      }).join(', ');

      findings.push({
        assetId,
        category: 'RECON',
        severity: 'INFO',
        title: `Stack tecnológico detectado en ${assetId}`,
        description: `WhatWeb identificó: ${techSummary}`,
        sourceTool: 'whatweb',
        evidence: { target, httpStatus: host.http_status, technologies: techList },
      });

      // Hallazgo individual por tecnologías de alto riesgo o versiones EOL
      for (const [tech, data] of Object.entries<any>(plugins)) {
        const versions: string[] = data?.version ?? [];
        const version = versions[0] ?? '';
        const { severity, note } = this.assessTech(tech, version);
        if (severity === 'INFO') continue;

        findings.push({
          assetId,
          category: 'CONFIG',
          severity,
          title: note,
          description: `${tech}${version ? ` ${version}` : ''} detectado en ${assetId}. ${note}`,
          sourceTool: 'whatweb',
          evidence: { target, technology: tech, version, raw: data },
        });
      }
    }

    return findings;
  }

  private extractHost(url: string): string {
    try { return new URL(url).hostname; } catch { return url; }
  }

  private assessTech(tech: string, version: string): { severity: string; note: string } {
    const major = parseInt(version.split('.')[0] ?? '0', 10);

    if (tech === 'PHP') {
      if (major <= 5) return { severity: 'CRITICAL', note: `PHP ${version} — EOL, sin soporte de seguridad` };
      if (major <= 7) return { severity: 'HIGH',     note: `PHP ${version} — EOL desde Nov 2022` };
      return { severity: 'INFO', note: `PHP ${version}` };
    }

    if (tech === 'Apache') {
      const minor = parseInt(version.split('.')[1] ?? '4', 10);
      if (major === 2 && minor <= 2) return { severity: 'HIGH', note: `Apache 2.2 — EOL, vulnerabilidades conocidas` };
      return { severity: 'INFO', note: `Apache ${version}` };
    }

    if (tech === 'jQuery' || tech === 'JQuery') {
      if (major > 0 && major < 3) return { severity: 'MEDIUM', note: `jQuery ${version} — versión antigua con XSS conocidos (CVE-2019-11358)` };
      return { severity: 'INFO', note: `jQuery ${version}` };
    }

    if (this.RISKY_CMS.has(tech)) {
      if (version) return { severity: 'MEDIUM', note: `${tech} ${version} — versión expuesta, verificar actualizaciones` };
      return { severity: 'LOW', note: `${tech} detectado — actualizar a la última versión` };
    }

    return { severity: 'INFO', note: `${tech} detectado` };
  }
}

// ─── Registro de plugins ──────────────────────────────────────────────────────
// Para agregar una nueva herramienta: implementa ToolParser y agrégala aquí.
const PARSERS: ToolParser[] = [
  new NmapParser(),
  new NucleiParser(),
  new NiktoParser(),
  new GobusterParser(),
  new WhatWebParser(),
  // new OpenVasParser(),
  // new BurpParser(),
];

// ─── CollectorsService ────────────────────────────────────────────────────────
@Injectable()
export class CollectorsService {
  private readonly logger = new Logger(CollectorsService.name);
  private readonly parserMap = new Map<string, ToolParser>(
    PARSERS.map(p => [p.name, p]),
  );

  constructor(
    private readonly findings: FindingsService,
    private readonly prisma: PrismaService,
    private readonly telemetry: TelemetryService,
    private readonly reports: ReportsService,
    @InjectQueue('scan-reports-ai') private readonly scanReportsQueue: Queue,
  ) {}

  listPlugins() {
    return PARSERS.map(p => ({ name: p.name, description: p.description, category: p.category }));
  }

  async listSessions(orgId: string, limit = 50) {
    return this.prisma.scanSession.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async upload(tool: string, rawContent: string, collectorId: string, scanId?: string): Promise<{ accepted: number; errors: number }> {
    const parser = this.parserMap.get(tool.toLowerCase());
    if (!parser) {
      throw new BadRequestException(
        `Herramienta desconocida: "${tool}". Disponibles: ${[...this.parserMap.keys()].join(', ')}`,
      );
    }

    let parsed: ParsedFinding[];
    try {
      parsed = await parser.parse(rawContent, { host: collectorId });
    } catch (err: any) {
      throw new BadRequestException(`Error parseando output de ${tool}: ${err.message}`);
    }

    this.logger.log(`[${tool}] ${parsed.length} hallazgos recibidos de collector "${collectorId}"`);

    let accepted = 0;
    let errors = 0;
    for (const finding of parsed) {
      try {
        await this.findings.ingest({ ...finding, collectorId, scanId });
        accepted++;
      } catch {
        errors++;
      }
    }

    this.logger.log(`[${tool}] aceptados=${accepted} errores=${errors}`);

    // Registrar sesión de scan para historial (fire-and-forget)
    if (scanId) {
      this.prisma.scanSession.create({
        data: {
          scanId,
          collectorId,
          tool,
          orgId: 'org_demo',
          findingsAccepted: accepted,
          findingsErrors: errors,
        },
      }).catch((err: Error) => this.logger.warn(`[ScanSession] No se pudo registrar: ${err.message}`));
    }

    return { accepted, errors };
  }

  async handleScanProgress(data: {
    scanId: string;
    collectorId: string;
    event: string;
    tool?: string;
    findingsCount?: number;
  }): Promise<void> {
    // Registrar sesión cuando una herramienta termina
    if (data.event === 'tool:done' && data.tool) {
      this.prisma.scanSession.create({
        data: {
          scanId: data.scanId,
          collectorId: data.collectorId,
          tool: data.tool,
          orgId: 'org_demo',
          findingsAccepted: data.findingsCount ?? 0,
          findingsErrors: 0,
        },
      }).catch((err: Error) => this.logger.warn(`[ScanSession] Progress record failed: ${err.message}`));
    }

    // Marcar ScanJob como completado y encolar informe ejecutivo de IA
    if (data.event === 'scan:done') {
      this.prisma.scanJob.updateMany({
        where: { scanId: data.scanId },
        data: { status: 'DONE', completedAt: new Date() },
      }).catch((err: Error) => this.logger.warn(`[ScanJob] Update on scan:done failed: ${err.message}`));

      // Obtener dominio del ScanJob para el informe ejecutivo
      this.prisma.scanJob.findUnique({ where: { scanId: data.scanId } })
        .then((job) => {
          const asset = job?.domain ?? data.collectorId;
          return this.scanReportsQueue.add(
            'generate-executive',
            { scanId: data.scanId, asset, orgId: job?.orgId ?? 'org_demo' },
            { delay: 5000, attempts: 2, backoff: { type: 'exponential', delay: 3000 } },
          );
        })
        .then(() => this.logger.log(`[ScanReportsAI] Job enqueued for scanId=${data.scanId}`))
        .catch((err: Error) => this.logger.warn(`[ScanReportsAI] Enqueue failed: ${err.message}`));

      // Auto-generate technical delta report
      setTimeout(() => {
        this.reports.generateScanReport(data.scanId)
          .then(() => this.logger.log(`[ScanReport] Technical report generated for scanId=${data.scanId}`))
          .catch((err: Error) => this.logger.warn(`[ScanReport] Auto-generate failed: ${err.message}`));
      }, 3000);
    }

    // Broadcast en tiempo real via WebSocket
    await this.telemetry.publish({
      id: randomUUID(),
      type: 'scan:progress',
      source: data.collectorId,
      payload: {
        organizationId: 'org_demo',
        scanId: data.scanId,
        collectorId: data.collectorId,
        event: data.event,
        tool: data.tool ?? null,
        findingsCount: data.findingsCount ?? 0,
      },
      timestamp: new Date(),
    });
  }

  // ─── Cancelación de scans ───────────────────────────────────────────────────

  /** Cancela un scan específico por scanId. */
  async cancelScan(scanId: string): Promise<{ cancelled: boolean }> {
    const result = await this.prisma.scanJob.updateMany({
      where: { scanId, status: { in: ['RUNNING', 'PENDING'] } },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
    if (result.count > 0) {
      this.logger.log(`[cancelScan] scanId=${scanId} marcado como CANCELLED`);
      await this.telemetry.publish({
        id: randomUUID(),
        type: 'scan:progress',
        source: 'api',
        payload: { organizationId: 'org_demo', scanId, collectorId: 'api', event: 'scan:cancelled' },
        timestamp: new Date(),
      });
    }
    return { cancelled: result.count > 0 };
  }

  /** Cancela todos los scans RUNNING/PENDING de una org que llevan más de 30 min. */
  async cancelAllStaleScans(orgId: string): Promise<{ cancelled: number }> {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    const result = await this.prisma.scanJob.updateMany({
      where: { orgId, status: { in: ['RUNNING', 'PENDING'] }, startedAt: { lt: cutoff } },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
    if (result.count > 0) this.logger.log(`[cancelStale] ${result.count} scans cancelados para org=${orgId}`);
    return { cancelled: result.count };
  }
}
