import { Injectable, Logger } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { GoogleGenAI } from '@google/genai';
import { PrismaService } from './prisma.service';
import { AlertEngine } from './alert.engine';

type Provider = 'ollama' | 'gemini';

@Injectable()
export class AiAnalysisWorker {
  private readonly logger = new Logger(AiAnalysisWorker.name);
  private readonly ollamaUrl = process.env.OLLAMA_URL || 'http://ollama:11434';
  private readonly ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2';
  private readonly geminiKey = process.env.GEMINI_API_KEY || '';
  private readonly geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

  // Circuit breaker — after 3 consecutive Gemini failures, skip Gemini for 5 min
  private geminiFailures = 0;
  private geminiCircuitOpenUntil = 0;
  private readonly CIRCUIT_THRESHOLD = 3;
  private readonly CIRCUIT_TIMEOUT_MS = 5 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly alertEngine: AlertEngine,
  ) {}

  start() {
    const worker = new Worker('findings-ai', async (job: Job) => this.process(job), {
      connection: { url: process.env.REDIS_URL || 'redis://redis:6379' },
      concurrency: 1,
    });
    worker.on('failed', (j, err) => this.logger.error(`AI job ${j?.id} failed: ${err.message}`));
    const mode = this.geminiKey
      ? `auto-fallback (gemini:${this.geminiModel} → ollama:${this.ollamaModel})`
      : `ollama-only (${this.ollamaModel})`;
    this.logger.log(`AiAnalysisWorker started — mode: ${mode}`);
  }

  private buildPrompt(finding: { title: string; category: string; severity: string; cve?: string | null; cvss?: number | null; description?: string | null }): string {
    const cveLine  = finding.cve  ? `\nCVE: ${finding.cve}`  : '';
    const cvssLine = finding.cvss ? `\nPuntuación CVSS: ${finding.cvss}` : '';
    return `Eres un analista senior de ciberseguridad. Analiza el siguiente hallazgo y devuelve ÚNICAMENTE JSON válido, sin markdown, sin bloques de código, sin texto adicional.

Hallazgo:
Título: ${finding.title}
Categoría: ${finding.category}
Severidad: ${finding.severity}${cveLine}${cvssLine}
Descripción: ${(finding.description ?? 'N/A').slice(0, 500)}

REGLAS ESTRICTAS:
- Todo en español
- riskLevel: exactamente uno de CRITICAL, HIGH, MEDIUM, LOW
- remediationPlan.immediate: array de 2-3 acciones en las primeras 24 horas
- remediationPlan.immediateTime: tiempo estimado total para ejecutar las acciones inmediatas (ej: "2-4 horas")
- remediationPlan.shortTerm: array de 2-3 acciones en 1-7 días
- remediationPlan.shortTermTime: tiempo estimado total para las acciones de corto plazo (ej: "2-3 días")
- remediationPlan.longTerm: array de 2-3 acciones en 1-4 semanas
- remediationPlan.longTermTime: tiempo estimado total para las acciones de largo plazo (ej: "2-3 semanas")
- remediationPlan.observations: observaciones sobre priorización, dependencias o riesgos del plan (1-2 oraciones)
- remediation: 4 pasos separados por \\n (resumen ejecutivo del plan)
- Sin texto fuera del JSON

Devuelve ÚNICAMENTE este JSON:
{"summary":"Análisis técnico de 2-3 oraciones: qué es la vulnerabilidad, cómo se explota, qué sistemas afecta","businessImpact":"Impacto al negocio de 1-2 oraciones: consecuencias si no se remedia, riesgo para operaciones o datos","riskLevel":"CRITICAL","remediationPlan":{"immediate":["acción inmediata 1","acción inmediata 2"],"immediateTime":"2-4 horas","shortTerm":["acción corto plazo 1","acción corto plazo 2"],"shortTermTime":"2-3 días","longTerm":["acción largo plazo 1","acción largo plazo 2"],"longTermTime":"2-3 semanas","observations":"Observaciones sobre priorización y dependencias del plan"},"remediation":"1. acción principal\\n2. acción principal\\n3. acción principal\\n4. verificar y monitorear"}`;
  }

  private parseJson(raw: string): { summary?: string; riskLevel?: string; remediation?: string; businessImpact?: string; remediationPlan?: { immediate: string[]; immediateTime?: string; shortTerm: string[]; shortTermTime?: string; longTerm: string[]; longTermTime?: string; observations?: string } } {
    const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as { summary?: string; riskLevel?: string; remediation?: string; businessImpact?: string; remediationPlan?: { immediate: string[]; immediateTime?: string; shortTerm: string[]; shortTermTime?: string; longTerm: string[]; longTermTime?: string; observations?: string } };
    return {};
  }

  private async callOllama(prompt: string): Promise<string> {
    const resp = await fetch(`${this.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.ollamaModel,
        prompt,
        stream: false,
        options: { num_predict: 2048, temperature: 0 },
      }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}`);
    const data = await resp.json() as { response: string };
    return data.response;
  }

  private async callGemini(prompt: string): Promise<string> {
    if (!this.geminiKey) throw new Error('GEMINI_API_KEY not configured');

    const ai = new GoogleGenAI({ apiKey: this.geminiKey });

    const result = await ai.models.generateContent({
      model: this.geminiModel,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        maxOutputTokens: 1024,
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const text = result.text ?? '';
    this.logger.debug(`[gemini] raw response (${text.length} chars): ${text.slice(0, 400)}`);
    return text;
  }

  /** Resolve provider order: if job specifies one, use it; otherwise auto-select with fallback */
  private resolveProviders(jobProvider?: Provider): Provider[] {
    if (jobProvider) return [jobProvider]; // explicit — no fallback
    // Check circuit breaker
    if (this.geminiKey && this.geminiCircuitOpenUntil > 0) {
      if (Date.now() < this.geminiCircuitOpenUntil) {
        this.logger.warn('[gemini] Circuit breaker OPEN — routing to Ollama');
        return ['ollama'];
      }
      // Circuit half-open: reset and retry Gemini
      this.geminiFailures = 0;
      this.geminiCircuitOpenUntil = 0;
    }
    // Auto mode: Gemini first (if key present), then Ollama
    return this.geminiKey ? ['gemini', 'ollama'] : ['ollama'];
  }

  private async process(job: Job) {
    const { findingId, provider: jobProvider } = job.data as { findingId: string; provider?: Provider };
    const finding = await this.prisma.finding.findUnique({ where: { id: findingId } });
    if (!finding) return;

    const prompt = this.buildPrompt(finding);
    let summary = `${finding.severity} severity finding: ${finding.title}`;
    let riskLevel = finding.severity;
    let remediation = 'Review and patch the affected component. Monitor for active exploitation.';
    let businessImpact: string | undefined;
    let remediationPlan: { immediate: string[]; immediateTime?: string; shortTerm: string[]; shortTermTime?: string; longTerm: string[]; longTermTime?: string; observations?: string } | undefined;
    let modelUsed = this.ollamaModel;

    const providers = this.resolveProviders(jobProvider);
    let succeeded = false;

    for (const provider of providers) {
      try {
        const raw = provider === 'gemini'
          ? await this.callGemini(prompt)
          : await this.callOllama(prompt);
        const parsed = this.parseJson(raw);
        if (parsed.summary)         summary         = parsed.summary;
        if (parsed.riskLevel)       riskLevel       = parsed.riskLevel;
        if (parsed.remediation)     remediation     = parsed.remediation;
        if (parsed.businessImpact)  businessImpact  = parsed.businessImpact;
        if (parsed.remediationPlan) remediationPlan = parsed.remediationPlan;
        modelUsed = provider === 'gemini' ? this.geminiModel : this.ollamaModel;
        this.logger.log(`[${provider}] Analysis done for ${findingId} — risk: ${riskLevel}`);
        if (provider === 'gemini') { this.geminiFailures = 0; this.geminiCircuitOpenUntil = 0; }
        succeeded = true;
        break;
      } catch (err: any) {
        if (provider === 'gemini') {
          this.geminiFailures++;
          if (this.geminiFailures >= this.CIRCUIT_THRESHOLD) {
            this.geminiCircuitOpenUntil = Date.now() + this.CIRCUIT_TIMEOUT_MS;
            this.logger.warn(`[gemini] Circuit breaker OPEN after ${this.geminiFailures} failures — pausing Gemini for 5 min`);
          }
        }
        const next = providers[providers.indexOf(provider) + 1];
        if (next) {
          this.logger.warn(`[${provider}] failed (${err.message}), falling back to [${next}]`);
        } else {
          this.logger.warn(`[${provider}] failed (${err.message}), storing fallback analysis`);
        }
      }
    }

    if (!succeeded) {
      this.logger.warn(`All providers failed for ${findingId}, storing default analysis`);
    }

    const t0 = Date.now();
    await this.prisma.aiAnalysis.upsert({
      where: { findingId },
      update: { summary, riskLevel, remediation, businessImpact, remediationPlan, model: modelUsed },
      create: { findingId, summary, riskLevel, remediation, businessImpact, remediationPlan, model: modelUsed },
    });

    // ─── Audit: AI analysis completed ────────────────────────────────────────
    const usedProvider = modelUsed === this.geminiModel ? 'gemini' : 'ollama';
    await this.prisma.auditLog.create({
      data: {
        type: 'AI_ANALYZED',
        findingId,
        provider: usedProvider,
        model: modelUsed,
        durationMs: Date.now() - t0,
      },
    });
    // Nota: la alerta ya se dispara en NormalizationWorker al momento del ingest.
    // No se vuelve a disparar aquí para evitar emails/webhooks duplicados.
  }
}
