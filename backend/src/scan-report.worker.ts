import { Injectable, Logger } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { GoogleGenAI } from '@google/genai';
import { PrismaService } from './prisma.service';

type Provider = 'gemini' | 'ollama' | 'fallback';

@Injectable()
export class ScanReportWorker {
  private readonly logger = new Logger(ScanReportWorker.name);
  private readonly ollamaUrl = process.env.OLLAMA_URL || 'http://ollama:11434';
  private readonly ollamaModel = process.env.OLLAMA_REPORT_MODEL || 'qwen3:4b';
  private readonly geminiKey = process.env.GEMINI_API_KEY || '';
  private readonly geminiModel = process.env.GEMINI_REPORT_MODEL || 'gemini-2.0-flash';

  constructor(private readonly prisma: PrismaService) {}

  start() {
    const worker = new Worker(
      'scan-reports-ai',
      async (job: Job) => this.process(job),
      {
        connection: { url: process.env.REDIS_URL || 'redis://redis:6379' },
        concurrency: 1,
      },
    );
    worker.on('failed', (j, err) =>
      this.logger.error(`Report job ${j?.id} failed: ${err.message}`),
    );
    const mode = this.geminiKey
      ? `gemini:${this.geminiModel} → ollama:${this.ollamaModel}`
      : `ollama-only (${this.ollamaModel})`;
    this.logger.log(`ScanReportWorker started — mode: ${mode}`);
  }

