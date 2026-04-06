'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRightLeft,
  PackagePlus,
  RefreshCw,
  Search,
  ShoppingBag,
  Sparkles,
  WifiOff,
  X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import ProtectedPage from '@/components/ProtectedPage';
import { CAPABILITIES, hasCapability } from '@/lib/permissions';
import { inventoryApi } from '@/services/api';
import { offlineQueue } from '@/lib/offlineQueue';
import { useOfflineSync } from '@/hooks/useOfflineSync';

type Tab = 'stock' | 'low-stock' | 'expiry' | 'planning' | 'transfer';

interface StatusMessage {
  kind: 'success' | 'error' | 'info';
  text: string;
}

interface TransferRecommendation {
  from_store_id: number;
  from_store_name: string;
  to_store_id: number;
  to_store_name: string;
  medicine_id: number;
  medicine_name: string;
  medicine_category: string;
  recommended_quantity: number;
  reason: string;
  urgency_score: number;
  urgency_tag: string;
  surplus_at_source: number;
  shortage_at_dest: number;
  days_to_nearest_expiry: number | null;
}

interface ProcurementRecommendation {
  store_id: number;
  store_name: string;
  medicine_id: number;
  medicine_name: string;
  medicine_category: string;
  current_quantity: number;
  target_quantity: number;
  reorder_quantity: number;
  urgency_tag: string;
  reason: string;
}

interface ReplenishmentPlan {
  summary: {
    store_scope: number | null;
    low_stock_items: number;
    transfer_candidates: number;
    procurement_candidates: number;
    target_days_of_cover: number;
  };
  transfer_recommendations: TransferRecommendation[];
  procurement_recommendations: ProcurementRecommendation[];
}

const emptyBatchForm = {
  medicine_id: '',
  store_id: '',
  batch_number: '',
  expiry_date: '',
  cost_price: '',
  quantity: '',
};

const emptyTransferForm = {
  from_store_id: '',
  to_store_id: '',
  medicine_id: '',
  quantity: '',
};

