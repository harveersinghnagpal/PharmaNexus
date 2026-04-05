'use client';
import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Activity, Search, RefreshCw, Info } from 'lucide-react';
import api from '@/services/api';
import ProtectedPage from '@/components/ProtectedPage';
import { CAPABILITIES } from '@/lib/permissions';

type AuditAction =
  | 'CREATE' | 'UPDATE' | 'DELETE' | 'APPROVE' | 'REJECT'
  | 'LOGIN' | 'LOGOUT' | 'SALE_CREATED' | 'BATCH_ADDED'
  | 'TRANSFER_CREATED' | 'PRESCRIPTION_APPROVED'
  | 'PRESCRIPTION_DISPENSED' | 'AI_DECISION' | 'AI_REVIEWED';

interface AuditLog {
  id: number;
  entity_type: string;
  entity_id?: string;
  action: AuditAction;
  changed_by_user_id?: number;
  store_id?: number;
  old_value?: Record<string, unknown>;
  new_value?: Record<string, unknown>;
  description?: string;
  ip_address?: string;
  request_id?: string;
  timestamp: string;
}

interface AuditSummary {
  period_days: number;
  by_action: { action: string; count: number }[];
}

const actionColors: Partial<Record<AuditAction, string>> = {
  SALE_CREATED: 'badge-green',
  BATCH_ADDED: 'badge-blue',
  TRANSFER_CREATED: 'badge-cyan',
  PRESCRIPTION_APPROVED: 'badge-violet',
  PRESCRIPTION_DISPENSED: 'badge-green',
  AI_DECISION: 'badge-amber',
  AI_REVIEWED: 'badge-violet',
  LOGIN: 'badge-blue',
  APPROVE: 'badge-green',
  REJECT: 'badge-rose',
  DELETE: 'badge-rose',
  CREATE: 'badge-blue',
  UPDATE: 'badge-amber',
};

