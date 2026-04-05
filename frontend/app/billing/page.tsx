'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Printer, Receipt, RefreshCw, Search, ShoppingCart, Trash2, WifiOff } from 'lucide-react';
import ProtectedPage from '@/components/ProtectedPage';
import { useAuth } from '@/context/AuthContext';
import { billingApi, inventoryApi } from '@/services/api';
import { CAPABILITIES } from '@/lib/permissions';
import { offlineQueue, type SaleCreatePayload } from '@/lib/offlineQueue';
import { useOfflineSync } from '@/hooks/useOfflineSync';

interface CartItem {
  medicine_id: number;
  batch_id: number;
  medicine_name: string;
  batch_number: string;
  quantity: number;
  price: number;
  available_qty: number;
}

interface StatusMessage {
  kind: 'success' | 'error' | 'info';
  text: string;
}

interface InvoiceDisplayItem {
  batch_id: number;
  batch_number: string;
  medicine_name: string;
  quantity: number;
  price: number;
}

interface InvoiceState {
  id: number | string;
  total_amount: number;
  displayItems: InvoiceDisplayItem[];
  pendingSync?: boolean;
  created_at?: string;
  prescription_number?: string;
  payment_method?: string;
  discount_amount?: number;
  store_id?: number;
}

export default function BillingPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [medicines, setMedicines] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [selectedMed, setSelectedMed] = useState<any>(null);
  const [batches, setBatches] = useState<any[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedStore, setSelectedStore] = useState('');
  const [prescriptionNumber, setPrescriptionNumber] = useState('');
  const [qty, setQty] = useState(1);
  const [selectedBatch, setSelectedBatch] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceState | null>(null);
  const [recentSales, setRecentSales] = useState<any[]>([]);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  const { isOnline, isSyncing, queueSize, lastSyncResult, syncNow, refreshQueueSize } = useOfflineSync();
  const isStoreScoped = Boolean(user?.store_id);
  const availableStores = isStoreScoped ? stores.filter((store: any) => store.id === user?.store_id) : stores;
  const selectedStoreRecord = stores.find((store: any) => String(store.id) === selectedStore);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, router, user]);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      inventoryApi.getMedicines(),
      inventoryApi.getStores(),
      billingApi.listSales(user.store_id ?? undefined),
    ]).then(([medicinesRes, storesRes, salesRes]) => {
      setMedicines(medicinesRes.data);
      setStores(storesRes.data);
      setRecentSales(salesRes.data.slice(0, 5));
      const defaultStore = user.store_id ?? storesRes.data[0]?.id;
      if (defaultStore) setSelectedStore(String(defaultStore));
    });
  }, [user]);

  useEffect(() => {
    if (!lastSyncResult) return;
    if (lastSyncResult.applied > 0 || lastSyncResult.duplicates > 0 || lastSyncResult.conflicts > 0) {
      setStatusMessage({
        kind: lastSyncResult.failed > 0 ? 'info' : 'success',
        text: `Offline sync updated ${lastSyncResult.applied} event(s), ignored ${lastSyncResult.duplicates} duplicate(s), and resolved ${lastSyncResult.conflicts} conflict(s).`,
      });
      if (user) {
        void billingApi.listSales(user.store_id ?? undefined).then((salesRes) => {
          setRecentSales(salesRes.data.slice(0, 5));
        });
      }
    } else if (lastSyncResult.failed > 0) {
      setStatusMessage({ kind: 'error', text: `Sync could not upload ${lastSyncResult.failed} queued event(s).` });
    }
  }, [lastSyncResult, user]);

  const filteredMeds = medicines.filter((medicine) => medicine.name.toLowerCase().includes(search.toLowerCase()));

  const selectMedicine = async (medicine: any) => {
    setSelectedMed(medicine);
    setSelectedBatch(null);
    try {
      const res = await inventoryApi.getBatches(selectedStore ? Number(selectedStore) : undefined, medicine.id);
      setBatches(res.data.filter((batch: any) => batch.quantity > 0));
    } catch {
      setBatches([]);
    }
  };

  const addToCart = () => {
    if (!selectedMed || !selectedBatch) return;

    const existing = cart.find((item) => item.batch_id === selectedBatch.id);
    if (existing) {
      setCart(
        cart.map((item) =>
          item.batch_id === selectedBatch.id
            ? { ...item, quantity: Math.min(item.quantity + qty, item.available_qty) }
            : item
        )
      );
    } else {
      setCart([
        ...cart,
        {
          medicine_id: selectedMed.id,
          batch_id: selectedBatch.id,
          medicine_name: selectedMed.name,
          batch_number: selectedBatch.batch_number,
          quantity: qty,
          price: Number(selectedMed.price),
          available_qty: selectedBatch.quantity,
        },
      ]);
    }

    setSelectedMed(null);
    setSelectedBatch(null);
    setSearch('');
    setBatches([]);
    setQty(1);
  };

  const removeFromCart = (batchId: number) => setCart(cart.filter((item) => item.batch_id !== batchId));
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const buildSalePayload = (): SaleCreatePayload => ({
    store_id: Number(selectedStore),
    prescription_number: prescriptionNumber || undefined,
    payment_method: 'cash',
    discount_amount: 0,
    items: cart.map((item) => ({
      medicine_id: item.medicine_id,
      batch_id: item.batch_id,
      quantity: item.quantity,
      price: item.price,
    })),
  });

  const queueCurrentSale = async () => {
    await offlineQueue.queueSaleCreate(buildSalePayload());
    await refreshQueueSize();
    setInvoice({
      id: `offline-${Date.now()}`,
      total_amount: total,
      displayItems: cart,
      pendingSync: true,
      created_at: new Date().toISOString(),
      prescription_number: prescriptionNumber || undefined,
      payment_method: 'cash',
      discount_amount: 0,
      store_id: Number(selectedStore),
    });
    setCart([]);
    setPrescriptionNumber('');
    setStatusMessage({
      kind: 'info',
      text: 'Sale saved offline. It will sync automatically when this device reconnects.',
    });
  };

  const checkout = async () => {
    if (!cart.length || !selectedStore) return;
    setSubmitting(true);
    setStatusMessage(null);
    try {
      if (!navigator.onLine) {
        await queueCurrentSale();
        return;
      }

      const res = await billingApi.createSale(buildSalePayload());
      setInvoice({
        ...res.data,
        total_amount: Number(res.data.total_amount),
        discount_amount: Number(res.data.discount_amount || 0),
        displayItems: cart,
        store_id: Number(res.data.store_id ?? selectedStore),
      });
      setCart([]);
      setPrescriptionNumber('');
      setStatusMessage({ kind: 'success', text: 'Invoice generated and stock updated successfully.' });
      if (user) {
        const salesRes = await billingApi.listSales(user.store_id ?? undefined);
        setRecentSales(salesRes.data.slice(0, 5));
      }
    } catch (err: any) {
      if (!err.response) {
        await queueCurrentSale();
        return;
      }

      const errorMsg = err.response?.data?.detail;
      setStatusMessage({
        kind: 'error',
        text: typeof errorMsg === 'object' && errorMsg !== null ? errorMsg.message || JSON.stringify(errorMsg) : errorMsg || 'Checkout failed',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const printInvoice = () => {
    if (!invoice) return;

    const invoiceDate = invoice.created_at ? new Date(invoice.created_at) : new Date();
    const storeLabel = selectedStoreRecord?.name || `Store #${invoice.store_id ?? selectedStore}`;
    const storeLocation = selectedStoreRecord?.location || 'Branch billing receipt';
    const subtotal = invoice.displayItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const lineItems = invoice.displayItems.map((item) => `
      <tr>
        <td>${item.medicine_name}</td>
        <td>${item.batch_number}</td>
        <td class="num">${item.quantity}</td>
        <td class="num">Rs. ${item.price.toFixed(2)}</td>
        <td class="num">Rs. ${(item.price * item.quantity).toFixed(2)}</td>
      </tr>
    `).join('');

    const receiptHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Invoice ${invoice.id}</title>
    <style>
      body { font-family: Arial, sans-serif; color: #111827; margin: 0; padding: 24px; }
      .receipt { max-width: 820px; margin: 0 auto; }
      .header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #111827; padding-bottom: 16px; margin-bottom: 20px; }
      .brand h1 { margin: 0; font-size: 26px; }
      .brand p, .meta p, .note { margin: 4px 0; font-size: 13px; line-height: 1.5; }
      .section-title { margin: 24px 0 10px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #4b5563; }
      table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      th, td { border-bottom: 1px solid #d1d5db; padding: 10px 8px; text-align: left; font-size: 13px; vertical-align: top; }
      th { font-size: 12px; text-transform: uppercase; color: #4b5563; }
      .num { text-align: right; white-space: nowrap; }
      .summary { margin-top: 18px; margin-left: auto; width: 320px; }
      .summary-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
      .summary-row.total { border-top: 2px solid #111827; margin-top: 8px; padding-top: 10px; font-size: 18px; font-weight: 700; }
      .pill { display: inline-block; border: 1px solid #d1d5db; border-radius: 999px; padding: 4px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
      .footer { margin-top: 32px; border-top: 1px dashed #9ca3af; padding-top: 14px; color: #4b5563; font-size: 12px; }
      @media print { body { padding: 0; } .receipt { max-width: none; } }
    </style>
  </head>
  <body>
    <div class="receipt">
      <div class="header">
        <div class="brand">
          <h1>PharmaNexus</h1>
          <p>Enterprise Pharmacy Operations Platform</p>
          <p>${storeLabel}</p>
          <p>${storeLocation}</p>
        </div>
        <div class="meta">
          <p><strong>Invoice:</strong> ${invoice.pendingSync ? 'Offline Draft' : `Sale #${invoice.id}`}</p>
          <p><strong>Date:</strong> ${invoiceDate.toLocaleDateString('en-IN')} ${invoiceDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
          <p><strong>Cashier:</strong> ${user.name}</p>
          <p><strong>Payment:</strong> ${(invoice.payment_method || 'cash').toUpperCase()}</p>
          <p><strong>Status:</strong> <span class="pill">${invoice.pendingSync ? 'Pending Sync' : 'Completed'}</span></p>
        </div>
      </div>

      <div class="section-title">Sale Details</div>
      <p class="note"><strong>Prescription Ref:</strong> ${invoice.prescription_number || 'Not linked'}</p>
      <p class="note"><strong>Store Scope:</strong> ${storeLabel}</p>

      <table>
        <thead>
          <tr>
            <th>Medicine</th>
            <th>Batch</th>
            <th class="num">Qty</th>
            <th class="num">Unit Price</th>
            <th class="num">Line Total</th>
          </tr>
        </thead>
        <tbody>
          ${lineItems}
        </tbody>
      </table>

      <div class="summary">
        <div class="summary-row">
          <span>Subtotal</span>
          <span>Rs. ${subtotal.toFixed(2)}</span>
        </div>
        <div class="summary-row">
          <span>Discount</span>
          <span>Rs. ${Number(invoice.discount_amount || 0).toFixed(2)}</span>
        </div>
        <div class="summary-row total">
          <span>Total</span>
          <span>Rs. ${Number(invoice.total_amount).toFixed(2)}</span>
        </div>
      </div>

      ${invoice.pendingSync ? '<p class="note">This invoice was created offline. A permanent sale number will be assigned after the next successful sync.</p>' : ''}

      <div class="footer">
        <p>Thank you for choosing PharmaNexus. Please retain this invoice for billing, returns, and prescription compliance records.</p>
      </div>
    </div>
  </body>
</html>`;

    const printWindow = window.open('', '_blank', 'width=960,height=720');
    if (!printWindow) return;
    printWindow.document.open();
    printWindow.document.write(receiptHtml);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  if (isLoading || !user) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'var(--bg-primary)' }}>
        <div className="spinner" style={{ width: 40, height: 40 }} />
      </div>
    );
  }

  return (
    <ProtectedPage capability={CAPABILITIES.BILLING_VIEW}>
      <div>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Billing POS</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
            Prescription and OTC billing with automatic stock deduction.
          </p>
        </div>

        <div className="glass-card" style={{ padding: '14px 16px', marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {isOnline ? <RefreshCw size={16} color="var(--accent-blue)" /> : <WifiOff size={16} color="#f59e0b" />}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>
                  {isOnline ? 'Connection available' : 'Offline billing mode'}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                  {queueSize > 0 ? `${queueSize} event(s) waiting to sync.` : 'No pending billing actions in queue.'}
                </div>
              </div>
            </div>
            <button onClick={() => void syncNow()} className="btn-secondary" disabled={!isOnline || isSyncing || queueSize === 0}>
              <RefreshCw size={14} />
              {isSyncing ? 'Syncing...' : 'Sync now'}
            </button>
          </div>
        </div>

        {isStoreScoped && (
          <div className="glass-card" style={{ padding: '14px 16px', marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Branch billing mode</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              This billing session is locked to Store #{user?.store_id} for cleaner branch operations.
            </div>
          </div>
        )}

        {statusMessage && (
          <div
            className="glass-card"
            style={{
              padding: '14px 16px',
              marginBottom: 18,
              borderColor:
                statusMessage.kind === 'success'
                  ? 'rgba(16,185,129,0.35)'
                  : statusMessage.kind === 'error'
                    ? 'rgba(244,63,94,0.35)'
                    : 'rgba(59,130,246,0.35)',
            }}
          >
            <div
              style={{
                color:
                  statusMessage.kind === 'success'
                    ? '#34d399'
                    : statusMessage.kind === 'error'
                      ? '#fb7185'
                      : '#60a5fa',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {statusMessage.text}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          <div className="lg:col-span-3">
            <div className="glass-card" style={{ padding: 20, marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Store
                </label>
                <select className="pharma-input" value={selectedStore} onChange={(e) => setSelectedStore(e.target.value)} disabled={isStoreScoped}>
                  {availableStores.map((store: any) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Prescription No. (optional)
                </label>
                <input className="pharma-input" placeholder="RX-2024-001" value={prescriptionNumber} onChange={(e) => setPrescriptionNumber(e.target.value)} />
              </div>
            </div>

            <div className="glass-card" style={{ padding: 20, marginBottom: 16 }}>
              <div style={{ position: 'relative', marginBottom: 12 }}>
                <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
                <input className="pharma-input" placeholder="Search medicine..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 40 }} />
              </div>

              {search && filteredMeds.length > 0 && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', maxHeight: 200, overflowY: 'auto' }}>
                  {filteredMeds.slice(0, 8).map((medicine: any) => (
                    <button
                      key={medicine.id}
                      onClick={() => {
                        setSearch(medicine.name);
                        void selectMedicine(medicine);
                      }}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        width: '100%',
                        padding: '10px 16px',
                        background: selectedMed?.id === medicine.id ? 'rgba(59,130,246,0.1)' : 'var(--bg-secondary)',
                        borderBottom: '1px solid var(--border)',
                        cursor: 'pointer',
                        border: 'none',
                        color: 'var(--text-primary)',
                        textAlign: 'left',
                      }}
                    >
                      <div>
                        <span style={{ fontSize: 14, fontWeight: 500 }}>{medicine.name}</span>
                        {medicine.is_prescription_required && (
                          <span className="badge badge-rose" style={{ marginLeft: 8, fontSize: 10 }}>
                            Rx
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#34d399' }}>Rs. {medicine.price}</span>
                    </button>
                  ))}
                </div>
              )}

              {selectedMed && (
                <div style={{ marginTop: 16 }}>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10, fontWeight: 600 }}>
                    Select batch for <strong style={{ color: 'var(--text-primary)' }}>{selectedMed.name}</strong>
                  </p>
                  {batches.length === 0 ? (
                    <p style={{ color: 'var(--accent-rose)', fontSize: 13 }}>No available batches in this store.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {batches.map((batch: any) => (
                        <button
                          key={batch.id}
                          onClick={() => setSelectedBatch(batch)}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            padding: '10px 14px',
                            borderRadius: 10,
                            border: `1px solid ${selectedBatch?.id === batch.id ? 'var(--accent-blue)' : 'var(--border)'}`,
                            background: selectedBatch?.id === batch.id ? 'rgba(59,130,246,0.1)' : 'var(--bg-secondary)',
                            cursor: 'pointer',
                            color: 'var(--text-primary)',
                          }}
                        >
                          <span style={{ fontSize: 13 }}>
                            {batch.batch_number} - Exp: {batch.expiry_date}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#34d399' }}>{batch.quantity} units</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {selectedBatch && (
                    <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
                      <div>
                        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Qty</label>
                        <input
                          type="number"
                          className="pharma-input"
                          min={1}
                          max={selectedBatch.quantity}
                          value={qty}
                          onChange={(e) => setQty(Number(e.target.value))}
                          style={{ width: 80 }}
                        />
                      </div>
                      <button onClick={addToCart} className="btn-primary" style={{ marginTop: 18 }}>
                        <Plus size={16} />
                        Add to Cart
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="glass-card" style={{ padding: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Recent Transactions</h3>
              {recentSales.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No recent sales</p>
              ) : (
                recentSales.map((sale: any) => (
                  <div
                    key={sale.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 0',
                      borderBottom: '1px solid rgba(30,45,74,0.5)',
                    }}
                  >
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>Sale #{sale.id}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>{sale.items?.length || 0} items</span>
                    </div>
                    <span style={{ fontWeight: 700, color: '#34d399' }}>Rs. {Number(sale.total_amount).toLocaleString('en-IN')}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="glass-card" style={{ padding: 24, position: 'sticky', top: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                <ShoppingCart size={20} color="var(--accent-blue)" />
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>Cart</h3>
                {cart.length > 0 && <span className="badge badge-blue">{cart.length}</span>}
              </div>

              {cart.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                  <ShoppingCart size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
                  <p style={{ fontSize: 14 }}>Cart is empty</p>
                  <p style={{ fontSize: 12, marginTop: 4 }}>Search and add medicines</p>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20, maxHeight: 320, overflowY: 'auto' }}>
                    {cart.map((item) => (
                      <div
                        key={item.batch_id}
                        style={{
                          padding: '12px 14px',
                          borderRadius: 10,
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: 13, fontWeight: 600 }}>{item.medicine_name}</p>
                          <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Batch: {item.batch_number}</p>
                          <p style={{ fontSize: 12, color: '#60a5fa', marginTop: 4 }}>
                            {item.quantity} x Rs. {item.price} = <strong>Rs. {(item.quantity * item.price).toFixed(2)}</strong>
                          </p>
                        </div>
                        <button onClick={() => removeFromCart(item.batch_id)} className="btn-danger" style={{ padding: '4px 8px', marginLeft: 8 }}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Subtotal</span>
                      <span style={{ fontSize: 14 }}>Rs. {total.toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 18, fontWeight: 800 }}>Total</span>
                      <span style={{ fontSize: 22, fontWeight: 800, color: '#34d399' }}>Rs. {total.toFixed(2)}</span>
                    </div>
                  </div>

                  <button onClick={checkout} className="btn-primary" disabled={submitting} style={{ width: '100%', justifyContent: 'center', padding: 14 }}>
                    <Receipt size={16} />
                    {submitting ? 'Processing...' : 'Generate Invoice'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {invoice && (
          <div className="modal-overlay">
            <div className="modal-box" style={{ maxWidth: 480 }}>
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    background: 'rgba(16,185,129,0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 12px',
                  }}
                >
                  <Receipt size={28} color="#34d399" />
                </div>
                <h3 style={{ fontSize: 20, fontWeight: 700 }}>Invoice Generated</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
                  {invoice.pendingSync ? 'Offline receipt queued for sync' : `Sale #${invoice.id}`}
                </p>
              </div>

              <div className="glass-card" style={{ padding: 16, marginBottom: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14, fontSize: 12 }}>
                  <div>
                    <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Store</div>
                    <div style={{ fontWeight: 600 }}>{selectedStoreRecord?.name || `Store #${invoice.store_id ?? selectedStore}`}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Payment</div>
                    <div style={{ fontWeight: 600 }}>{(invoice.payment_method || 'cash').toUpperCase()}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Prescription Ref</div>
                    <div style={{ fontWeight: 600 }}>{invoice.prescription_number || 'Not linked'}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Cashier</div>
                    <div style={{ fontWeight: 600 }}>{user.name}</div>
                  </div>
                </div>

                {invoice.displayItems?.map((item: any) => (
                  <div key={item.batch_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(30,45,74,0.3)' }}>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 500, display: 'block' }}>{item.medicine_name}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Batch: {item.batch_number} x {item.quantity}
                      </span>
                    </div>
                    <span style={{ fontWeight: 600 }}>Rs. {(item.price * item.quantity).toFixed(2)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 12, marginTop: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 16 }}>Total</span>
                  <span style={{ fontWeight: 800, fontSize: 18, color: '#34d399' }}>Rs. {Number(invoice.total_amount).toFixed(2)}</span>
                </div>
              </div>

              {invoice.pendingSync && (
                <div style={{ marginBottom: 16, color: '#60a5fa', fontSize: 13 }}>
                  This receipt was created offline and will receive a server sale number after the next successful sync.
                </div>
              )}

              <div style={{ display: 'flex', gap: 12 }}>
                <button onClick={() => setInvoice(null)} className="btn-secondary" style={{ flex: 1, justifyContent: 'center', display: 'flex' }}>
                  Close
                </button>
                <button onClick={printInvoice} className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                  <Printer size={14} />
                  Print
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ProtectedPage>
  );
}
