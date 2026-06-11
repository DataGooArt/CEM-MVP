import { Controller, Post, Body, Logger } from '@nestjs/common';
import { Public } from './common/public.decorator';
import { PrismaService } from './prisma.service';

type Message = { role: 'user' | 'assistant'; content: string };

interface ChatDto {
  messages: Message[];
  context?: { findingId?: string; scanId?: string };
}

@Public()
@Controller('api/v1/ai')
export class AiChatController {
  private readonly logger = new Logger(AiChatController.name);
  private readonly ollamaUrl   = process.env.OLLAMA_URL   || 'http://ollama:11434';
  private readonly ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2';
  private readonly geminiKey   = process.env.GEMINI_API_KEY || '';
  private readonly geminiModel = process.env.GEMINI_MODEL  || 'gemini-2.0-flash';

  constructor(private readonly prisma: PrismaService) {}

  @Post('chat')
  async chat(@Body() dto: ChatDto) {
    const contextBlock = await this.buildContextBlock(dto.context);

    const systemPrompt =
      `Eres un asistente experto en ciberseguridad de la plataforma CEM (Continuous Exposure Monitoring). ` +
      `Responde siempre en español, de forma concisa y técnicamente precisa. ` +
      `Si te preguntan algo no relacionado con ciberseguridad o con los datos de la plataforma, indícalo cortésmente.` +
      (contextBlock ? `\n\nContexto actual:\n${contextBlock}` : '');

    const messages = dto.messages.slice(-20); // last 20 messages to stay within token limits

    // Try Gemini first if key available, then Ollama
    if (this.geminiKey) {
      try {
        const reply = await this.callGemini(systemPrompt, messages);
        return { reply, model: this.geminiModel };
      } catch (err: any) {
        this.logger.warn(`[chat] Gemini failed: ${err.message}, falling back to Ollama`);
      }
    }

    const reply = await this.callOllama(systemPrompt, messages);
    return { reply, model: this.ollamaModel };
  }

  private async buildContextBlock(context?: { findingId?: string; scanId?: string }): Promise<string> {
    if (!context) return '';

    if (context.findingId) {
      const f = await this.prisma.finding.findUnique({
        where: { id: context.findingId },
        include: { aiAnalysis: true, asset: { select: { domain: true, ip: true } } },
      });
      if (!f) return '';
      const asset = f.asset?.domain || f.asset?.ip || 'desconocido';
      return [
        `Hallazgo: ${f.title}`,
        `Activo: ${asset} | Severidad: ${f.severity} | Estado: ${f.status}`,
        `CVE: ${f.cve ?? 'N/A'} | CVSS: ${f.cvss ?? 'N/A'}`,
        `Categoría: ${f.category}`,
        `Descripción: ${(f.description ?? 'N/A').slice(0, 400)}`,
        f.aiAnalysis ? `Análisis IA: ${f.aiAnalysis.summary}` : '',
        f.aiAnalysis ? `Impacto negocio: ${f.aiAnalysis.businessImpact ?? 'N/A'}` : '',
        (f as any).recurrenceCount > 0 ? `⚠️ Hallazgo recurrente — ha reaparecido ${(f as any).recurrenceCount} vez/veces` : '',
      ].filter(Boolean).join('\n');
    }

    if (context.scanId) {
      const r = await this.prisma.scanReport.findUnique({ where: { scanId: context.scanId } });
      const ai = await (this.prisma as any).aiScanReport?.findUnique?.({ where: { scanId: context.scanId } }).catch(() => null);
      if (!r) return '';
      return [
        `Informe de escaneo — Dominio: ${r.domain}`,
        `Fecha: ${r.createdAt.toISOString().split('T')[0]}`,
        `Nuevos hallazgos: ${r.newFindings} | Recurrentes: ${r.recurringFindings} | Total abiertos: ${r.totalOpen}`,
        `Risk Score: ${r.riskScore.toFixed(1)} (delta: ${r.riskScoreDelta >= 0 ? '+' : ''}${r.riskScoreDelta.toFixed(1)})`,
        `Herramientas: ${(r.tools as string[]).join(', ')}`,
        ai?.executiveSummary ? `Resumen ejecutivo IA: ${ai.executiveSummary}` : '',
        ai?.attackSurface    ? `Superficie de ataque: ${ai.attackSurface}` : '',
      ].filter(Boolean).join('\n');
    }

    return '';
  }

  private async callGemini(systemPrompt: string, messages: Message[]): Promise<string> {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: this.geminiKey });

    const contents = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Entendido. Estoy listo para ayudarte con la plataforma CEM.' }] },
      ...messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      })),
    ];

    const result = await ai.models.generateContent({
      model: this.geminiModel,
      contents,
      config: { maxOutputTokens: 1024, temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } },
    });
    return result.text ?? 'Sin respuesta del modelo.';
  }

  private async callOllama(systemPrompt: string, messages: Message[]): Promise<string> {
    const conversationText = messages
      .map(m => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content}`)
      .join('\n');
    const prompt = `${systemPrompt}\n\n${conversationText}\nAsistente:`;

    const resp = await fetch(`${this.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.ollamaModel,
        prompt,
        stream: false,
        options: { num_predict: 1024, temperature: 0.7 },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}`);
    const data = await resp.json() as { response: string };
    return data.response.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() || 'Sin respuesta del modelo.';
  }
}
