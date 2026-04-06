'use client';
import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardList, Plus, Check, X, Clock,
  User, Calendar, Search,
  AlertCircle, CheckCircle, RefreshCw, FileText
} from 'lucide-react';
import api from '@/services/api';
import ProtectedPage from '@/components/ProtectedPage';
import { CAPABILITIES, hasCapability } from '@/lib/permissions';
import { useAuth } from '@/context/AuthContext';

// ── Types ──────────────────────────────────────────────────────────────────
type PrescriptionStatus = 'pending' | 'approved' | 'dispensed' | 'rejected' | 'expired';

interface Prescription {
  id: number;
  patient_name: string;
  patient_age?: number;
  patient_phone?: string;
  doctor_name: string;
  doctor_registration?: string;
  prescription_date: string;
  valid_until?: string;
  diagnosis?: string;
  notes?: string;
  document_url?: string;
  status: PrescriptionStatus;
  store_id: number;
  created_by_user_id: number;
  reviewed_by_user_id?: number;
  is_refill: boolean;
  refill_count: number;
  max_refills: number;
  created_at: string;
  reviewed_at?: string;
}

// ── Status helpers ────────────────────────────────────────────────────────
const statusConfig: Record<PrescriptionStatus, { label: string; className: string; icon: React.ReactNode }> = {
  pending: { label: 'Pending Review', className: 'status-pending', icon: <Clock size={12} /> },
  approved: { label: 'Approved', className: 'status-approved', icon: <CheckCircle size={12} /> },
  dispensed: { label: 'Dispensed', className: 'status-dispensed', icon: <Check size={12} /> },
  rejected: { label: 'Rejected', className: 'status-rejected', icon: <X size={12} /> },
  expired: { label: 'Expired', className: 'status-expired', icon: <AlertCircle size={12} /> },
};

