'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, Clock, Package, ShoppingCart, TrendingUp } from 'lucide-react';
import ProtectedPage from '@/components/ProtectedPage';
import { useAuth } from '@/context/AuthContext';
import { analyticsApi, inventoryApi } from '@/services/api';
import { CAPABILITIES, hasCapability, ROLE_LABELS } from '@/lib/permissions';

const quickActions = [
  {
    label: 'Add Stock',
    href: '/inventory',
    color: '#3b82f6',
    desc: 'Add new batch',
    capability: CAPABILITIES.INVENTORY_ADD_BATCH,
  },
  {
    label: 'Create Sale',
    href: '/billing',
    color: '#10b981',
    desc: 'Open billing POS',
    capability: CAPABILITIES.BILLING_VIEW,
  },
  {
    label: 'View Reports',
    href: '/analytics',
    color: '#8b5cf6',
    desc: 'Branch performance',
    capability: CAPABILITIES.ANALYTICS_VIEW,
  },
  {
    label: 'AI Insights',
    href: '/ai',
    color: '#f59e0b',
    desc: 'Forecast and anomalies',
    capability: CAPABILITIES.AI_VIEW,
  },
];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-card" style={{ padding: '12px 16px', minWidth: 150 }}>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>{label}</p>
      <p style={{ fontSize: 16, fontWeight: 700, color: '#60a5fa' }}>
        Rs. {Number(payload[0]?.value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
      </p>
    </div>
  );
};

