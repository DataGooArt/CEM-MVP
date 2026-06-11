import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import * as https from 'node:https';
import * as http from 'node:http';
import { PrismaService } from './prisma.service';

type Finding = {
  id: string;
  title: string;
  category: string;
  severity: string;
  description: string | null;
  cve: string | null;
};

@Injectable()
export class AlertEngine {
  private readonly logger = new Logger(AlertEngine.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Called at AI-analysis time with the AI-determined riskLevel */
  async evaluate(finding: Finding, riskLevel: string) {
    await this.dispatch(finding, riskLevel);
  }

  /** Called at ingest time for new findings — uses the finding's own severity */
  async evaluateNow(finding: Finding) {
    if (!['CRITICAL', 'HIGH'].includes(finding.severity)) return;
    await this.dispatch(finding, finding.severity);
  }

  private async dispatch(finding: Finding, severity: string) {
    if (!['CRITICAL', 'HIGH'].includes(severity)) return;

    const rules = await this.prisma.alertRule.findMany({
      where: { enabled: true },
    });

    for (const rule of rules) {
      const severities = rule.severity as string[];
      if (!severities.includes(severity)) continue;

      let status = 'SENT';
      let errorMsg: string | undefined;

      try {
        if (rule.channel === 'webhook') {
          await this.sendWebhook(rule.target, finding, severity);
        } else {
          await this.sendEmail(rule.target, finding, severity);
        }
      } catch (err: any) {
        status = 'FAILED';
        errorMsg = err.message;
      }

      // Persist notification log
      await this.prisma.notification.create({
        data: {
          ruleId:    rule.id,
          findingId: finding.id,
          channel:   rule.channel,
          target:    rule.target,
          severity,
          title:     finding.title,
          status,
          errorMsg,
        },
      }).catch(e => this.logger.warn(`Failed to persist notification log: ${e.message}`));
    }
  }

  private async sendEmail(to: string, finding: Finding, riskLevel: string) {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
    if (!SMTP_USER || !SMTP_PASS) {
      this.logger.warn('SMTP_USER/SMTP_PASS not set — skipping email alert');
      return;
    }

    const color = riskLevel === 'CRITICAL' ? '#dc2626' : '#ea580c';
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(SMTP_PORT || '587'),
      secure: false,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    try {
      await transporter.sendMail({
        from: `"CEM Platform" <${SMTP_USER}>`,
        to,
        subject: `[${riskLevel}] Security Alert: ${finding.title}`,
        html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
  <div style="background:${color};padding:16px 24px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0">🚨 ${riskLevel} Security Finding Detected</h2>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:0;padding:24px;border-radius:0 0 8px 8px">
    <table style="border-collapse:collapse;width:100%">
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 8px;font-weight:600;color:#374151;width:120px">Title</td>
        <td style="padding:10px 8px;color:#111827">${finding.title}</td>
      </tr>
      <tr style="border-bottom:1px solid #f3f4f6;background:#f9fafb">
        <td style="padding:10px 8px;font-weight:600;color:#374151">Category</td>
        <td style="padding:10px 8px;color:#111827">${finding.category}</td>
      </tr>
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 8px;font-weight:600;color:#374151">Severity</td>
        <td style="padding:10px 8px;color:${color};font-weight:600">${finding.severity}</td>
      </tr>
      <tr style="border-bottom:1px solid #f3f4f6;background:#f9fafb">
        <td style="padding:10px 8px;font-weight:600;color:#374151">CVE</td>
        <td style="padding:10px 8px;color:#111827">${finding.cve || 'N/A'}</td>
      </tr>
      <tr>
        <td style="padding:10px 8px;font-weight:600;color:#374151">Description</td>
        <td style="padding:10px 8px;color:#111827">${finding.description || 'N/A'}</td>
      </tr>
    </table>
    <div style="margin-top:24px">
      <a href="${process.env.WEB_URL || 'http://localhost:5173'}"
         style="background:#3b82f6;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">
        View in CEM Dashboard →
      </a>
    </div>
  </div>
</div>`,
      });
      this.logger.log(`Alert email sent to ${to} for finding "${finding.title}"`);
    } catch (err: any) {
      this.logger.error(`Failed to send alert email: ${err.message}`);
    }
  }

  private async sendWebhook(url: string, finding: Finding, severity: string) {
    const body = JSON.stringify({
      event: 'SECURITY_FINDING',
      severity,
      finding: {
        id:          finding.id,
        title:       finding.title,
        category:    finding.category,
        severity:    finding.severity,
        cve:         finding.cve,
        description: finding.description,
      },
      dashboardUrl: process.env.WEB_URL || 'http://localhost:5173',
      timestamp: new Date().toISOString(),
    });

    return new Promise<void>((resolve) => {
      try {
        const parsed = new URL(url);
        const lib = parsed.protocol === 'https:' ? https : http;
        const req = lib.request(
          url,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            timeout: 10_000,
          },
          (res) => {
            this.logger.log(`Webhook ${url} → HTTP ${res.statusCode} for "${finding.title}"`);
            resolve();
          },
        );
        req.on('error', (err) => {
          this.logger.error(`Webhook delivery failed (${url}): ${err.message}`);
          resolve();
        });
        req.on('timeout', () => {
          this.logger.warn(`Webhook timed out (${url})`);
          req.destroy();
          resolve();
        });
        req.write(body);
        req.end();
      } catch (err: any) {
        this.logger.error(`Invalid webhook URL (${url}): ${err.message}`);
        resolve();
      }
    });
  }
}