export default function PrescriptionsPage() {
  const { user } = useAuth();
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<PrescriptionStatus | ''>('');
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedRx, setSelectedRx] = useState<Prescription | null>(null);
  const [approving, setApproving] = useState<number | null>(null);

  // Form state
  const [form, setForm] = useState({
    patient_name: '', patient_age: '', patient_phone: '',
    doctor_name: '', doctor_registration: '', doctor_phone: '',
    prescription_date: new Date().toISOString().split('T')[0],
    valid_until: '', diagnosis: '', notes: '', store_id: 1,
  });
  const canReview = hasCapability(user?.role, CAPABILITIES.PRESCRIPTIONS_REVIEW);

  const loadPrescriptions = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = {};
      if (statusFilter) params.status_filter = statusFilter;
      const res = await api.get('/prescriptions', { params });
      setPrescriptions(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { loadPrescriptions(); }, [loadPrescriptions]);

  async function createPrescription() {
    try {
      await api.post('/prescriptions', {
        ...form,
        patient_age: form.patient_age ? parseInt(form.patient_age) : null,
      });
      setShowCreateModal(false);
      setForm({
        patient_name: '', patient_age: '', patient_phone: '',
        doctor_name: '', doctor_registration: '', doctor_phone: '',
        prescription_date: new Date().toISOString().split('T')[0],
        valid_until: '', diagnosis: '', notes: '', store_id: 1,
      });
      loadPrescriptions();
    } catch (e: unknown) {
      console.error(e);
      alert('Failed to create prescription');
    }
  }

  async function approvePrescription(id: number) {
    setApproving(id);
    try {
      await api.put(`/prescriptions/${id}/approve`);
      loadPrescriptions();
      if (selectedRx?.id === id) {
        setSelectedRx(prev => prev ? { ...prev, status: 'approved' } : null);
      }
    } catch (e) {
      console.error(e);
      alert('Failed to approve prescription');
    } finally {
      setApproving(null);
    }
  }

  async function rejectPrescription(id: number) {
    const reason = window.prompt('Reason for rejection:');
    if (!reason) return;
    try {
      await api.put(`/prescriptions/${id}/reject`, null, { params: { reason } });
      loadPrescriptions();
      if (selectedRx?.id === id) setSelectedRx(null);
    } catch (e) {
      console.error(e);
    }
  }

  const filtered = prescriptions.filter(rx =>
    rx.patient_name.toLowerCase().includes(search.toLowerCase()) ||
    rx.doctor_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <ProtectedPage capability={CAPABILITIES.PRESCRIPTIONS_VIEW}>
      <div className="page-shell">
        {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                 style={{ background: 'linear-gradient(135deg, #8b5cf6, #06b6d4)' }}>
              <ClipboardList size={20} className="text-white" />
            </div>
            Prescriptions
          </h1>
          <p className="text-[var(--text-secondary)] text-sm mt-1">
            Manage Rx intake, pharmacist approval, and dispensing workflow
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
          <Plus size={16} />
          {canReview ? 'New Prescription' : 'Capture Prescription'}
        </button>
      </div>

      <div className="glass-card p-4 mb-6">
        <div className="text-sm font-semibold mb-1">{canReview ? 'Review and intake workspace' : 'Prescription intake workspace'}</div>
        <div className="text-[13px] text-[var(--text-secondary)]">
          {canReview
            ? 'You can intake prescriptions, review pending ones, and move approvals forward for the branch.'
            : 'You can capture and track prescriptions here. Approval actions are reserved for manager-level roles.'}
        </div>
      </div>

      {/* Filters */}
      <div className="glass-card p-4 mb-6 flex flex-wrap gap-3">
        <div className="flex-1 min-w-[200px] relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            className="pharma-input"
            style={{ paddingLeft: '36px' }}
            placeholder="Search patient or doctor..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="pharma-select"
          style={{ width: 'auto', minWidth: '160px' }}
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as PrescriptionStatus | '')}
        >
          <option value="">All Status</option>
          <option value="pending">Pending Review</option>
          <option value="approved">Approved</option>
          <option value="dispensed">Dispensed</option>
          <option value="rejected">Rejected</option>
          <option value="expired">Expired</option>
        </select>
        <button className="btn-secondary" onClick={loadPrescriptions} style={{ padding: '10px 14px' }}>
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Summary cards */}
      <div className="card-grid mb-6">
        {(['pending', 'approved', 'dispensed', 'rejected'] as PrescriptionStatus[]).map(s => {
          const count = prescriptions.filter(rx => rx.status === s).length;
          const cfg = statusConfig[s];
          return (
            <button
              key={s}
              className="glass-card p-4 text-left cursor-pointer"
              onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
              style={{ border: statusFilter === s ? '1px solid var(--accent-blue)' : undefined }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className={`badge ${cfg.className}`}>{cfg.label}</span>
                {statusFilter === s && <span className="badge badge-blue text-[9px]">Active</span>}
              </div>
              <div className="text-3xl font-bold">{count}</div>
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-3">
            <div className="spinner" /> <span className="text-[var(--text-secondary)]">Loading...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--text-muted)]">
            <ClipboardList size={40} opacity={0.3} />
            <p>No prescriptions found</p>
          </div>
        ) : (
          <>
            {/* Mobile: card list */}
            <div className="sm:hidden divide-y divide-[var(--border)]">
              {filtered.map(rx => (
                <div
                  key={rx.id}
                  className="p-4 cursor-pointer hover:bg-[var(--bg-card-hover)]"
                  onClick={() => setSelectedRx(rx)}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <p className="font-semibold text-sm">{rx.patient_name}</p>
                      <p className="text-xs text-[var(--text-secondary)]">Dr. {rx.doctor_name}</p>
                    </div>
                    <span className={`badge ${statusConfig[rx.status].className}`}>
                      {statusConfig[rx.status].icon}
                      {statusConfig[rx.status].label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--text-muted)]">
                      {new Date(rx.prescription_date).toLocaleDateString('en-IN')}
                    </span>
	                    {rx.status === 'pending' && canReview && (
                      <button
                        className="btn-primary text-xs"
                        style={{ padding: '6px 12px', minHeight: '32px' }}
                        onClick={e => { e.stopPropagation(); approvePrescription(rx.id); }}
                      >
                        {approving === rx.id ? <RefreshCw size={12} className="animate-spin-slow" /> : <Check size={12} />}
                        Approve
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="pharma-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Patient</th>
                    <th>Doctor</th>
                    <th>Rx Date</th>
                    <th>Valid Until</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(rx => (
                    <tr key={rx.id} className="cursor-pointer" onClick={() => setSelectedRx(rx)}>
                      <td className="text-[var(--text-muted)] font-mono">#{rx.id}</td>
                      <td>
                        <div className="font-medium">{rx.patient_name}</div>
                        {rx.patient_age && <div className="text-xs text-[var(--text-muted)]">{rx.patient_age} yrs</div>}
                      </td>
                      <td>
                        <div>{rx.doctor_name}</div>
                        {rx.doctor_registration && <div className="text-xs text-[var(--text-muted)]">{rx.doctor_registration}</div>}
                      </td>
                      <td>{new Date(rx.prescription_date).toLocaleDateString('en-IN')}</td>
                      <td>{rx.valid_until ? new Date(rx.valid_until).toLocaleDateString('en-IN') : '—'}</td>
                      <td>
                        <span className={`badge ${statusConfig[rx.status].className}`}>
                          {statusConfig[rx.status].icon}
                          {statusConfig[rx.status].label}
                        </span>
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <div className="flex gap-2">
                          {rx.status === 'pending' && canReview && (
                            <>
                              <button
                                className="btn-primary text-xs"
                                style={{ padding: '6px 12px', minHeight: '32px' }}
                                onClick={() => approvePrescription(rx.id)}
                              >
                                {approving === rx.id ? <RefreshCw size={12} className="animate-spin-slow" /> : <Check size={12} />}
                                Approve
                              </button>
                              <button
                                className="btn-danger text-xs"
                                style={{ minHeight: '32px' }}
                                onClick={() => rejectPrescription(rx.id)}
                              >
                                <X size={12} /> Reject
                              </button>
                            </>
                          )}
                          {rx.document_url && (
                            <a href={rx.document_url} target="_blank" rel="noreferrer" className="btn-secondary text-xs" style={{ minHeight: '32px' }}>
                              <FileText size={12} /> View Rx
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold">New Prescription</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-[var(--text-muted)]"><X size={20} /></button>
            </div>

            {/* Patient section */}
            <div className="mb-5">
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3 flex items-center gap-2">
                <User size={12} /> Patient Information
              </p>
              <div className="grid grid-cols-1 gap-3">
                <input className="pharma-input" placeholder="Patient Name *" value={form.patient_name} onChange={e => setForm(f => ({ ...f, patient_name: e.target.value }))} />
                <div className="grid grid-cols-2 gap-3">
                  <input className="pharma-input" placeholder="Age" type="number" value={form.patient_age} onChange={e => setForm(f => ({ ...f, patient_age: e.target.value }))} />
                  <input className="pharma-input" placeholder="Phone" value={form.patient_phone} onChange={e => setForm(f => ({ ...f, patient_phone: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Doctor section */}
            <div className="mb-5">
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3 flex items-center gap-2">
                Doctor Information
              </p>
              <div className="grid grid-cols-1 gap-3">
                <input className="pharma-input" placeholder="Doctor Name *" value={form.doctor_name} onChange={e => setForm(f => ({ ...f, doctor_name: e.target.value }))} />
                <div className="grid grid-cols-2 gap-3">
                  <input className="pharma-input" placeholder="Reg. Number" value={form.doctor_registration} onChange={e => setForm(f => ({ ...f, doctor_registration: e.target.value }))} />
                  <input className="pharma-input" placeholder="Phone" value={form.doctor_phone} onChange={e => setForm(f => ({ ...f, doctor_phone: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Prescription details */}
            <div className="mb-5">
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3 flex items-center gap-2">
                <Calendar size={12} /> Prescription Details
              </p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-xs text-[var(--text-muted)] mb-1 block">Rx Date *</label>
                  <input className="pharma-input" type="date" value={form.prescription_date} onChange={e => setForm(f => ({ ...f, prescription_date: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-[var(--text-muted)] mb-1 block">Valid Until</label>
                  <input className="pharma-input" type="date" value={form.valid_until} onChange={e => setForm(f => ({ ...f, valid_until: e.target.value }))} />
                </div>
              </div>
              <textarea className="pharma-input" placeholder="Diagnosis / Notes" rows={3} style={{ resize: 'vertical' }} value={form.diagnosis} onChange={e => setForm(f => ({ ...f, diagnosis: e.target.value }))} />
            </div>

            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button
                className="btn-primary flex-1"
                onClick={createPrescription}
                disabled={!form.patient_name || !form.doctor_name}
              >
                <ClipboardList size={16} />
                Create Prescription
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      {selectedRx && (
        <div className="modal-overlay" onClick={() => setSelectedRx(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold">Prescription #{selectedRx.id}</h2>
                <span className={`badge ${statusConfig[selectedRx.status].className}`}>
                  {statusConfig[selectedRx.status].label}
                </span>
              </div>
              <button onClick={() => setSelectedRx(null)} className="text-[var(--text-muted)]"><X size={20} /></button>
            </div>

            <div className="space-y-4">
              <div className="glass-card p-4">
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">Patient</p>
                <p className="font-semibold">{selectedRx.patient_name}</p>
                {selectedRx.patient_age && <p className="text-sm text-[var(--text-secondary)]">Age: {selectedRx.patient_age}</p>}
                {selectedRx.patient_phone && <p className="text-sm text-[var(--text-secondary)]">📞 {selectedRx.patient_phone}</p>}
              </div>

              <div className="glass-card p-4">
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">Prescribing Doctor</p>
                <p className="font-semibold">Dr. {selectedRx.doctor_name}</p>
                {selectedRx.doctor_registration && <p className="text-sm text-[var(--text-secondary)]">Reg: {selectedRx.doctor_registration}</p>}
              </div>

              {selectedRx.diagnosis && (
                <div className="glass-card p-4">
                  <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">Diagnosis / Notes</p>
                  <p className="text-sm">{selectedRx.diagnosis}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="glass-card p-3">
                  <p className="text-xs text-[var(--text-muted)] mb-1">Rx Date</p>
                  <p className="font-medium">{new Date(selectedRx.prescription_date).toLocaleDateString('en-IN')}</p>
                </div>
                {selectedRx.valid_until && (
                  <div className="glass-card p-3">
                    <p className="text-xs text-[var(--text-muted)] mb-1">Valid Until</p>
                    <p className="font-medium">{new Date(selectedRx.valid_until).toLocaleDateString('en-IN')}</p>
                  </div>
                )}
              </div>

              {selectedRx.document_url && (
                <a href={selectedRx.document_url} target="_blank" rel="noreferrer" className="btn-secondary w-full">
                  <FileText size={16} /> View Prescription Document
                </a>
              )}
            </div>

	            {selectedRx.status === 'pending' && canReview && (
              <div className="flex gap-3 mt-6">
                <button
                  className="btn-danger flex-1"
                  onClick={() => rejectPrescription(selectedRx.id)}
                >
                  <X size={16} /> Reject
                </button>
                <button
                  className="btn-primary flex-1"
                  onClick={() => approvePrescription(selectedRx.id)}
                >
                  {approving === selectedRx.id ? <RefreshCw size={16} className="animate-spin-slow" /> : <Check size={16} />}
                  Approve
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </ProtectedPage>
  );
}
