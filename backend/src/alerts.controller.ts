import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  NotFoundException, ValidationPipe, UsePipes, Logger,
} from '@nestjs/common';
import { Public } from './common/public.decorator';
import { IsString, IsArray, IsOptional, IsBoolean, IsIn, ArrayMinSize } from 'class-validator';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { GoogleGenAI } from '@google/genai';
import { PrismaService } from './prisma.service';

const ALLOWED_SEVERITIES = ['CRITICAL', 'HIGH'] as const;
const ALLOWED_CHANNELS   = ['email', 'webhook'] as const;

class CreateAlertRuleDto {
  @IsString()
  name: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(ALLOWED_SEVERITIES, { each: true })
  severity: string[];

  @IsString()
  @IsIn(ALLOWED_CHANNELS)
  channel: string;

  @IsString()
  target: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

class UpdateAlertRuleDto {
  @IsOptional() @IsString()  name?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @IsIn(ALLOWED_SEVERITIES, { each: true })   severity?: string[];
  @IsOptional() @IsString()  target?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

@Public()
@Controller('api/v1')
export class AlertsController {
  private readonly logger = new Logger(AlertsController.name);
  private readonly geminiKey = process.env.GEMINI_API_KEY || '';
  private readonly geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('findings-ai') private readonly aiQueue: Queue,
  ) {}

  // ── AI Analysis ──────────────────────────────────────────────────────────

  @Get('findings/:id/analysis')
  async getAnalysis(@Param('id') id: string) {
    const analysis = await this.prisma.aiAnalysis.findUnique({ where: { findingId: id } });
    if (!analysis) throw new NotFoundException('Analysis not ready yet');
    return analysis;
  }

  @Post('findings/:id/analyze')
  async triggerAnalysis(
    @Param('id') id: string,
    @Body() body: { provider?: string },
  ) {
    const finding = await this.prisma.finding.findUnique({ where: { id } });
    if (!finding) throw new NotFoundException('Finding not found');
    const provider = body?.provider === 'gemini' ? 'gemini' : 'ollama';
    await this.aiQueue.add('analyze', { findingId: id, provider });
    return { queued: true, provider };
  }

  @Post('findings/reanalyze-batch')
  async reanalyzeBatch(
    @Body() body: { organizationId?: string; provider?: string },
  ) {
    const provider = body?.provider === 'ollama' ? 'ollama' : 'gemini';
    const orgId = body?.organizationId ?? 'org_demo';

    // Get all CRITICAL/HIGH findings for the org
    const findings = await this.prisma.finding.findMany({
      where: { severity: { in: ['CRITICAL', 'HIGH'] } },
      include: { asset: { select: { organizationId: true } } },
    });
    const orgFindings = findings.filter(f => f.asset?.organizationId === orgId);

    if (provider !== 'gemini' || !this.geminiKey) {
      // Queue all via BullMQ
      await Promise.all(orgFindings.map(f => this.aiQueue.add('analyze', { findingId: f.id, provider })));
      return { queued: orgFindings.length, provider };
    }

    // Direct Gemini calls — bypass queue
    const ai = new GoogleGenAI({ apiKey: this.geminiKey });
    let processed = 0;

    for (const finding of orgFindings) {
      try {
        const prompt = this.buildPrompt(finding);
        const result = await ai.models.generateContent({
          model: this.geminiModel,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { maxOutputTokens: 1024, temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
        });
        const raw = result.text ?? '';
        const parsed = this.parseJson(raw);
        if (!parsed.summary) continue;

        await this.prisma.aiAnalysis.upsert({
          where: { findingId: finding.id },
          update: {
            summary: parsed.summary,
            riskLevel: parsed.riskLevel ?? finding.severity,
            remediation: parsed.remediation ?? '',
            businessImpact: parsed.businessImpact,
            remediationPlan: parsed.remediationPlan as any,
            model: this.geminiModel,
          },
          create: {
            findingId: finding.id,
            summary: parsed.summary,
            riskLevel: parsed.riskLevel ?? finding.severity,
            remediation: parsed.remediation ?? '',
            businessImpact: parsed.businessImpact,
            remediationPlan: parsed.remediationPlan as any,
            model: this.geminiModel,
          },
        });
        processed++;
        this.logger.log(`[reanalyze-batch] ${processed}/${orgFindings.length} — ${finding.id}`);
      } catch (err: any) {
        this.logger.warn(`[reanalyze-batch] failed for ${finding.id}: ${err.message}`);
      }
    }

    return { processed, total: orgFindings.length, provider };
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
- remediationPlan.immediateTime: tiempo estimado total (ej: "2-4 horas")
- remediationPlan.shortTerm: array de 2-3 acciones en 1-7 días
- remediationPlan.shortTermTime: tiempo estimado total (ej: "2-3 días")
- remediationPlan.longTerm: array de 2-3 acciones en 1-4 semanas
- remediationPlan.longTermTime: tiempo estimado total (ej: "2-3 semanas")
- remediationPlan.observations: observaciones sobre priorización y dependencias (1-2 oraciones)
- remediation: 4 pasos separados por \\n
- Sin texto fuera del JSON

Devuelve ÚNICAMENTE este JSON:
{"summary":"análisis técnico","businessImpact":"impacto al negocio","riskLevel":"CRITICAL","remediationPlan":{"immediate":["acción 1","acción 2"],"immediateTime":"2-4 horas","shortTerm":["acción 1","acción 2"],"shortTermTime":"2-3 días","longTerm":["acción 1","acción 2"],"longTermTime":"2-3 semanas","observations":"observaciones"},"remediation":"1. paso\\n2. paso\\n3. paso\\n4. verificar"}`;
  }

  private parseJson(raw: string) {
    const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { return {}; }
    }
    return {};
  }

  // ── Alert Rules ──────────────────────────────────────────────────────────

  @Get('alerts/rules')
  async listRules() {
    return this.prisma.alertRule.findMany({ orderBy: { createdAt: 'desc' } });
  }

  // ── Audit Log ─────────────────────────────────────────────────────────────

  @Get('audit-logs')
  async listAuditLogs(
    @Query('type') type?: string,
    @Query('findingId') findingId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.prisma.auditLog.findMany({
      where: {
        ...(type      ? { type }                                            : {}),
        ...(findingId ? { findingId }                                       : {}),
        ...(from || to ? { createdAt: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to   ? { lte: new Date(to)   } : {}),
        }} : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 50, 200),
    });
  }

  @Post('alerts/rules')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async createRule(@Body() dto: CreateAlertRuleDto) {
    return this.prisma.alertRule.create({
      data: {
        name: dto.name,
        severity: dto.severity,
        channel: dto.channel,
        target: dto.target,
        enabled: dto.enabled ?? true,
      },
    });
  }

  @Patch('alerts/rules/:id')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async updateRule(@Param('id') id: string, @Body() dto: UpdateAlertRuleDto) {
    const rule = await this.prisma.alertRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Alert rule not found');
    return this.prisma.alertRule.update({ where: { id }, data: dto });
  }

  @Delete('alerts/rules/:id')
  async deleteRule(@Param('id') id: string) {
    await this.prisma.alertRule.delete({ where: { id } });
    return { deleted: true };
  }
}