const actionDots: Partial<Record<AuditAction, string>> = {
  SALE_CREATED: '#10b981',
  PRESCRIPTION_APPROVED: '#8b5cf6',
  BATCH_ADDED: '#3b82f6',
  TRANSFER_CREATED: '#06b6d4',
  AI_DECISION: '#f59e0b',
  REJECT: '#f43f5e',
  DELETE: '#f43f5e',
};

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, page_size: 50 };
      if (entityTypeFilter) params.entity_type = entityTypeFilter;
      if (actionFilter) params.action = actionFilter;

      const [logsRes, summaryRes] = await Promise.all([
        api.get('/audit', { params }),
        page === 1 ? api.get('/audit/summary') : Promise.resolve(null),
      ]);

      setLogs(logsRes.data);
      if (summaryRes) setSummary(summaryRes.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, entityTypeFilter, actionFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = logs.filter(log =>
    !search ||
    log.entity_type.toLowerCase().includes(search.toLowerCase()) ||
    log.description?.toLowerCase().includes(search.toLowerCase()) ||
    log.entity_id?.includes(search)
  );

  const entityTypes = [...new Set(logs.map(l => l.entity_type))].sort();

  return (
    <ProtectedPage capability={CAPABILITIES.AUDIT_VIEW}>
      <div>
        {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                 style={{ background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)' }}>
              <ShieldCheck size={20} className="text-white" />
            </div>
            Audit Trail
          </h1>
          <p className="text-[var(--text-secondary)] text-sm mt-1">
            Complete compliance audit log — all system changes tracked
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={loadData}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </div>

      {/* Activity summary */}
      {summary && (
        <div className="glass-card p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={16} className="text-[var(--accent-blue)]" />
            <h2 className="font-semibold text-sm">Last 7 Days Activity</h2>
          </div>
          <div className="flex flex-wrap gap-3">
            {summary.by_action.map(item => (
              <div key={item.action} className="glass-card p-3 flex items-center gap-3">
                <span className={`badge ${actionColors[item.action as AuditAction] || 'badge-blue'} text-[10px]`}>
                  {item.action.replace(/_/g, ' ')}
                </span>
                <span className="font-bold text-lg">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="glass-card p-4 mb-6 flex flex-wrap gap-3">
        <div className="flex-1 min-w-[180px] relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            className="pharma-input"
            style={{ paddingLeft: '36px' }}
            placeholder="Search logs..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="pharma-select" style={{ width: 'auto', minWidth: '140px' }}
          value={entityTypeFilter} onChange={e => { setEntityTypeFilter(e.target.value); setPage(1); }}>
          <option value="">All Entities</option>
          {entityTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="pharma-select" style={{ width: 'auto', minWidth: '160px' }}
          value={actionFilter} onChange={e => { setActionFilter(e.target.value); setPage(1); }}>
          <option value="">All Actions</option>
          <option value="SALE_CREATED">Sale Created</option>
          <option value="BATCH_ADDED">Batch Added</option>
          <option value="TRANSFER_CREATED">Transfer</option>
          <option value="PRESCRIPTION_APPROVED">Rx Approved</option>
          <option value="AI_DECISION">AI Decision</option>
          <option value="LOGIN">Login</option>
        </select>
      </div>

      {/* Timeline */}
      <div className="glass-card p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-3">
            <div className="spinner" /> <span className="text-[var(--text-secondary)]">Loading audit logs...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-[var(--text-muted)]">
            <ShieldCheck size={40} opacity={0.3} />
            <p>No audit logs found</p>
          </div>
        ) : (
          <div style={{ paddingLeft: '8px' }}>
            {filtered.map(log => (
              <div
                key={log.id}
                className="audit-entry cursor-pointer hover:bg-[rgba(59,130,246,0.03)] rounded-lg transition-colors"
                onClick={() => setSelectedLog(log)}
              >
                <div
                  className="audit-dot"
                  style={{ background: actionDots[log.action] || '#3b82f6' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className={`badge ${actionColors[log.action] || 'badge-blue'} text-[10px]`}>
                      {log.action.replace(/_/g, ' ')}
                    </span>
                    <span className="text-sm font-medium">{log.entity_type}</span>
                    {log.entity_id && (
                      <span className="text-xs text-[var(--text-muted)] font-mono">#{log.entity_id}</span>
                    )}
                    <Info size={12} className="ml-auto text-[var(--text-muted)] opacity-0 group-hover:opacity-100" />
                  </div>
                  {log.description && (
                    <p className="text-sm text-[var(--text-secondary)] mb-1">{log.description}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]">
                    <span>{timeAgo(log.timestamp)}</span>
                    {log.store_id && <span>Store #{log.store_id}</span>}
                    {log.changed_by_user_id && <span>User #{log.changed_by_user_id}</span>}
                    {log.request_id && (
                      <span className="font-mono hidden sm:inline">req: {log.request_id}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {!loading && filtered.length > 0 && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-[var(--border)]">
            <p className="text-sm text-[var(--text-muted)]">
              Showing {filtered.length} entries (page {page})
            </p>
            <div className="flex gap-2">
              <button className="btn-secondary" style={{ padding: '8px 16px', minHeight: '36px' }}
                disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                Previous
              </button>
              <button className="btn-secondary" style={{ padding: '8px 16px', minHeight: '36px' }}
                onClick={() => setPage(p => p + 1)}>
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedLog && (
        <div className="modal-overlay" onClick={() => setSelectedLog(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <h2 className="font-bold text-lg">Audit Entry #{selectedLog.id}</h2>
                <span className={`badge ${actionColors[selectedLog.action] || 'badge-blue'} text-[10px]`}>
                  {selectedLog.action.replace(/_/g, ' ')}
                </span>
              </div>
              <button onClick={() => setSelectedLog(null)} className="text-[var(--text-muted)]">✕</button>
            </div>

            <div className="space-y-4 text-sm">
              <div className="glass-card p-4">
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">What changed</p>
                <p className="font-medium">{selectedLog.entity_type} #{selectedLog.entity_id}</p>
                {selectedLog.description && <p className="text-[var(--text-secondary)] mt-1">{selectedLog.description}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="glass-card p-3">
                  <p className="text-xs text-[var(--text-muted)] mb-1">Timestamp</p>
                  <p className="font-medium">{new Date(selectedLog.timestamp).toLocaleString('en-IN')}</p>
                </div>
                <div className="glass-card p-3">
                  <p className="text-xs text-[var(--text-muted)] mb-1">User ID</p>
                  <p className="font-medium">#{selectedLog.changed_by_user_id || '—'}</p>
                </div>
              </div>

              {(selectedLog.old_value || selectedLog.new_value) && (
                <div className="glass-card p-4">
                  <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-3">Data Changes</p>
                  <div className="grid grid-cols-2 gap-3">
                    {selectedLog.old_value && (
                      <div>
                        <p className="text-xs text-[var(--accent-rose)] mb-2">Before</p>
                        <pre className="text-xs bg-[var(--bg-secondary)] p-2 rounded-lg overflow-auto max-h-40">
                          {JSON.stringify(selectedLog.old_value, null, 2)}
                        </pre>
                      </div>
                    )}
                    {selectedLog.new_value && (
                      <div>
                        <p className="text-xs text-[var(--accent-emerald)] mb-2">After</p>
                        <pre className="text-xs bg-[var(--bg-secondary)] p-2 rounded-lg overflow-auto max-h-40">
                          {JSON.stringify(selectedLog.new_value, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {selectedLog.request_id && (
                <div className="glass-card p-3">
                  <p className="text-xs text-[var(--text-muted)] mb-1">Request ID</p>
                  <p className="font-mono text-xs">{selectedLog.request_id}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </ProtectedPage>
  );
}
