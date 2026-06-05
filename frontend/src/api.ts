const API = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export async function fetchFindings(orgId: string, opts: { severity?: string; status?: string; from?: string; to?: string } = {}) {
  const params = new URLSearchParams({ organizationId: orgId })
  if (opts.severity) params.set('severity', opts.severity)
  if (opts.status)   params.set('status', opts.status)
  if (opts.from)     params.set('from', opts.from)
  if (opts.to)       params.set('to', opts.to)
  const res = await fetch(`${API}/api/v1/findings?${params}`)
  if (!res.ok) throw new Error('Failed to fetch findings')
  return res.json()
}

export async function fetchStats(orgId: string) {
  const res = await fetch(`${API}/api/v1/findings/stats?organizationId=${orgId}`)
  if (!res.ok) throw new Error('Failed to fetch stats')
  return res.json() as Promise<{ total: number; open: number; critical: number; high: number; newThisWeek: number; recurring: number }>
}

export async function fetchSeverity(orgId: string) {
  const res = await fetch(`${API}/api/v1/findings/severity-distribution?organizationId=${orgId}`)
  if (!res.ok) throw new Error('Failed to fetch severity')
  return res.json()
}

export async function fetchRemediationFindings(orgId: string, opts: { from?: string; to?: string } = {}) {
  const params = new URLSearchParams({ organizationId: orgId })
  if (opts.from) params.set('from', opts.from)
  if (opts.to)   params.set('to', opts.to)
  const res = await fetch(`${API}/api/v1/findings/remediation?${params}`)
  if (!res.ok) throw new Error('Failed to fetch remediation findings')
  return res.json() as Promise<any[]>
}

export async function fetchAssetFindings(orgId: string) {
  const res = await fetch(`${API}/api/v1/findings/by-asset?organizationId=${orgId}`)
  if (!res.ok) throw new Error('Failed to fetch asset findings')
  return res.json() as Promise<any[]>
}

export async function ingestFinding(data: unknown) {
  const res = await fetch(`${API}/api/v1/findings/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-collector-id': 'web-demo' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Ingest failed')
  return res.json()
}

export async function fetchAnalysis(findingId: string) {
  const res = await fetch(`${API}/api/v1/findings/${findingId}/analysis`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Failed to fetch analysis')
  return res.json()
}

export async function triggerAnalysis(findingId: string, provider: 'ollama' | 'gemini' = 'gemini') {
  const res = await fetch(`${API}/api/v1/findings/${findingId}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
  })
  if (!res.ok) throw new Error('Trigger analysis failed')
  return res.json()
}

export async function reanalyzeBatch(orgId: string, provider: 'gemini' | 'ollama' = 'gemini') {
  const res = await fetch(`${API}/api/v1/findings/reanalyze-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: orgId, provider }),
  })
  if (!res.ok) throw new Error('Batch reanalyze failed')
  return res.json() as Promise<{ processed?: number; queued?: number; total: number; provider: string }>
}

export async function updateFindingTracking(
  findingId: string,
  data: {
    status?: string
    startDate?: string
    endDate?: string
    responsible?: string
    postAnalysisDate?: string
    closingDate?: string
    remediationEvidence?: string
    closingNotes?: string
  },
) {
  const res = await fetch(`${API}/api/v1/findings/${findingId}/tracking`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update tracking')
  return res.json()
}

export async function fetchRemediationHistory(orgId: string, opts: { from?: string; to?: string; archived?: boolean } = {}) {
  const params = new URLSearchParams({ organizationId: orgId })
  if (opts.from)                  params.set('from', opts.from)
  if (opts.to)                    params.set('to', opts.to)
  if (opts.archived !== undefined) params.set('archived', String(opts.archived))
  const res = await fetch(`${API}/api/v1/findings/remediation-history?${params}`)
  if (!res.ok) throw new Error('Failed to fetch remediation history')
  return res.json() as Promise<any[]>
}

export async function archiveFindings(orgId: string, daysOld = 90) {
  const res = await fetch(`${API}/api/v1/findings/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: orgId, daysOld }),
  })
  if (!res.ok) throw new Error('Failed to archive findings')
  return res.json() as Promise<{ archived: number; cutoff: string }>
}

// ── Domains ────────────────────────────────────────────────────────────────────

export async function listDomains() {
  const res = await fetch(`${API}/api/v1/domains`)
  if (!res.ok) throw new Error('Failed to list domains')
  return res.json() as Promise<any[]>
}