export default function InventoryPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('stock');
  const [inventory, setInventory] = useState<any[]>([]);
  const [lowStock, setLowStock] = useState<any[]>([]);
  const [expiry, setExpiry] = useState<any[]>([]);
  const [medicines, setMedicines] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [replenishmentPlan, setReplenishmentPlan] = useState<ReplenishmentPlan | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [form, setForm] = useState(emptyBatchForm);
  const [transferForm, setTransferForm] = useState(emptyTransferForm);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<StatusMessage | null>(null);
  const canAddBatch = hasCapability(user?.role, CAPABILITIES.INVENTORY_ADD_BATCH);
  const canTransfer = hasCapability(user?.role, CAPABILITIES.INVENTORY_TRANSFER);
  const isStoreScoped = Boolean(user?.store_id);
  const visibleStores = isStoreScoped ? stores.filter((store: any) => store.id === user?.store_id) : stores;
  const { isOnline, isSyncing, queueSize, lastSyncResult, syncNow, refreshQueueSize } = useOfflineSync();

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [user, isLoading, router]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [inv, low, exp, med, sto, plan] = await Promise.all([
        inventoryApi.getInventory(),
        inventoryApi.getLowStock(),
        inventoryApi.getExpiryAlerts(),
        inventoryApi.getMedicines(),
        inventoryApi.getStores(),
        inventoryApi.getReplenishmentPlan(user?.store_id ?? undefined),
      ]);
      setInventory(inv.data);
      setLowStock(low.data);
      setExpiry(exp.data);
      setMedicines(med.data);
      setStores(sto.data);
      setReplenishmentPlan(plan.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      void loadData();
    }
  }, [user]);

  useEffect(() => {
    if (user?.store_id) {
      setForm((current) => ({ ...current, store_id: current.store_id || String(user.store_id) }));
      setTransferForm((current) => ({ ...current, from_store_id: current.from_store_id || String(user.store_id) }));
    }
  }, [user?.store_id]);

  useEffect(() => {
    if (!lastSyncResult) return;
    if (lastSyncResult.applied > 0 || lastSyncResult.duplicates > 0 || lastSyncResult.conflicts > 0) {
      setMsg({
        kind: lastSyncResult.failed > 0 ? 'info' : 'success',
        text: `Inventory sync applied ${lastSyncResult.applied} event(s), ignored ${lastSyncResult.duplicates} duplicate(s), and resolved ${lastSyncResult.conflicts} conflict(s).`,
      });
      void loadData();
    } else if (lastSyncResult.failed > 0) {
      setMsg({ kind: 'error', text: `Inventory sync could not upload ${lastSyncResult.failed} queued event(s).` });
    }
  }, [lastSyncResult]);

  const filteredInventory = inventory.filter(
    (item) => !search || item.medicine?.name?.toLowerCase().includes(search.toLowerCase())
  );

  const resetBatchForm = () => {
    setForm({ ...emptyBatchForm, store_id: user?.store_id ? String(user.store_id) : '' });
  };

  const resetTransferForm = () => {
    setTransferForm({ ...emptyTransferForm, from_store_id: user?.store_id ? String(user.store_id) : '' });
  };

  const closeAddModal = () => {
    setShowAddModal(false);
    setMsg(null);
    resetBatchForm();
  };

  const closeTransferModal = () => {
    setShowTransferModal(false);
    setMsg(null);
    resetTransferForm();
  };

  const openTransferFromRecommendation = (recommendation: TransferRecommendation) => {
    setTransferForm({
      from_store_id: String(recommendation.from_store_id),
      to_store_id: String(recommendation.to_store_id),
      medicine_id: String(recommendation.medicine_id),
      quantity: String(recommendation.recommended_quantity),
    });
    setShowTransferModal(true);
    setMsg({
      kind: 'info',
      text: `Transfer recommendation loaded for ${recommendation.medicine_name}. Review and submit the movement.`,
    });
  };

  const handleAddBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMsg(null);

    const batchPayload = {
      medicine_id: Number(form.medicine_id),
      store_id: Number(form.store_id),
      batch_number: form.batch_number,
      expiry_date: form.expiry_date,
      cost_price: Number(form.cost_price),
      quantity: Number(form.quantity),
    };

    try {
      if (!navigator.onLine) {
        await offlineQueue.queueBatchAdd(batchPayload);
        await refreshQueueSize();
        setMsg({ kind: 'info', text: 'Batch saved offline. It will sync when connectivity returns.' });
        resetBatchForm();
        setTimeout(closeAddModal, 1500);
        return;
      }

      await inventoryApi.addBatch(batchPayload);
      setMsg({ kind: 'success', text: 'Batch added successfully.' });
      resetBatchForm();
      await loadData();
      setTimeout(closeAddModal, 1500);
    } catch (err: any) {
      if (!err.response) {
        await offlineQueue.queueBatchAdd(batchPayload);
        await refreshQueueSize();
        setMsg({ kind: 'info', text: 'Batch saved offline after connection loss. It will sync automatically later.' });
        resetBatchForm();
        setTimeout(closeAddModal, 1500);
        return;
      }

      setMsg({ kind: 'error', text: err.response?.data?.detail || 'Failed' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMsg(null);

    const transferPayload = {
      from_store_id: Number(transferForm.from_store_id),
      to_store_id: Number(transferForm.to_store_id),
      medicine_id: Number(transferForm.medicine_id),
      quantity: Number(transferForm.quantity),
    };

    try {
      if (!navigator.onLine) {
        await offlineQueue.queueTransferCreate(transferPayload);
        await refreshQueueSize();
        setMsg({ kind: 'info', text: 'Transfer request saved offline. It will sync when this device is back online.' });
        resetTransferForm();
        setTimeout(closeTransferModal, 1500);
        return;
      }

      await inventoryApi.transfer(transferPayload);
      setMsg({ kind: 'success', text: 'Transfer completed.' });
      resetTransferForm();
      await loadData();
      setTimeout(closeTransferModal, 1500);
      return;
    } catch (err: any) {
      if (!err.response) {
        await offlineQueue.queueTransferCreate(transferPayload);
        await refreshQueueSize();
        setMsg({ kind: 'info', text: 'Transfer request saved offline after connection loss. It will sync automatically later.' });
        resetTransferForm();
        setTimeout(closeTransferModal, 1500);
        return;
      }

      setMsg({ kind: 'error', text: err.response?.data?.detail || 'Failed' });
    } finally {
      setSubmitting(false);
    }
  };

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'stock', label: 'Stock Levels', count: inventory.length },
    { id: 'low-stock', label: 'Low Stock', count: lowStock.length },
    { id: 'expiry', label: 'Expiry Alerts', count: expiry.length },
    {
      id: 'planning',
      label: 'Replenishment',
      count: (replenishmentPlan?.transfer_recommendations.length || 0) + (replenishmentPlan?.procurement_recommendations.length || 0),
    },
  ];
  if (canTransfer) {
    tabs.push({ id: 'transfer', label: 'Transfer' });
  }

  if (isLoading || !user) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'var(--bg-primary)' }}>
        <div className="spinner" style={{ width: 40, height: 40 }} />
      </div>
    );
  }

  return (
    <ProtectedPage capability={CAPABILITIES.INVENTORY_VIEW}>
      <div className="page-shell">
        <div className="page-header">
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Inventory Management</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Batch-aware stock tracking, replenishment planning, and branch balancing</p>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={() => void loadData()} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <RefreshCw size={14} />
              Refresh
            </button>
            {canTransfer && (
              <button onClick={() => setShowTransferModal(true)} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ArrowRightLeft size={14} />
                Transfer
              </button>
            )}
            {canAddBatch && (
              <button onClick={() => setShowAddModal(true)} className="btn-primary">
                <PackagePlus size={16} />
                Add Batch
              </button>
            )}
          </div>
        </div>

        {isStoreScoped && (
          <div className="glass-card" style={{ padding: '14px 16px', marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Branch scope enabled</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              Inventory actions on this screen are limited to Store #{user?.store_id}.
            </div>
          </div>
        )}

        <div className="glass-card" style={{ padding: '14px 16px', marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {isOnline ? <RefreshCw size={16} color="var(--accent-blue)" /> : <WifiOff size={16} color="#f59e0b" />}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>
                  {isOnline ? 'Inventory sync ready' : 'Offline inventory mode'}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                  {queueSize > 0 ? `${queueSize} inventory event(s) are queued for replay.` : 'No queued inventory changes right now.'}
                </div>
              </div>
            </div>
            <button onClick={() => void syncNow()} className="btn-secondary" disabled={!isOnline || isSyncing || queueSize === 0}>
              <RefreshCw size={14} />
              {isSyncing ? 'Syncing...' : 'Sync now'}
            </button>
          </div>
        </div>

        {replenishmentPlan && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4" style={{ marginBottom: 18 }}>
            <div className="glass-card" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Low Stock Items</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{replenishmentPlan.summary.low_stock_items}</div>
            </div>
            <div className="glass-card" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Transfer Candidates</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#60a5fa' }}>{replenishmentPlan.summary.transfer_candidates}</div>
            </div>
            <div className="glass-card" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Procurement Needed</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#f59e0b' }}>{replenishmentPlan.summary.procurement_candidates}</div>
            </div>
            <div className="glass-card" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Target Cover</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{replenishmentPlan.summary.target_days_of_cover} days</div>
            </div>
          </div>
        )}

        {msg && (
          <div
            className="glass-card"
            style={{
              padding: '14px 16px',
              marginBottom: 18,
              borderColor:
                msg.kind === 'success'
                  ? 'rgba(16,185,129,0.35)'
                  : msg.kind === 'error'
                    ? 'rgba(244,63,94,0.35)'
                    : 'rgba(59,130,246,0.35)',
            }}
          >
            <div
              style={{
                color: msg.kind === 'success' ? '#34d399' : msg.kind === 'error' ? '#fb7185' : '#60a5fa',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {msg.text}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-secondary)', borderRadius: 12, padding: 6, width: 'fit-content', flexWrap: 'wrap' }}>
          {tabs.map((currentTab) => (
            <button
              key={currentTab.id}
              onClick={() => setTab(currentTab.id)}
              style={{
                padding: '8px 16px',
                borderRadius: 9,
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                transition: 'all 0.2s',
                background: tab === currentTab.id ? 'var(--bg-card)' : 'transparent',
                color: tab === currentTab.id ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: tab === currentTab.id ? '0 2px 8px rgba(0,0,0,0.3)' : 'none',
              }}
            >
              {currentTab.label}
              {currentTab.count !== undefined && (
                <span
                  style={{
                    marginLeft: 8,
                    background: tab === currentTab.id ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.05)',
                    color: tab === currentTab.id ? '#60a5fa' : 'var(--text-muted)',
                    borderRadius: 10,
                    padding: '1px 7px',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {currentTab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
          {tab === 'stock' && (
            <>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'center' }}>
                <Search size={16} color="var(--text-muted)" />
                <input
                  className="pharma-input"
                  placeholder="Search medicine..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ border: 'none', background: 'transparent', padding: '4px 0', fontSize: 14 }}
                />
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="pharma-table">
                  <thead>
                    <tr>
                      <th>Medicine</th>
                      <th>Category</th>
                      <th>Store ID</th>
                      <th>Total Quantity</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInventory.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                          {loading ? 'Loading...' : 'No inventory data'}
                        </td>
                      </tr>
                    ) : (
                      filteredInventory.map((item: any) => (
                        <tr key={item.id}>
                          <td style={{ fontWeight: 500 }}>{item.medicine?.name || `Med #${item.medicine_id}`}</td>
                          <td><span className="badge badge-blue">{item.medicine?.category || '-'}</span></td>
                          <td style={{ color: 'var(--text-secondary)' }}>Store #{item.store_id}</td>
                          <td style={{ fontWeight: 600 }}>{item.total_quantity}</td>
                          <td>
                            <span className={`badge ${item.total_quantity <= 0 ? 'badge-rose' : item.total_quantity <= 20 ? 'badge-amber' : 'badge-green'}`}>
                              {item.total_quantity <= 0 ? 'Out of Stock' : item.total_quantity <= 20 ? 'Low Stock' : 'In Stock'}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === 'low-stock' && (
            <div className="overflow-x-auto">
              <table className="pharma-table">
                <thead>
                  <tr>
                    <th>Medicine</th>
                    <th>Store</th>
                    <th>Quantity</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStock.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                        No low stock alerts
                      </td>
                    </tr>
                  ) : (
                    lowStock.map((item: any, index: number) => (
                      <tr key={`${item.medicine_id}-${index}`}>
                        <td style={{ fontWeight: 500 }}>{item.medicine_name}</td>
                        <td style={{ color: 'var(--text-secondary)' }}>{item.store_name}</td>
                        <td><span style={{ color: '#fbbf24', fontWeight: 700 }}>{item.total_quantity}</span></td>
                        <td><span className="badge badge-amber">Low Stock</span></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'expiry' && (
            <div className="overflow-x-auto">
              <table className="pharma-table">
                <thead>
                  <tr>
                    <th>Medicine</th>
                    <th>Batch</th>
                    <th>Expiry Date</th>
                    <th>Qty</th>
                    <th>Days Left</th>
                  </tr>
                </thead>
                <tbody>
                  {expiry.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                        No expiry alerts
                      </td>
                    </tr>
                  ) : (
                    expiry.map((item: any) => (
                      <tr key={item.batch_id}>
                        <td style={{ fontWeight: 500 }}>{item.medicine_name}</td>
                        <td style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{item.batch_number}</td>
                        <td>{item.expiry_date}</td>
                        <td>{item.quantity}</td>
                        <td>
                          <span className={`badge ${item.days_to_expiry < 10 ? 'badge-rose' : 'badge-amber'}`}>
                            {item.days_to_expiry < 0 ? 'Expired' : `${item.days_to_expiry} days`}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'planning' && (
            <div style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Replenishment Plan</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    Transfer what we can internally, then flag the remaining shortages for procurement.
                  </p>
                </div>
                <span className="badge badge-blue" style={{ padding: '8px 12px' }}>
                  <Sparkles size={14} style={{ marginRight: 6 }} />
                  Smart planning
                </span>
              </div>

              {!replenishmentPlan ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading replenishment plan...</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  <div className="glass-card" style={{ padding: 18 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                      <ArrowRightLeft size={18} color="#60a5fa" />
                      <h4 style={{ fontSize: 15, fontWeight: 700 }}>Transfer-backed actions</h4>
                    </div>
                    {replenishmentPlan.transfer_recommendations.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No inter-store balancing actions are needed right now.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {replenishmentPlan.transfer_recommendations.map((recommendation) => (
                          <div key={`${recommendation.to_store_id}-${recommendation.medicine_id}`} style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                              <div>
                                <div style={{ fontSize: 15, fontWeight: 700 }}>{recommendation.medicine_name}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                                  {recommendation.from_store_name} to {recommendation.to_store_name}
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <span className={`badge ${recommendation.urgency_tag === 'CRITICAL_SHORTAGE' ? 'badge-rose' : recommendation.urgency_tag === 'EXPIRY_RISK' ? 'badge-amber' : 'badge-blue'}`}>
                                  {recommendation.urgency_tag.replace('_', ' ')}
                                </span>
                                <span className="badge badge-green">{recommendation.recommended_quantity} units</span>
                              </div>
                            </div>
                            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 12 }}>{recommendation.reason}</p>
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12, color: 'var(--text-muted)', fontSize: 12 }}>
                              <span>Source surplus: {recommendation.surplus_at_source}</span>
                              <span>Destination stock: {recommendation.shortage_at_dest}</span>
                              <span>Urgency score: {recommendation.urgency_score}</span>
                            </div>
                            {canTransfer && (
                              <button onClick={() => openTransferFromRecommendation(recommendation)} className="btn-secondary" style={{ marginTop: 14 }}>
                                <ArrowRightLeft size={14} />
                                Use This Transfer
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="glass-card" style={{ padding: 18 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                      <ShoppingBag size={18} color="#f59e0b" />
                      <h4 style={{ fontSize: 15, fontWeight: 700 }}>Procurement queue</h4>
                    </div>
                    {replenishmentPlan.procurement_recommendations.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No external procurement actions are required right now.</p>
                    ) : (
                      <div style={{ overflowX: 'auto' }}>
                        <table className="pharma-table">
                          <thead>
                            <tr>
                              <th>Medicine</th>
                              <th>Store</th>
                              <th>Current Qty</th>
                              <th>Target Qty</th>
                              <th>Reorder Qty</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {replenishmentPlan.procurement_recommendations.map((recommendation) => (
                              <tr key={`${recommendation.store_id}-${recommendation.medicine_id}`}>
                                <td>
                                  <div style={{ fontWeight: 600 }}>{recommendation.medicine_name}</div>
                                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{recommendation.reason}</div>
                                </td>
                                <td>{recommendation.store_name}</td>
                                <td>{recommendation.current_quantity}</td>
                                <td>{recommendation.target_quantity}</td>
                                <td style={{ fontWeight: 700, color: '#f59e0b' }}>{recommendation.reorder_quantity}</td>
                                <td>
                                  <span className={`badge ${recommendation.urgency_tag === 'PROCURE_NOW' ? 'badge-rose' : 'badge-amber'}`}>
                                    {recommendation.urgency_tag.replace('_', ' ')}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'transfer' && canTransfer && (
            <div style={{ padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <ArrowRightLeft size={48} color="var(--accent-blue)" style={{ opacity: 0.5 }} />
              <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Use the transfer workspace to move inventory between stores or apply a planner recommendation.</p>
              <button onClick={() => setShowTransferModal(true)} className="btn-primary">
                <ArrowRightLeft size={16} />
                Initiate Transfer
              </button>
            </div>
          )}
        </div>

        {showAddModal && (
          <div className="modal-overlay" onClick={closeAddModal}>
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <h3 style={{ fontSize: 18, fontWeight: 700 }}>Add New Batch</h3>
                <button onClick={closeAddModal} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleAddBatch} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, display: 'block', marginBottom: 6 }}>Medicine</label>
                  <select className="pharma-input" value={form.medicine_id} onChange={(e) => setForm({ ...form, medicine_id: e.target.value })} required>
                    <option value="">Select medicine...</option>
                    {medicines.map((medicine: any) => <option key={medicine.id} value={medicine.id}>{medicine.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, display: 'block', marginBottom: 6 }}>Store</label>
                  <select className="pharma-input" value={form.store_id} onChange={(e) => setForm({ ...form, store_id: e.target.value })} required>
                    <option value="">Select store...</option>
                    {visibleStores.map((store: any) => <option key={store.id} value={store.id}>{store.name}</option>)}
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, display: 'block', marginBottom: 6 }}>Batch Number</label>
                    <input className="pharma-input" placeholder="BT-001" value={form.batch_number} onChange={(e) => setForm({ ...form, batch_number: e.target.value })} required />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, display: 'block', marginBottom: 6 }}>Expiry Date</label>
                    <input className="pharma-input" type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} required />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, display: 'block', marginBottom: 6 }}>Cost Price (Rs.)</label>
                    <input className="pharma-input" type="number" step="0.01" placeholder="0.00" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} required />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, display: 'block', marginBottom: 6 }}>Quantity</label>
                    <input className="pharma-input" type="number" placeholder="100" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
                  </div>
                </div>
                {msg && (
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      background:
                        msg.kind === 'success'
                          ? 'rgba(16,185,129,0.1)'
                          : msg.kind === 'error'
                            ? 'rgba(244,63,94,0.1)'
                            : 'rgba(59,130,246,0.1)',
                      color: msg.kind === 'success' ? '#34d399' : msg.kind === 'error' ? '#fb7185' : '#60a5fa',
                      fontSize: 13,
                    }}
                  >
                    {msg.text}
                  </div>
                )}
                <button type="submit" className="btn-primary" disabled={submitting} style={{ justifyContent: 'center' }}>
                  {submitting ? 'Adding...' : 'Add Batch'}
                </button>
              </form>
            </div>
          </div>
        )}

        {showTransferModal && (
          <div className="modal-overlay" onClick={closeTransferModal}>
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <h3 style={{ fontSize: 18, fontWeight: 700 }}>Transfer Stock</h3>
                <button onClick={closeTransferModal} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleTransfer} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, display: 'block', marginBottom: 6 }}>From Store</label>
                  <select className="pharma-input" value={transferForm.from_store_id} onChange={(e) => setTransferForm({ ...transferForm, from_store_id: e.target.value })} required>
                    <option value="">Select source store...</option>
                    {visibleStores.map((store: any) => <option key={store.id} value={store.id}>{store.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, display: 'block', marginBottom: 6 }}>To Store</label>
                  <select className="pharma-input" value={transferForm.to_store_id} onChange={(e) => setTransferForm({ ...transferForm, to_store_id: e.target.value })} required>
                    <option value="">Select destination store...</option>
                    {stores
                      .filter((store: any) => !isStoreScoped || store.id !== user?.store_id)
                      .map((store: any) => <option key={store.id} value={store.id}>{store.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, display: 'block', marginBottom: 6 }}>Medicine</label>
                  <select className="pharma-input" value={transferForm.medicine_id} onChange={(e) => setTransferForm({ ...transferForm, medicine_id: e.target.value })} required>
                    <option value="">Select medicine...</option>
                    {medicines.map((medicine: any) => <option key={medicine.id} value={medicine.id}>{medicine.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, display: 'block', marginBottom: 6 }}>Quantity</label>
                  <input className="pharma-input" type="number" placeholder="50" value={transferForm.quantity} onChange={(e) => setTransferForm({ ...transferForm, quantity: e.target.value })} required />
                </div>
                {msg && (
                  <div
                    style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      background:
                        msg.kind === 'success'
                          ? 'rgba(16,185,129,0.1)'
                          : msg.kind === 'error'
                            ? 'rgba(244,63,94,0.1)'
                            : 'rgba(59,130,246,0.1)',
                      color: msg.kind === 'success' ? '#34d399' : msg.kind === 'error' ? '#fb7185' : '#60a5fa',
                      fontSize: 13,
                    }}
                  >
                    {msg.text}
                  </div>
                )}
                <button type="submit" className="btn-primary" disabled={submitting} style={{ justifyContent: 'center' }}>
                  {submitting ? 'Transferring...' : 'Complete Transfer'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </ProtectedPage>
  );
}
