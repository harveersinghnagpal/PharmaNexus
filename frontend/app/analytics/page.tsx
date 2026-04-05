'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertCircle, BarChart2, ShieldCheck, TrendingUp, Trophy } from 'lucide-react';
import ProtectedPage from '@/components/ProtectedPage';
import { useAuth } from '@/context/AuthContext';
import { analyticsApi } from '@/services/api';
import { CAPABILITIES, ROLE_LABELS } from '@/lib/permissions';

const COLORS = ['#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#8b5cf6', '#f43f5e', '#14b8a6', '#ec4899'];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-card" style={{ padding: '12px 16px' }}>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>{label}</p>
      {payload.map((item: any, index: number) => (
        <p key={index} style={{ fontSize: 13, fontWeight: 600, color: item.color }}>
          {item.name}:{' '}
          {typeof item.value === 'number' && (item.name?.toLowerCase().includes('revenue') || item.name?.toLowerCase().includes('value'))
            ? `Rs. ${item.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
            : item.value}
        </p>
      ))}
    </div>
  );
};

export default function AnalyticsPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [days, setDays] = useState(30);
  const [kpis, setKpis] = useState<any>(null);
  const [salesData, setSalesData] = useState<any[]>([]);
  const [topProducts, setTopProducts] = useState<any[]>([]);
  const [marginData, setMarginData] = useState<any[]>([]);
  const [expiryLoss, setExpiryLoss] = useState<any[]>([]);
  const [storePerformance, setStorePerformance] = useState<any[]>([]);
  const [categoryInsights, setCategoryInsights] = useState<any[]>([]);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [isLoading, router, user]);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;
    const requests = [
      { key: 'kpis', label: 'KPIs', request: analyticsApi.getKPIs(user.store_id ?? undefined) },
      { key: 'sales', label: 'Revenue trend', request: analyticsApi.getSalesTrend(days, user.store_id ?? undefined) },
      { key: 'topProducts', label: 'Top products', request: analyticsApi.getTopProducts(days, user.store_id ?? undefined) },
      { key: 'margin', label: 'Margin tracking', request: analyticsApi.getMargin(days, user.store_id ?? undefined) },
      { key: 'expiry', label: 'Expiry loss', request: analyticsApi.getExpiryLoss(user.store_id ?? undefined) },
      { key: 'performance', label: 'Store performance', request: analyticsApi.getStorePerformance(days) },
      { key: 'categories', label: 'Category insights', request: analyticsApi.getCategoryInsights(days, user.store_id ?? undefined) },
    ] as const;

    Promise.allSettled(requests.map((item) => item.request))
      .then((results) => {
        if (!isMounted) return;

        const failures: string[] = [];
        results.forEach((result, index) => {
          const request = requests[index];
          if (result.status === 'fulfilled') {
            const data = result.value.data;
            if (request.key === 'kpis') setKpis(data);
            if (request.key === 'sales') setSalesData(data);
            if (request.key === 'topProducts') setTopProducts(data);
            if (request.key === 'margin') setMarginData(data);
            if (request.key === 'expiry') setExpiryLoss(data);
            if (request.key === 'performance') setStorePerformance(data);
            if (request.key === 'categories') setCategoryInsights(data);
            return;
          }

          console.error(`Analytics request failed: ${request.label}`, result.reason);
          failures.push(request.label);
        });

        setLoadErrors(failures);
      })
      .catch((error) => {
        if (!isMounted) return;
        console.error('Analytics workspace load failed', error);
        setLoadErrors(['Analytics workspace']);
      });

    return () => {
      isMounted = false;
    };
  }, [days, user]);

  if (isLoading || !user) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'var(--bg-primary)' }}>
        <div className="spinner" style={{ width: 40, height: 40 }} />
      </div>
    );
  }

  const totalRevenue = salesData.reduce((sum, item) => sum + (item.revenue || 0), 0);
  const totalExpiryLoss = expiryLoss.reduce((sum, item) => sum + item.estimated_loss, 0);
  const benchmarkLabel = user.store_id ? 'Branch benchmark' : 'Network benchmark';
  const bestStore = storePerformance[0];
  const topCategory = categoryInsights[0];

  return (
    <ProtectedPage capability={CAPABILITIES.ANALYTICS_VIEW}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Analytics Workspace</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              BI reporting for {ROLE_LABELS[user.role] || user.role} across sales, branch performance, and compliance-sensitive categories.
            </p>
          </div>
          <select className="pharma-select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
          </select>
        </div>

        {loadErrors.length > 0 && (
          <div className="glass-card" style={{ padding: '14px 16px', marginBottom: 20, border: '1px solid rgba(244, 63, 94, 0.35)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#fda4af', fontSize: 13, fontWeight: 600 }}>
              <AlertCircle size={16} />
              Some analytics sections could not be loaded.
            </div>
            <p style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: 12 }}>
              Unavailable sections: {loadErrors.join(', ')}.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4" style={{ marginBottom: 22 }}>
          {[
            { label: 'Revenue', value: `Rs. ${(kpis?.monthly_revenue || totalRevenue).toLocaleString('en-IN')}`, icon: TrendingUp, color: '#3b82f6' },
            { label: 'Orders', value: kpis?.monthly_orders || 0, icon: BarChart2, color: '#10b981' },
            { label: 'Avg Order Value', value: `Rs. ${(kpis?.avg_order_value || 0).toLocaleString('en-IN')}`, icon: Trophy, color: '#8b5cf6' },
            { label: 'Regulated Revenue', value: `Rs. ${(kpis?.regulated_revenue || 0).toLocaleString('en-IN')}`, icon: ShieldCheck, color: '#f59e0b' },
            { label: 'Expiry Loss', value: `Rs. ${totalExpiryLoss.toLocaleString('en-IN')}`, icon: AlertCircle, color: '#f43f5e' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="glass-card" style={{ padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ background: `${color}20`, borderRadius: 10, padding: 8 }}>
                  <Icon size={18} color={color} />
                </div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{value}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.5fr,1fr] gap-5" style={{ marginBottom: 20 }}>
          <div className="chart-container">
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Revenue Trend</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>Daily sales velocity and order volume over the selected window.</p>
            {salesData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={salesData}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,45,74,0.5)" />
                  <XAxis dataKey="date" tick={{ fill: '#4b5e7a', fontSize: 10 }} tickFormatter={(date) => new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} />
                  <YAxis tick={{ fill: '#4b5e7a', fontSize: 10 }} tickFormatter={(value) => `Rs. ${(value / 1000).toFixed(0)}K`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#3b82f6" strokeWidth={2} fill="url(#rev)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>No data</div>
            )}
          </div>

          <div className="chart-container">
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{benchmarkLabel}</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
              {user.store_id ? 'How your branch compares against the available store set.' : 'Top branches by revenue and operating pressure.'}
            </p>
            {storePerformance.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {storePerformance.slice(0, 5).map((store: any, index: number) => (
                  <div key={store.store_id} className="glass-card" style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{index + 1}. {store.store_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{store.region}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: '#60a5fa' }}>Rs. {store.revenue.toLocaleString('en-IN')}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{store.orders} orders</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
                      <span>AOV: Rs. {store.avg_order_value}</span>
                      <span>Margin: {store.margin_percent}%</span>
                      <span>Low stock: {store.low_stock_count}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>No benchmark data</div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5" style={{ marginBottom: 20 }}>
          <div className="chart-container">
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Branch Performance</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>Revenue comparison across branches in the current reporting window.</p>
            {storePerformance.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={storePerformance.slice(0, 8)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,45,74,0.5)" />
                  <XAxis dataKey="store_name" tick={{ fill: '#4b5e7a', fontSize: 10 }} tickFormatter={(name) => String(name).split(' ')[0]} />
                  <YAxis tick={{ fill: '#4b5e7a', fontSize: 10 }} tickFormatter={(value) => `Rs. ${(value / 1000).toFixed(0)}K`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="revenue" name="Revenue" radius={[4, 4, 0, 0]}>
                    {storePerformance.map((_: any, index: number) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>No store performance data</div>
            )}
          </div>

          <div className="chart-container">
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Compliance-sensitive Mix</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>Category-level view of prescription, controlled, and approval-sensitive sales.</p>
            {categoryInsights.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={categoryInsights.slice(0, 6)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,45,74,0.5)" />
                  <XAxis type="number" tick={{ fill: '#4b5e7a', fontSize: 10 }} />
                  <YAxis dataKey="category" type="category" tick={{ fill: '#94a3b8', fontSize: 11 }} width={100} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="rx_units" stackId="a" name="Rx Units" fill="#3b82f6" />
                  <Bar dataKey="controlled_units" stackId="a" name="Controlled Units" fill="#f59e0b" />
                  <Bar dataKey="approval_units" stackId="a" name="Approval Units" fill="#f43f5e" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>No compliance category data</div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div className="chart-container">
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Top Products</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>Best revenue contributors in the selected period.</p>
            {topProducts.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={topProducts.slice(0, 8)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,45,74,0.5)" />
                  <XAxis dataKey="name" tick={{ fill: '#4b5e7a', fontSize: 9 }} tickFormatter={(name) => String(name).split(' ')[0]} />
                  <YAxis tick={{ fill: '#4b5e7a', fontSize: 10 }} tickFormatter={(value) => `Rs. ${(value / 1000).toFixed(0)}K`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="total_revenue" name="Revenue" radius={[4, 4, 0, 0]}>
                    {topProducts.map((_: any, index: number) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>No product data</div>
            )}
          </div>

          <div className="chart-container">
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Expiry Loss by Category</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>Estimated write-offs from expired batches still on hand.</p>
            {expiryLoss.length > 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                <ResponsiveContainer width="58%" height={240}>
                  <PieChart>
                    <Pie data={expiryLoss} dataKey="estimated_loss" nameKey="category" cx="50%" cy="50%" outerRadius={90} innerRadius={50} paddingAngle={3}>
                      {expiryLoss.map((_: any, index: number) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => `Rs. ${Number(value).toFixed(2)}`} contentStyle={{ background: '#111827', border: '1px solid #1e2d4a', borderRadius: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ flex: 1 }}>
                  {expiryLoss.map((item: any, index: number) => (
                    <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS[index % COLORS.length] }} />
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.category}</span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#fb7185' }}>Rs. {item.estimated_loss.toFixed(0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ height: 240, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                <AlertCircle size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
                <p style={{ fontSize: 14 }}>No expired batches</p>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5" style={{ marginTop: 20 }}>
          <div className="glass-card" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Category Snapshot</h3>
            {topCategory ? (
              <>
                <div style={{ fontSize: 18, fontWeight: 800 }}>{topCategory.category}</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 6 }}>
                  Revenue leader with Rs. {topCategory.revenue.toLocaleString('en-IN')} and {topCategory.units_sold} units sold.
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 14, fontSize: 12, color: 'var(--text-muted)' }}>
                  <span>Margin: {topCategory.margin_percent}%</span>
                  <span>Rx: {topCategory.rx_units}</span>
                  <span>Controlled: {topCategory.controlled_units}</span>
                  <span>Approval: {topCategory.approval_units}</span>
                </div>
              </>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No category snapshot data yet.</p>
            )}
          </div>

          <div className="glass-card" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Top Branch Snapshot</h3>
            {bestStore ? (
              <>
                <div style={{ fontSize: 18, fontWeight: 800 }}>{bestStore.store_name}</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 6 }}>
                  {bestStore.region} led this period with Rs. {bestStore.revenue.toLocaleString('en-IN')} across {bestStore.orders} orders.
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 14, fontSize: 12, color: 'var(--text-muted)' }}>
                  <span>AOV: Rs. {bestStore.avg_order_value}</span>
                  <span>Margin: {bestStore.margin_percent}%</span>
                  <span>Low stock count: {bestStore.low_stock_count}</span>
                </div>
              </>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No branch snapshot data yet.</p>
            )}
          </div>
        </div>
      </div>
    </ProtectedPage>
  );
}
