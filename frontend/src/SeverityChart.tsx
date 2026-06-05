import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import { useStore } from './store'

const COLORS: Record<string, string> = {
  CRITICAL: '#f43f5e',
  HIGH: '#f97316',
  MEDIUM: '#eab308',
  LOW: '#3b82f6',
  INFO: '#64748b',
}

export default function SeverityChart() {
  const data = useStore(s => s.severity)
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 h-80 flex flex-col">
      <h3 className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-4">Severity Distribution</h3>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="count" nameKey="severity">
            {data.map((entry: any) => (
              <Cell key={entry.severity} fill={COLORS[entry.severity] || '#94a3b8'} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155' }} itemStyle={{ color: '#e2e8f0' }} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