export default function DashboardPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [kpis, setKpis] = useState<any>(null);
  const [salesData, setSalesData] = useState<any[]>([]);
  const [lowStock, setLowStock] = useState<any[]>([]);
  const [expiryAlerts, setExpiryAlerts] = useState<any[]>([]);

  const canSeeMetrics = hasCapability(user?.role, CAPABILITIES.DASHBOARD_KPIS_VIEW);
  const canSeeAlerts = hasCapability(user?.role, CAPABILITIES.DASHBOARD_ALERTS_VIEW);
  const canOpenInventory = hasCapability(user?.role, CAPABILITIES.INVENTORY_VIEW);
  const roleLabel = ROLE_LABELS[user?.role || ''] || 'Team Member';
  const roleSummary =
    user?.role === 'sales_staff'
      ? 'Focus on fast checkout, prescription intake, and the branch alerts that affect today’s counter sales.'
      : user?.role === 'inventory_supervisor'
        ? 'Keep the branch shelf-ready with batch visibility, low-stock action, and expiry awareness.'
        : user?.role === 'store_manager'
          ? 'Track branch performance, keep operations flowing, and intervene early on inventory or billing issues.'
          : user?.role === 'regional_admin'
            ? 'Review multi-branch performance, compare operational health, and support store teams proactively.'
            : 'You have full operational visibility across the network, including compliance-sensitive surfaces.';
  const focusPoints =
    user?.role === 'sales_staff'
      ? ['Start billing quickly', 'Capture prescription details', 'Watch low stock before customers are impacted']
      : user?.role === 'inventory_supervisor'
        ? ['Add and track batches', 'Monitor expiry exposure', 'Keep stock levels healthy']
        : ['Monitor branch health', 'Review performance trends', 'Act on operational exceptions'];

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, router, user]);

  useEffect(() => {
    if (!user) return;

    if (canSeeMetrics) {
      Promise.all([analyticsApi.getKPIs(), analyticsApi.getSalesTrend(14)])
        .then(([kpiRes, salesRes]) => {
          setKpis(kpiRes.data);
          setSalesData(salesRes.data.slice(-14));
        })
        .catch(console.error);
    }

    if (canSeeAlerts) {
      Promise.all([inventoryApi.getLowStock(), inventoryApi.getExpiryAlerts()])
        .then(([lowRes, expiryRes]) => {
          setLowStock(lowRes.data.slice(0, 5));
          setExpiryAlerts(expiryRes.data.slice(0, 5));
        })
        .catch(console.error);
    }
  }, [canSeeAlerts, canSeeMetrics, user]);

  if (isLoading || !user) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'var(--bg-primary)' }}>
        <div className="spinner" style={{ width: 40, height: 40 }} />
      </div>
    );
  }

  const kpiCards = [
    {
      label: 'Monthly Revenue',
      value: kpis ? `Rs. ${(kpis.monthly_revenue / 1000).toFixed(1)}K` : '--',
      icon: TrendingUp,
      color: '#3b82f6',
      bg: 'rgba(59,130,246,0.1)',
      glow: 'kpi-blue',
      sub: 'This month',
    },
    {
      label: 'Monthly Orders',
      value: kpis?.monthly_orders ?? '--',
      icon: ShoppingCart,
      color: '#10b981',
      bg: 'rgba(16,185,129,0.1)',
      glow: 'kpi-emerald',
      sub: 'Transactions',
    },
    {
      label: 'Low Stock Alerts',
      value: kpis?.low_stock_alerts ?? '--',
      icon: Package,
      color: '#f59e0b',
      bg: 'rgba(245,158,11,0.1)',
      glow: 'kpi-amber',
      sub: 'Below threshold',
    },
    {
      label: 'Expiry Alerts',
      value: kpis?.expiry_alerts ?? '--',
      icon: Clock,
      color: '#f43f5e',
      bg: 'rgba(244,63,94,0.1)',
      glow: 'kpi-rose',
      sub: 'Within 30 days',
    },
  ];

  return (
    <ProtectedPage capability={CAPABILITIES.DASHBOARD_VIEW}>
      <div className="page-shell">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>
            Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'},{' '}
            {user.name.split(' ')[0]}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            {new Date().toLocaleDateString('en-IN', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>

        <div className="glass-card" style={{ padding: 24, marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ maxWidth: 640 }}>
              <span className="badge badge-blue" style={{ marginBottom: 12 }}>{roleLabel}</span>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Role Workspace</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>{roleSummary}</p>
            </div>
            {user.store_id && (
              <div className="glass-card" style={{ padding: '14px 16px', minWidth: 180 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                  Store Scope
                </div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>Store #{user.store_id}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                  Branch-scoped data and actions
                </div>
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 18 }}>
            {focusPoints.map((item) => (
              <div key={item} style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--bg-secondary)', border: '1px solid var(--border)', fontSize: 13 }}>
                {item}
              </div>
            ))}
          </div>
        </div>

        {canSeeMetrics && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
              {kpiCards.map(({ label, value, icon: Icon, color, bg, glow, sub }) => (
                <div key={label} className={`glass-card ${glow}`} style={{ padding: '20px 24px', position: 'relative', overflow: 'hidden' }}>
                  <div
                    style={{
                      position: 'absolute',
                      right: -20,
                      top: -20,
                      width: 100,
                      height: 100,
                      borderRadius: '50%',
                      background: bg,
                      opacity: 0.5,
                    }}
                  />
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
                    <div style={{ background: bg, borderRadius: 12, padding: 10 }}>
                      <Icon size={20} color={color} />
                    </div>
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 4 }}>{value}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
              <div className="chart-container lg:col-span-2">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 700 }}>Revenue Trend</h3>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Last 14 days</p>
                  </div>
                  <span className="badge badge-blue">Live</span>
                </div>
                {salesData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={salesData}>
                      <defs>
                        <linearGradient id="blueGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,45,74,0.5)" />
                      <XAxis
                        dataKey="date"
                        tick={{ fill: '#4b5e7a', fontSize: 11 }}
                        tickFormatter={(date) => new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      />
                      <YAxis tick={{ fill: '#4b5e7a', fontSize: 11 }} tickFormatter={(value) => `Rs. ${(value / 1000).toFixed(0)}K`} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="revenue"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        fill="url(#blueGrad)"
                        dot={false}
                        activeDot={{ r: 6, fill: '#3b82f6' }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                    No sales data yet
                  </div>
                )}
              </div>

              <div className="glass-card" style={{ padding: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Quick Actions</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {quickActions
                    .filter(({ capability }) => hasCapability(user.role, capability))
                    .map(({ label, href, color, desc }) => (
                      <button
                        key={label}
                        onClick={() => router.push(href)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 14,
                          padding: '14px 16px',
                          borderRadius: 12,
                          background: `${color}10`,
                          border: `1px solid ${color}25`,
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          textAlign: 'left',
                        }}
                      >
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 10,
                            background: `${color}20`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Activity size={16} color={color} />
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{desc}</div>
                        </div>
                      </button>
                    ))}
                </div>
              </div>
            </div>
          </>
        )}

        {!canSeeMetrics && (
          <div className="glass-card" style={{ padding: 24, marginBottom: 24 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>Today&apos;s focus</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6, marginBottom: 18 }}>
              This dashboard is trimmed for your role so the team only sees operational actions and alerts they can actually use.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {quickActions
                .filter(({ capability }) => hasCapability(user.role, capability))
                .map(({ label, href, color, desc }) => (
                  <button
                    key={label}
                    onClick={() => router.push(href)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      padding: '14px 16px',
                      borderRadius: 12,
                      background: `${color}10`,
                      border: `1px solid ${color}25`,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        background: `${color}20`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Activity size={16} color={color} />
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{desc}</div>
                    </div>
                  </button>
                ))}
            </div>
          </div>
        )}

        {canSeeAlerts && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="glass-card" style={{ padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700 }}>Low Stock Alerts</h3>
                {canOpenInventory && (
                  <button
                    onClick={() => router.push('/inventory')}
                    style={{ fontSize: 12, color: 'var(--accent-blue)', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    View all
                  </button>
                )}
              </div>
              {lowStock.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No low stock alerts.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {lowStock.map((item: any) => (
                    <div
                      key={`${item.medicine_id}-${item.store_id}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px 14px',
                        borderRadius: 10,
                        background: 'rgba(245,158,11,0.06)',
                        border: '1px solid rgba(245,158,11,0.15)',
                      }}
                    >
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{item.medicine_name}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>{item.store_name}</span>
                      </div>
                      <span className="badge badge-amber">{item.total_quantity} units</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="glass-card" style={{ padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700 }}>Expiry Alerts</h3>
                {canOpenInventory && (
                  <button
                    onClick={() => router.push('/inventory')}
                    style={{ fontSize: 12, color: 'var(--accent-blue)', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    View all
                  </button>
                )}
              </div>
              {expiryAlerts.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No expiry alerts.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {expiryAlerts.map((item: any) => (
                    <div
                      key={item.batch_id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px 14px',
                        borderRadius: 10,
                        background: item.days_to_expiry < 0 ? 'rgba(244,63,94,0.06)' : 'rgba(245,158,11,0.06)',
                        border: `1px solid ${item.days_to_expiry < 0 ? 'rgba(244,63,94,0.2)' : 'rgba(245,158,11,0.15)'}`,
                      }}
                    >
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{item.medicine_name}</span>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Batch: {item.batch_number}</div>
                      </div>
                      <span className={`badge ${item.days_to_expiry < 0 ? 'badge-rose' : 'badge-amber'}`}>
                        {item.days_to_expiry < 0 ? 'Expired' : `${item.days_to_expiry}d left`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </ProtectedPage>
  );
}