export async function createDomain(data: { domain: string; tools: string[]; cronExpr: string; scanProfile?: string }) {
  const res = await fetch(`${API}/api/v1/domains`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create domain')
  return res.json()
}

export async function updateDomain(id: string, data: Partial<{ tools: string[]; cronExpr: string; enabled: boolean; scanProfile: string }>) {
  const res = await fetch(`${API}/api/v1/domains/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update domain')
  return res.json()
}

export async function getDomainConfigPreview(id: string) {
  const res = await fetch(`${API}/api/v1/domains/${id}/config-preview`)
  if (!res.ok) throw new Error('Failed to get config preview')
  return res.json() as Promise<{
    domain: string; profile: string; descripcion: string; duracion: string;
    toolsEffective: string[]; toolsDefault: string[]; customized: boolean;
  }>
}

export async function deleteDomain(id: string) {
  const res = await fetch(`${API}/api/v1/domains/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete domain')
  return res.json()
}

export async function markDomainScanned(id: string) {
  const res = await fetch(`${API}/api/v1/domains/${id}/scan-complete`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to mark domain scanned')
  return res.json()
}

export async function triggerDomainScan(domainId: string): Promise<{ scanId: string; status: string; domain: string }> {
  const res = await fetch(`${API}/api/v1/domains/${domainId}/scan`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any).message || 'Failed to trigger scan')
  }
  return res.json()
}

export async function fetchAlertRules() {
  const res = await fetch(`${API}/api/v1/alerts/rules`)
  if (!res.ok) throw new Error('Failed to fetch alert rules')
  return res.json()
}

export async function createAlertRule(data: { name: string; severity: string[]; channel: string; target: string }) {
  const res = await fetch(`${API}/api/v1/alerts/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create alert rule')
  return res.json()
}

export async function updateAlertRule(id: string, data: { enabled?: boolean; name?: string; severity?: string[]; target?: string }) {
  const res = await fetch(`${API}/api/v1/alerts/rules/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update alert rule')
  return res.json()
}

export async function deleteAlertRule(id: string) {
  const res = await fetch(`${API}/api/v1/alerts/rules/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete alert rule')
  return res.json()
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export interface ScanReportSummary {
  id: string
  scanId: string
  orgId: string
  domain: string
  collectorId: string
  tools: string[]
  newFindings: number
  recurringFindings: number
  staleFindings: number
  totalOpen: number
  bySeverity: Record<string, number>
  newBySeverity: Record<string, number>
  riskScore: number
  prevScanId: string | null
  riskScoreDelta: number
  durationSec: number | null
  createdAt: string
}

export interface ScanFinding {
  id: string
  assetId: string
  category: string
  severity: string
  title: string
  description?: string
  sourceTool: string
  cve?: string
  cvss?: number
  seenCount: number
  scanId?: string
  firstScanId?: string
  status: string
  createdAt: string
  lastSeenAt?: string
}

export interface ScanReportDetail extends ScanReportSummary {
  newFindingsList: ScanFinding[]
  recurringFindingsList: ScanFinding[]
  staleFindingsList: ScanFinding[]
}

export async function fetchReports(orgId = 'org_demo', domain?: string): Promise<ScanReportSummary[]> {
  const params = new URLSearchParams({ orgId })
  if (domain) params.set('domain', domain)
  const res = await fetch(`${API}/api/v1/reports?${params}`)
  if (!res.ok) throw new Error('Failed to fetch reports')
  return res.json()
}

export async function fetchReport(scanId: string): Promise<ScanReportDetail | null> {
  const res = await fetch(`${API}/api/v1/reports/${scanId}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Failed to fetch report')
  return res.json()
}

export async function generateReport(scanId: string, force = false): Promise<ScanReportDetail | null> {
  const res = await fetch(`${API}/api/v1/reports/${scanId}/generate?force=${force}`, { method: 'POST' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Failed to generate report')
  return res.json()
}

export async function fetchScanJobs(orgId = 'org_demo') {
  const res = await fetch(`${API}/api/v1/reports/jobs?orgId=${orgId}`)
  if (!res.ok) throw new Error('Failed to fetch scan jobs')
  return res.json()
}

// ─── AI Executive Report ──────────────────────────────────────────────────────

export interface AiTopRisk {
  title: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  businessImpact: string
  technicalContext: string
  recommendedAction: string
  cvssEstimate: string
}

export interface AiAttackSurface {
  perimeter: string
  technologiesAtRisk: string[]
  exposedServices: Array<{ port: number | string; service: string; risk: string }>
  dataExposureIndicators: string[]
}

export interface AiRemediationPhase {
  focus: string
  actions: string[]
  estimatedTime: string
}

export interface SegmentAnalysis {
  riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO' | 'N/A'
  summary: string
  findings: string[]
  deltaNote: string
  recommendations: string[]
}

export interface AiScanReport {
  id: string
  scanId: string
  asset: string
  orgId: string
  provider: string
  model: string
  score: number
  executiveSummary: string
  technicalSummary: string
  topRisks: AiTopRisk[]
  attackSurface: AiAttackSurface
  remediationRoadmap: {
    immediate: AiRemediationPhase
    shortTerm: AiRemediationPhase
    mediumTerm: AiRemediationPhase
  }
  complianceFlags: string[] | null
  segmentedAnalysis?: {
    network: SegmentAnalysis
    ports:   SegmentAnalysis
    web:     SegmentAnalysis
    tls:     SegmentAnalysis
    secrets: SegmentAnalysis
  } | null
  createdAt: string
  updatedAt: string
}

export async function fetchAiReport(scanId: string): Promise<AiScanReport | null> {
  const res = await fetch(`${API}/api/v1/reports/${scanId}/ai-report`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Failed to fetch AI report')
  return res.json()
}

export async function fetchAiReports(orgId = 'org_demo'): Promise<AiScanReport[]> {
  const res = await fetch(`${API}/api/v1/reports/ai-reports/list?orgId=${orgId}`)
  if (!res.ok) throw new Error('Failed to fetch AI reports')
  return res.json()
}

export async function triggerAiReport(scanId: string, orgId = 'org_demo'): Promise<{ queued: boolean; scanId: string }> {
  const res = await fetch(`${API}/api/v1/reports/${scanId}/ai-report/generate?orgId=${orgId}`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to trigger AI report generation')
  return res.json()
}


export async function fetchJobs(orgId = 'org_demo') {
  const res = await fetch(`${API}/api/v1/reports/jobs?orgId=${orgId}`)
  if (!res.ok) throw new Error('Failed to fetch jobs')
  return res.json() as Promise<Array<{ scanId: string; domain: string; status: string; startedAt: string; completedAt?: string; tools: string[] }>>
}

export async function cancelScan(scanId: string) {
  const res = await fetch(`${API}/api/v1/collectors/scans/${encodeURIComponent(scanId)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to cancel scan')
  return res.json() as Promise<{ cancelled: boolean }>
}

export async function cancelAllStaleScans(orgId = 'org_demo') {
  const res = await fetch(`${API}/api/v1/collectors/scans?orgId=${encodeURIComponent(orgId)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to cancel stale scans')
  return res.json() as Promise<{ cancelled: number }>
}

// ── Scan Sessions ──────────────────────────────────────────────────────────────

// ── Audit Logs ────────────────────────────────────────────────────────────────

export async function fetchAuditLogs(opts: { type?: string; limit?: number; from?: string; to?: string } = {}) {
  const params = new URLSearchParams()
  if (opts.type)  params.set('type',  opts.type)
  if (opts.limit) params.set('limit', String(opts.limit))
  if (opts.from)  params.set('from',  opts.from)
  if (opts.to) {
    // Make to-date end-of-day inclusive (23:59:59)
    const toDate = new Date(opts.to)
    toDate.setDate(toDate.getDate() + 1)
    params.set('to', toDate.toISOString())
  }
  const res = await fetch(`${API}/api/v1/audit-logs?${params}`)
  if (!res.ok) throw new Error('Failed to fetch audit logs')
  return res.json()
}

// ── Scan Sessions ──────────────────────────────────────────────────────────────

export async function fetchScanSessions(orgId: string, limit = 50) {
  const res = await fetch(`${API}/api/v1/collectors/sessions?orgId=${orgId}&limit=${limit}`)
  if (!res.ok) throw new Error('Failed to fetch scan sessions')
  return res.json() as Promise<Array<{
    id: string
    scanId: string
    collectorId: string
    tool: string
    orgId: string
    findingsAccepted: number
    findingsErrors: number
    createdAt: string
  }>>
}