  private async process(job: Job) {
    const { scanId, asset, orgId } = job.data as {
      scanId: string;
      asset: string;
      orgId?: string;
    };

    // 1. Recuperar todos los findings del escaneo
    const findings = await this.prisma.finding.findMany({
      where: { scanId },
      orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }],
    });

    if (findings.length === 0) {
      this.logger.warn(`No findings for scan ${scanId}, skipping AI report`);
      return;
    }

    // 2. Obtener delta del ScanReport (si ya fue generado)
    const scanReport = await this.prisma.scanReport.findUnique({ where: { scanId } });

    // 3. Consolidar contexto técnico
    const context = this.buildContext(findings, asset, scanReport);

    // 4. Construir prompt
    const prompt = this.buildPrompt(context);

    // 5. Gemini → Ollama fallback
    let reportJson: any = null;
    let providerUsed: Provider = 'ollama';
    let modelUsed = this.ollamaModel;

    const providers = this.geminiKey
      ? (['gemini', 'ollama'] as const)
      : (['ollama'] as const);

    for (const provider of providers) {
      try {
        const raw =
          provider === 'gemini'
            ? await this.callGemini(prompt)
            : await this.callOllama(prompt);
        reportJson = this.parseJson(raw);
        providerUsed = provider;
        modelUsed = provider === 'gemini' ? this.geminiModel : this.ollamaModel;
        this.logger.log(
          `[${provider}] AI report generated for ${scanId} — score: ${reportJson?.score}`,
        );
        break;
      } catch (err: any) {
        const hasNext = providers.indexOf(provider as any) < providers.length - 1;
        this.logger.warn(
          `[${provider}] failed (${err.message})${hasNext ? ', falling back...' : ''}`,
        );
      }
    }

    // 6. Fallback estructurado si todos los proveedores fallan
    if (!reportJson) {
      reportJson = this.buildFallbackReport(findings, context);
      providerUsed = 'fallback';
      modelUsed = 'none';
      this.logger.warn(`All AI providers failed for ${scanId}, using structured fallback`);
    }

    // 7. Guardar en base de datos
    await this.prisma.aiScanReport.upsert({
      where: { scanId },
      update: {
        asset,
        provider: providerUsed,
        model: modelUsed,
        score: reportJson.score ?? 5,
        executiveSummary:   reportJson.executiveSummary   ?? 'Informe no disponible.',
        technicalSummary:   reportJson.technicalSummary   ?? '',
        topRisks:           reportJson.topRisks           ?? [],
        attackSurface:      reportJson.attackSurface      ?? {},
        remediationRoadmap: reportJson.remediationRoadmap ?? {},
        complianceFlags:    reportJson.complianceFlags    ?? [],
        segmentedAnalysis:  reportJson.segmentedAnalysis  ?? null,
      },
      create: {
        scanId,
        asset,
        orgId: orgId ?? 'org_demo',
        provider: providerUsed,
        model: modelUsed,
        score: reportJson.score ?? 5,
        executiveSummary:   reportJson.executiveSummary   ?? 'Informe no disponible.',
        technicalSummary:   reportJson.technicalSummary   ?? '',
        topRisks:           reportJson.topRisks           ?? [],
        attackSurface:      reportJson.attackSurface      ?? {},
        remediationRoadmap: reportJson.remediationRoadmap ?? {},
        complianceFlags:    reportJson.complianceFlags    ?? [],
        segmentedAnalysis:  reportJson.segmentedAnalysis  ?? null,
      },
    });

    this.logger.log(`AiScanReport saved for scanId=${scanId}, asset=${asset}, score=${reportJson.score}`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CONSOLIDACIÓN DE CONTEXTO
  // ───────────────────────────────────────────────────────────────────────────
  private buildContext(findings: any[], asset: string, scanReport?: any) {
    const byTool = (tool: string) => findings.filter((f) => f.sourceTool === tool);
    const severityCount = (sev: string) =>
      findings.filter((f) => f.severity === sev).length;

    // Deduplicar tecnologías identificadas por WhatWeb
    const techSet = new Set<string>();
    byTool('whatweb').forEach((f) => {
      const ev = f.evidence as any;
      if (Array.isArray(ev?.technologies)) {
        ev.technologies.forEach((t: string) => techSet.add(t));
      }
    });

    // Puertos abiertos de Nmap
    const ports = byTool('nmap')
      .map((f) => (f.evidence as any)?.port ?? null)
      .filter((p): p is number => p !== null);

    // Problemas SSL/TLS (sslscan + testssl) — limitar a severity >= MEDIUM para evitar ruido
    const sslIssues = [...byTool('sslscan'), ...byTool('testssl')]
      .filter((f) => ['CRITICAL', 'HIGH', 'MEDIUM'].includes(f.severity))
      .map((f) => f.title)
      .slice(0, 20); // límite para no saturar el prompt

    // Endpoints sensibles expuestos (gobuster, ffuf, nikto) excluyendo INFO
    const exposedEndpoints = [...byTool('gobuster'), ...byTool('ffuf'), ...byTool('nikto')]
      .filter((f) => f.severity !== 'INFO')
      .map((f) => f.title)
      .slice(0, 20);

    // Subdominios descubiertos
    const subdomains = [...byTool('subfinder'), ...byTool('amass')]
      .map((f) => f.title)
      .slice(0, 30);

    // Vulnerabilidades confirmadas por Nuclei (solo CRITICAL/HIGH/MEDIUM)
    const nucleiVulns = byTool('nuclei')
      .filter((f) => ['CRITICAL', 'HIGH', 'MEDIUM'].includes(f.severity))
      .map((f) => f.title)
      .slice(0, 15);

    // Alertas de Nikto
    const niktoAlerts = byTool('nikto')
      .map((f) => f.title)
      .slice(0, 15);

    // Delta context (desde ScanReport si existe)
    const delta = scanReport
      ? {
          newFindings:      scanReport.newFindings,
          recurringFindings: scanReport.recurringFindings,
          staleFindings:    scanReport.staleFindings,
          riskScoreDelta:   scanReport.riskScoreDelta,
        }
      : null;

    // Segmentación por dominio de seguridad
    const segmentTools = {
      network: ['subfinder', 'amass', 'httpx'],
      ports:   ['nmap'],
      web:     ['nikto', 'gobuster', 'ffuf', 'nuclei', 'dalfox', 'katana', 'whatweb'],
      tls:     ['sslscan', 'testssl'],
      secrets: ['trufflehog'],
    };
    const buildSegment = (toolList: string[]) =>
      findings
        .filter((f) => toolList.includes(f.sourceTool) && f.severity !== 'INFO')
        .map((f) => `[${f.severity}] ${f.title} (${f.sourceTool})`)
        .slice(0, 15);

    return {
      asset,
      totalFindings: findings.length,
      severityBreakdown: {
        CRITICAL: severityCount('CRITICAL'),
        HIGH:     severityCount('HIGH'),
        MEDIUM:   severityCount('MEDIUM'),
        LOW:      severityCount('LOW'),
        INFO:     severityCount('INFO'),
      },
      technologies:     Array.from(techSet),
      openPorts:        [...new Set(ports)],
      sslIssues,
      exposedEndpoints,
      subdomains,
      nucleiVulns,
      niktoAlerts,
      delta,
      segments: {
        network: buildSegment(segmentTools.network),
        ports:   buildSegment(segmentTools.ports),
        web:     buildSegment(segmentTools.web),
        tls:     buildSegment(segmentTools.tls),
        secrets: buildSegment(segmentTools.secrets),
      },
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // PROMPT ENGINEERING
  // ───────────────────────────────────────────────────────────────────────────
  private buildPrompt(ctx: ReturnType<ScanReportWorker['buildContext']>): string {
    const deltaBlock = ctx.delta
      ? `\n## CONTEXTO DE CAMBIO (DELTA VS ESCANEO ANTERIOR)
- Hallazgos NUEVOS (primera vez detectados): ${ctx.delta.newFindings}
- Hallazgos RECURRENTES (ya conocidos, confirmados): ${ctx.delta.recurringFindings}
- Hallazgos SIN CONFIRMAR (no aparecieron en este scan): ${ctx.delta.staleFindings}
- Variación del score de riesgo: ${ctx.delta.riskScoreDelta > 0 ? '+' : ''}${ctx.delta.riskScoreDelta.toFixed(1)} (positivo = empeora)\n`
      : '';

    const segBlock = `\n## HALLAZGOS POR DOMINIO DE SEGURIDAD
### Red / Perímetro (subfinder, amass, httpx)
${ctx.segments.network.join('\n') || '— Sin hallazgos relevantes'}

### Puertos / Servicios (nmap)
${ctx.segments.ports.join('\n') || '— Sin hallazgos relevantes'}

### Web / Aplicación (nikto, gobuster, ffuf, nuclei, dalfox, katana, whatweb)
${ctx.segments.web.join('\n') || '— Sin hallazgos relevantes'}

### TLS / Configuración (sslscan, testssl)
${ctx.segments.tls.join('\n') || '— Sin hallazgos relevantes'}

### Secretos / Credenciales (trufflehog)
${ctx.segments.secrets.join('\n') || '— Sin hallazgos relevantes'}
`;

    return `Eres un Director de Seguridad (CISO) con 15 años de experiencia en pentesting. Redacta un informe ejecutivo de pentest estructurado por dominio de seguridad basado en los datos técnicos consolidados.

## CONTEXTO DEL ACTIVO
- Activo: ${ctx.asset}
- Hallazgos totales: ${ctx.totalFindings}
- Distribución por severidad: ${JSON.stringify(ctx.severityBreakdown)}
- Stack tecnológico: ${ctx.technologies.join(', ') || 'No identificado'}
- Puertos expuestos: ${ctx.openPorts.join(', ') || 'No identificados'}
- Endpoints sensibles: ${ctx.exposedEndpoints.join('; ') || 'Ninguno detectado'}
- Problemas SSL/TLS (severidad MEDIUM+): ${ctx.sslIssues.join('; ') || 'Ninguno crítico'}
- Subdominios descubiertos: ${ctx.subdomains.join(', ') || 'Ninguno'}
- Alertas Nikto: ${ctx.niktoAlerts.join('; ') || 'Ninguna'}
- Vulnerabilidades Nuclei confirmadas: ${ctx.nucleiVulns.join('; ') || 'Ninguna confirmada'}
${deltaBlock}${segBlock}
## REGLAS DEL INFORME
1. "executiveSummary": Máximo 4 oraciones. Lenguaje para un CEO sin conocimiento técnico. Mencionar: riesgo general, exposición al negocio, urgencia de remediación y si hay hallazgos nuevos vs recurrentes.
2. "technicalSummary": 3-4 oraciones para el equipo de infraestructura. Mencionar: vectores de ataque más probables, superficie de exposición, dependencias críticas y variación del riesgo.
3. "score": Entero 1-10. 10 = riesgo máximo.
4. "topRisks": Array máximo 5 objetos. Cada uno: title (max 80 chars), severity ("CRITICAL"|"HIGH"|"MEDIUM"|"LOW"), businessImpact (1 oración), technicalContext (2 oraciones), recommendedAction (1 oración), cvssEstimate (string ej: "7.5").
5. "attackSurface": Objeto con: perimeter ("Expuesto públicamente"|"Parcialmente expuesto"|"Segmentado"), technologiesAtRisk (array strings), exposedServices (array de {port, service, risk}), dataExposureIndicators (array strings).
6. "remediationRoadmap": Objeto con 3 fases: immediate {focus, actions[], estimatedTime}, shortTerm {focus, actions[], estimatedTime}, mediumTerm {focus, actions[], estimatedTime}.
7. "complianceFlags": Array de strings según hallazgos, ej: ["PCI-DSS: Requiere TLS 1.2+", "ISO27001: Control A.8.8"]. Puede ser vacío [].
8. "segmentedAnalysis": Objeto con 5 claves: "network", "ports", "web", "tls", "secrets". Cada clave es un objeto con:
   - riskLevel: "CRITICAL"|"HIGH"|"MEDIUM"|"LOW"|"INFO"|"N/A"
   - summary: 2-3 oraciones analizando los hallazgos de ese dominio en contexto del negocio
   - findings: array de strings con los hallazgos más importantes de ese dominio (max 5)
   - deltaNote: 1 oración describiendo si la situación de ese dominio mejoró, empeoró o se mantuvo vs el scan anterior (usa "N/A" si es el primer escaneo)
   - recommendations: array de 2-3 acciones concretas y específicas para ese dominio

## FORMATO DE SALIDA
Devuelve ÚNICAMENTE un objeto JSON válido. Sin markdown, sin bloques de código, sin explicaciones fuera del JSON.`;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // LLAMADAS A PROVEEDORES IA
  // ───────────────────────────────────────────────────────────────────────────
  private async callGemini(prompt: string): Promise<string> {
    if (!this.geminiKey) throw new Error('GEMINI_API_KEY not configured');
    const ai = new GoogleGenAI({ apiKey: this.geminiKey });
    const result = await ai.models.generateContent({
      model: this.geminiModel,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        maxOutputTokens: 4096,
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    return result.text ?? '';
  }

  private async callOllama(prompt: string): Promise<string> {
    const resp = await fetch(`${this.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.ollamaModel,
        prompt,
        stream: false,
        options: { num_predict: 3000, temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}`);
    const data = (await resp.json()) as { response: string };
    return data.response;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // PARSING Y FALLBACK
  // ───────────────────────────────────────────────────────────────────────────
  private parseJson(raw: string): any {
    // Limpiar tags de razonamiento (Ollama qwen3 con /think)
    const cleaned = raw
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/```json\s*/gi, '')
      .replace(/```\s*$/gi, '')
      .trim();

    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('No JSON delimiters found in AI response');
    }
    return JSON.parse(cleaned.slice(start, end + 1));
  }

  private buildFallbackReport(findings: any[], ctx: ReturnType<ScanReportWorker['buildContext']>) {
    const { CRITICAL, HIGH } = ctx.severityBreakdown;

    const makeSegment = (tools: string[], domainLabel: string) => {
      const segFindings = findings.filter((f) => tools.includes(f.sourceTool));
      const sevs = segFindings.reduce<Record<string, number>>((a, f) => {
        a[f.severity] = (a[f.severity] ?? 0) + 1; return a;
      }, {});
      const risk = sevs.CRITICAL ? 'CRITICAL' : sevs.HIGH ? 'HIGH' : sevs.MEDIUM ? 'MEDIUM' : segFindings.length > 0 ? 'LOW' : 'N/A';
      return {
        riskLevel: risk,
        summary: segFindings.length > 0
          ? `Se detectaron ${segFindings.length} hallazgos en ${domainLabel}. Requieren revisión del equipo técnico.`
          : `No se detectaron hallazgos relevantes en ${domainLabel} en este escaneo.`,
        findings: segFindings.slice(0, 5).map((f) => `[${f.severity}] ${f.title}`),
        deltaNote: ctx.delta ? `Variación de riesgo total: ${ctx.delta.riskScoreDelta > 0 ? '+' : ''}${ctx.delta.riskScoreDelta.toFixed(1)}.` : 'N/A',
        recommendations: segFindings.length > 0
          ? [`Revisar y priorizar hallazgos ${risk} en ${domainLabel}.`, 'Aplicar controles de seguridad adecuados.']
          : [`Mantener monitoreo continuo de ${domainLabel}.`],
      };
    };

    return {
      score: CRITICAL > 0 ? 9 : HIGH > 0 ? 7 : 5,
      executiveSummary: `Se detectaron ${findings.length} hallazgos en ${ctx.asset}. ${CRITICAL} críticos y ${HIGH} altos requieren atención inmediata del equipo de seguridad.`,
      technicalSummary: `Superficie de ataque: ${ctx.openPorts.length} puertos, ${ctx.technologies.length} tecnologías identificadas. Vectores probables: ${ctx.exposedEndpoints.slice(0, 3).join(', ') || 'Ninguno confirmado'}.`,
      topRisks: findings
        .filter((f) => ['CRITICAL', 'HIGH'].includes(f.severity))
        .slice(0, 5)
        .map((f) => ({
          title:             f.title.slice(0, 80),
          severity:          f.severity,
          businessImpact:    'Requiere evaluación de impacto al negocio.',
          technicalContext:  f.description || 'Sin detalle técnico disponible.',
          recommendedAction: 'Aplicar parche o mitigación de forma prioritaria.',
          cvssEstimate:      f.cvss ? String(f.cvss) : 'N/A',
        })),
      attackSurface: {
        perimeter:                'Expuesto públicamente',
        technologiesAtRisk:       ctx.technologies,
        exposedServices:          ctx.openPorts.map((p) => ({ port: p, service: 'unknown', risk: 'unknown' })),
        dataExposureIndicators:   [],
      },
      remediationRoadmap: {
        immediate:  { focus: 'Contener riesgos críticos y altos',   actions: ['Revisar y priorizar findings CRITICAL/HIGH'],       estimatedTime: '24-48 horas' },
        shortTerm:  { focus: 'Remediación técnica de vulnerabilidades', actions: ['Aplicar parches', 'Reconfigurar servicios expuestos'], estimatedTime: '3-7 días'    },
        mediumTerm: { focus: 'Hardening y mejora continua',          actions: ['Re-escanear el activo', 'Auditoría de configuraciones'], estimatedTime: '2-4 semanas' },
      },
      complianceFlags: [],
      segmentedAnalysis: {
        network: makeSegment(['subfinder', 'amass', 'httpx'], 'Red / Perímetro'),
        ports:   makeSegment(['nmap'],                        'Puertos / Servicios'),
        web:     makeSegment(['nikto', 'gobuster', 'ffuf', 'nuclei', 'dalfox', 'katana', 'whatweb'], 'Web / Aplicación'),
        tls:     makeSegment(['sslscan', 'testssl'],          'TLS / Configuración'),
        secrets: makeSegment(['trufflehog'],                  'Secretos / Credenciales'),
      },
    };
  }
}
