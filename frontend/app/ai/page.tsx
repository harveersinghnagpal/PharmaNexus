'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import ProtectedPage from '@/components/ProtectedPage';
import { CAPABILITIES } from '@/lib/permissions';
import { aiApi, inventoryApi } from '@/services/api';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine
} from 'recharts';
import { Brain, TrendingUp, AlertTriangle, MessageSquare, Send, Loader2, Bot } from 'lucide-react';

type AiTab = 'forecast' | 'anomaly' | 'chat';

interface ChatMsg {
  role: 'user' | 'ai';
  content: string;
  type?: string;
}

export default function AIPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<AiTab>('forecast');
  const [medicines, setMedicines] = useState<any[]>([]);
  const [selectedMed, setSelectedMed] = useState('');
  const [daysAhead, setDaysAhead] = useState(7);
  const [forecastData, setForecastData] = useState<any>(null);
  const [anomalyData, setAnomalyData] = useState<any>(null);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([
    { role: 'ai', content: "Hi! I'm PharmaNexus AI 🤖 I can help you with inventory status, sales insights, expiry alerts, and demand forecasts. What would you like to know?", type: 'general' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!isLoading && !user) router.push('/login'); }, [user, isLoading, router]);

  useEffect(() => {
    if (!user) return;
    inventoryApi.getMedicines().then(r => {
      setMedicines(r.data);
      if (r.data[0]) setSelectedMed(String(r.data[0].id));
    });
    // Load anomaly data by default
    aiApi.detectAnomalies().then(r => setAnomalyData(r.data)).catch(() => {});
  }, [user]);

  const runForecast = async () => {
    if (!selectedMed) return;
    setLoading(true);
    try {
      const res = await aiApi.forecast(Number(selectedMed), undefined, daysAhead);
      setForecastData(res.data);
    } catch (err: any) {
      alert('Forecast failed: ' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  };

  const sendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const msg = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: msg }]);
    setLoading(true);
    try {
      const res = await aiApi.chat(msg);
      setChatMessages(prev => [...prev, { role: 'ai', content: res.data.response, type: res.data.type }]);
    } catch {
      setChatMessages(prev => [...prev, { role: 'ai', content: 'Sorry, I encountered an error. Please try again.', type: 'error' }]);
    } finally {
      setLoading(false);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  };

  // Combine historical + forecast for chart
  const chartData = forecastData ? [
    ...(forecastData.historical?.slice(-14) || []).map((d: any) => ({ date: d.date, historical: d.qty, type: 'actual' })),
    ...(forecastData.forecast || []).map((d: any) => ({ date: d.date, forecast: d.predicted_qty, lower: d.lower_bound, upper: d.upper_bound, type: 'forecast' })),
  ] : [];

  const selectedMedName = medicines.find(m => String(m.id) === selectedMed)?.name || '';

  const quickQuestions = ['Low stock status?', "Today's revenue?", 'Best selling medicine?', 'Any expiry alerts?'];

  if (isLoading || !user) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <div className="spinner" style={{ width: 40, height: 40 }} />
    </div>
  );

  return (
    <ProtectedPage capability={CAPABILITIES.AI_VIEW}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>AI Insights</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Demand forecasting, anomaly detection, and intelligent chat</p>
          </div>
          <span className="badge badge-violet" style={{ padding: '8px 16px', fontSize: 12 }}>
            <Brain size={14} style={{ marginRight: 6 }} /> Powered by PharmaNexus AI
          </span>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'var(--bg-secondary)', borderRadius: 12, padding: 6, width: 'fit-content' }}>
          {[
            { id: 'forecast' as AiTab, label: '📈 Demand Forecast', icon: TrendingUp },
            { id: 'anomaly' as AiTab, label: '🔍 Anomaly Detection', icon: AlertTriangle },
            { id: 'chat' as AiTab, label: '💬 AI Chat', icon: MessageSquare },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: '9px 18px', borderRadius: 9, border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 500, transition: 'all 0.2s',
                background: tab === t.id ? 'var(--bg-card)' : 'transparent',
                color: tab === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: tab === t.id ? '0 2px 8px rgba(0,0,0,0.3)' : 'none',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Forecast Tab */}
        {tab === 'forecast' && (
          <div>
            <div className="glass-card" style={{ padding: 24, marginBottom: 20 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Configure Forecast</h3>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 250px' }}>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6, fontWeight: 500 }}>Medicine</label>
                  <select className="pharma-input" value={selectedMed} onChange={e => setSelectedMed(e.target.value)}>
                    {medicines.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6, fontWeight: 500 }}>Days Ahead</label>
                  <select className="pharma-select" value={daysAhead} onChange={e => setDaysAhead(Number(e.target.value))}>
                    <option value={7}>7 days</option>
                    <option value={14}>14 days</option>
                    <option value={30}>30 days</option>
                  </select>
                </div>
                <button onClick={runForecast} className="btn-primary" disabled={loading}>
                  {loading ? <Loader2 size={16} className="animate-spin-slow" /> : <TrendingUp size={16} />}
                  {loading ? 'Forecasting...' : 'Run Forecast'}
                </button>
              </div>
            </div>

            {forecastData && (
              <div className="chart-container">
                <div style={{ marginBottom: 20 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700 }}>Demand Forecast — {selectedMedName}</h3>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    Avg daily demand: <strong style={{ color: '#60a5fa' }}>{forecastData.historical_avg_daily} units</strong>
                    &nbsp;| Moving average (7-day window)
                  </p>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,45,74,0.5)" />
                    <XAxis dataKey="date" tick={{ fill: '#4b5e7a', fontSize: 10 }}
                      tickFormatter={d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} />
                    <YAxis tick={{ fill: '#4b5e7a', fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ background: '#111827', border: '1px solid #1e2d4a', borderRadius: 10, fontSize: 12 }}
                      labelFormatter={d => new Date(d).toLocaleDateString('en-IN')} />
                    <ReferenceLine x={new Date().toISOString().split('T')[0]}
                      stroke="rgba(139,92,246,0.5)" strokeDasharray="4 4" label={{ value: 'Today', fill: '#a78bfa', fontSize: 11 }} />
                    <Line type="monotone" dataKey="historical" name="Actual Sales" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#10b981" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 4, fill: '#10b981' }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>

                {/* Forecast table */}
                <div style={{ marginTop: 24 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: 'var(--text-secondary)' }}>Forecast Details</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
                    {forecastData.forecast?.map((f: any, i: number) => (
                      <div key={i} className="glass-card" style={{ padding: '14px 16px' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                          {new Date(f.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: '#34d399' }}>{f.predicted_qty}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>units predicted</div>
                        <div style={{ fontSize: 11, marginTop: 6, color: 'var(--text-secondary)' }}>
                          Range: {f.lower_bound}–{f.upper_bound}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {!forecastData && (
              <div className="glass-card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
                <TrendingUp size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
                <p style={{ fontSize: 16, fontWeight: 600 }}>Select a medicine and click &quot;Run Forecast&quot;</p>
                <p style={{ fontSize: 13, marginTop: 6 }}>Uses 7-day moving average on historical sales data</p>
              </div>
            )}
          </div>
        )}

        {/* Anomaly Tab */}
        {tab === 'anomaly' && (
          <div>
            <div className="glass-card" style={{ padding: 24, marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Z-Score Anomaly Detection</h3>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    Flags days where revenue deviated more than 2σ from the mean
                  </p>
                </div>
                <button onClick={() => aiApi.detectAnomalies().then(r => setAnomalyData(r.data))} className="btn-secondary">
                  Refresh
                </button>
              </div>
            </div>

            {anomalyData && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
                  {[
                    { label: 'Mean Daily Revenue', value: `₹${anomalyData.mean_daily_revenue?.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, color: '#3b82f6' },
                    { label: 'Std Deviation', value: `₹${anomalyData.std_dev?.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, color: '#8b5cf6' },
                    { label: 'Anomalies Found', value: anomalyData.anomalies?.length || 0, color: anomalyData.anomalies?.length > 0 ? '#f43f5e' : '#10b981' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="glass-card" style={{ padding: '20px 24px' }}>
                      <div style={{ fontSize: 26, fontWeight: 800, color, marginBottom: 4 }}>{value}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</div>
                    </div>
                  ))}
                </div>

                {anomalyData.anomalies?.length === 0 ? (
                  <div className="glass-card" style={{ padding: 40, textAlign: 'center' }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                    <p style={{ fontSize: 16, fontWeight: 600 }}>No anomalies detected</p>
                    <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>Sales patterns are within normal range</p>
                  </div>
                ) : (
                  <div className="glass-card" style={{ overflow: 'hidden' }}>
                    <table className="pharma-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Revenue</th>
                          <th>Orders</th>
                          <th>Z-Score</th>
                          <th>Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {anomalyData.anomalies.map((a: any, i: number) => (
                          <tr key={i}>
                            <td>{new Date(a.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                            <td style={{ fontWeight: 600 }}>₹{Number(a.revenue).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                            <td>{a.orders}</td>
                            <td style={{ fontFamily: 'monospace', color: a.z_score > 0 ? '#34d399' : '#fb7185' }}>{a.z_score}</td>
                            <td>
                              <span className={`badge ${a.type === 'unusually_high' ? 'badge-green' : 'badge-rose'}`}>
                                {a.type === 'unusually_high' ? '📈 High' : '📉 Low'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Chat Tab */}
        {tab === 'chat' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20 }}>
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', height: '65vh', padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Bot size={18} color="white" />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>PharmaNexus AI</div>
                  <div style={{ fontSize: 11, color: '#34d399', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399', display: 'inline-block' }} />
                    Online
                  </div>
                </div>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {chatMessages.map((msg, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                    {msg.role === 'ai' && (
                      <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 10, flexShrink: 0, alignSelf: 'flex-end' }}>
                        <Bot size={14} color="white" />
                      </div>
                    )}
                    <div style={{
                      maxWidth: '75%', padding: '12px 16px', borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      background: msg.role === 'user' ? 'linear-gradient(135deg, #3b82f6, #06b6d4)' : 'var(--bg-secondary)',
                      border: msg.role === 'ai' ? '1px solid var(--border)' : 'none',
                      fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)',
                    }}>
                      <span dangerouslySetInnerHTML={{ __html: msg.content.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} />
                    </div>
                  </div>
                ))}
                {loading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Bot size={14} color="white" />
                    </div>
                    <div style={{ padding: '12px 16px', borderRadius: '16px 16px 16px 4px', background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {[0, 1, 2].map(i => (
                          <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-blue)', animation: `pulse-glow 1s ${i * 0.2}s infinite` }} />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <form onSubmit={sendChat} style={{ padding: '16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 12 }}>
                <input className="pharma-input" placeholder="Ask about inventory, sales, forecasts..." value={chatInput}
                  onChange={e => setChatInput(e.target.value)} style={{ flex: 1 }} />
                <button type="submit" className="btn-primary" disabled={loading || !chatInput.trim()} style={{ padding: '10px 16px' }}>
                  <Send size={16} />
                </button>
              </form>
            </div>

            {/* Suggestions */}
            <div>
              <div className="glass-card" style={{ padding: 20 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Quick Questions</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {quickQuestions.map(q => (
                    <button key={q} onClick={() => { setChatInput(q); }}
                      style={{
                        padding: '10px 14px', borderRadius: 10,
                        background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)',
                        color: '#60a5fa', cursor: 'pointer', fontSize: 13, textAlign: 'left',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(59,130,246,0.15)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(59,130,246,0.06)'}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
              <div className="glass-card" style={{ padding: 20, marginTop: 16 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>AI Capabilities</h4>
                {[
                  '📦 Inventory queries',
                  '💰 Revenue insights',
                  '🏆 Top medicines',
                  '📅 Expiry monitoring',
                  '🔁 Transfer guidance',
                  '📈 Forecast info',
                ].map(c => (
                  <div key={c} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '6px 0', borderBottom: '1px solid rgba(30,45,74,0.4)' }}>
                    {c}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </ProtectedPage>
  );
}
