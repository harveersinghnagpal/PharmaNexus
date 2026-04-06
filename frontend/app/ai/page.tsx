'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ProtectedPage from '@/components/ProtectedPage';
import { useAuth } from '@/context/AuthContext';
import { CAPABILITIES } from '@/lib/permissions';
import { aiApi, inventoryApi } from '@/services/api';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, Bot, Brain, Loader2, RefreshCw, Send, TrendingUp } from 'lucide-react';

type AiTab = 'forecast' | 'anomaly' | 'chat';

interface ChatMsg {
  role: 'user' | 'ai';
  content: string;
  type?: string;
}

const quickQuestions = [
  'What are the highest priority low stock items right now?',
  'Summarize today revenue and order volume.',
  'Which products moved fastest in the recent window?',
  'What expiry risks need attention first?',
];

export default function AIPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [tab, setTab] = useState<AiTab>('forecast');
  const [medicines, setMedicines] = useState<any[]>([]);
  const [selectedMed, setSelectedMed] = useState('');
  const [daysAhead, setDaysAhead] = useState(7);
  const [forecastData, setForecastData] = useState<any>(null);
  const [anomalyData, setAnomalyData] = useState<any>(null);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([
    {
      role: 'ai',
      content:
        "PharmaNexus AI is ready. Ask about branch sales, low-stock pressure, expiry exposure, demand trends, or product movement.",
      type: 'general',
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [forecastLoading, setForecastLoading] = useState(false);
  const [anomalyLoading, setAnomalyLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [forecastError, setForecastError] = useState('');
  const [anomalyError, setAnomalyError] = useState('');

  useEffect(() => {
    if (!isLoading && !user) router.push('/login');
  }, [user, isLoading, router]);

  useEffect(() => {
    if (!user) return;
    inventoryApi.getMedicines().then((r) => {
      setMedicines(r.data);
      if (r.data[0]) setSelectedMed(String(r.data[0].id));
    });
  }, [user]);

  const runForecast = async () => {
    if (!selectedMed) return;
    setForecastLoading(true);
    setForecastError('');
    try {
      const res = await aiApi.forecast(Number(selectedMed), user?.store_id ?? undefined, daysAhead);
      setForecastData(res.data);
    } catch (err: any) {
      setForecastError(err.response?.data?.detail || err.message || 'Forecast failed');
      setForecastData(null);
    } finally {
      setForecastLoading(false);
    }
  };

  const loadAnomalies = async () => {
    setAnomalyLoading(true);
    setAnomalyError('');
    try {
      const res = await aiApi.detectAnomalies(user?.store_id ?? undefined);
      setAnomalyData(res.data);
    } catch (err: any) {
      setAnomalyError(err.response?.data?.detail || err.message || 'Anomaly detection failed');
      setAnomalyData(null);
    } finally {
      setAnomalyLoading(false);
    }
  };

  const sendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const msg = chatInput.trim();
    if (!msg) return;

    setChatInput('');
    setChatMessages((prev) => [...prev, { role: 'user', content: msg }]);
    setChatLoading(true);
    try {
      const res = await aiApi.chat(msg, user?.store_id ?? undefined);
      setChatMessages((prev) => [
        ...prev,
        { role: 'ai', content: res.data.response, type: res.data.type },
      ]);
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      const message =
        typeof detail === 'string'
          ? detail
          : detail?.message || err.message || 'AI chat is temporarily unavailable.';
      setChatMessages((prev) => [...prev, { role: 'ai', content: message, type: 'error' }]);
    } finally {
      setChatLoading(false);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
    }
  };

  const chartData = forecastData
    ? [
        ...(forecastData.historical?.slice(-14) || []).map((d: any) => ({
          date: d.date,
          historical: d.qty,
        })),
        ...(forecastData.forecast || []).map((d: any) => ({
          date: d.date,
          forecast: d.predicted_qty,
          lower: d.lower_bound,
          upper: d.upper_bound,
        })),
      ]
    : [];

  const selectedMedName = medicines.find((m) => String(m.id) === selectedMed)?.name || '';

  if (isLoading || !user) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'var(--bg-primary)' }}>
        <div className="spinner" style={{ width: 40, height: 40 }} />
      </div>
    );
  }

  return (
    <ProtectedPage capability={CAPABILITIES.AI_VIEW}>
      <div className="page-shell">
        <div className="page-header">
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>AI Insights</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              Forecast demand, investigate anomalies, and ask operational questions with scoped branch context.
            </p>
          </div>
          <span className="badge badge-violet" style={{ padding: '8px 16px', fontSize: 12 }}>
            <Brain size={14} style={{ marginRight: 6 }} /> Database-grounded AI workspace
          </span>
        </div>

        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-secondary)', borderRadius: 12, padding: 6, width: 'fit-content', flexWrap: 'wrap' }}>
          {[
            { id: 'forecast' as AiTab, label: 'Demand Forecast' },
            { id: 'anomaly' as AiTab, label: 'Anomaly Detection' },
            { id: 'chat' as AiTab, label: 'AI Chat' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              style={{
                padding: '9px 18px',
                borderRadius: 9,
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                background: tab === item.id ? 'var(--bg-card)' : 'transparent',
                color: tab === item.id ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: tab === item.id ? '0 2px 8px rgba(0,0,0,0.25)' : 'none',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === 'forecast' && (
          <div className="page-shell">
            <div className="glass-card" style={{ padding: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Configure Forecast</h3>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 250px' }}>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6, fontWeight: 500 }}>
                    Medicine
                  </label>
                  <select className="pharma-select" value={selectedMed} onChange={(e) => setSelectedMed(e.target.value)}>
                    {medicines.map((m: any) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6, fontWeight: 500 }}>
                    Days Ahead
                  </label>
                  <select className="pharma-select" value={daysAhead} onChange={(e) => setDaysAhead(Number(e.target.value))}>
                    <option value={7}>7 days</option>
                    <option value={14}>14 days</option>
                    <option value={30}>30 days</option>
                  </select>
                </div>
                <button onClick={runForecast} className="btn-primary" disabled={forecastLoading}>
                  {forecastLoading ? <Loader2 size={16} className="animate-spin-slow" /> : <TrendingUp size={16} />}
                  {forecastLoading ? 'Forecasting...' : 'Run Forecast'}
                </button>
              </div>
              {forecastError && (
                <p style={{ marginTop: 14, color: '#fb7185', fontSize: 13 }}>{forecastError}</p>
              )}
            </div>

            {forecastData ? (
              <div className="chart-container">
                <div style={{ marginBottom: 20 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700 }}>Demand Forecast for {selectedMedName}</h3>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    Avg daily demand: <strong style={{ color: '#60a5fa' }}>{forecastData.historical_avg_daily} units</strong>
                    {' '}| Anchor date {forecastData.anchor_date}
                  </p>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,45,74,0.5)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: '#4b5e7a', fontSize: 10 }}
                      tickFormatter={(d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    />
                    <YAxis tick={{ fill: '#4b5e7a', fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ background: '#111827', border: '1px solid #1e2d4a', borderRadius: 10, fontSize: 12 }}
                      labelFormatter={(d) => new Date(d).toLocaleDateString('en-IN')}
                    />
                    <ReferenceLine
                      x={forecastData.anchor_date}
                      stroke="rgba(139,92,246,0.5)"
                      strokeDasharray="4 4"
                      label={{ value: 'Anchor', fill: '#a78bfa', fontSize: 11 }}
                    />
                    <Line type="monotone" dataKey="historical" name="Actual Sales" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#10b981" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 4, fill: '#10b981' }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>

                <div style={{ marginTop: 24 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: 'var(--text-secondary)' }}>Forecast Details</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
                    {forecastData.forecast?.map((f: any, index: number) => (
                      <div key={index} className="glass-card" style={{ padding: '14px 16px' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                          {new Date(f.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: '#34d399' }}>{f.predicted_qty}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>units predicted</div>
                        <div style={{ fontSize: 11, marginTop: 6, color: 'var(--text-secondary)' }}>
                          Range: {f.lower_bound} to {f.upper_bound}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="glass-card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
                <TrendingUp size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
                <p style={{ fontSize: 16, fontWeight: 600 }}>Select a medicine and run a forecast</p>
                <p style={{ fontSize: 13, marginTop: 6 }}>The model uses branch-scoped sales history and anchors to the latest available business date.</p>
              </div>
            )}
          </div>
        )}

        {tab === 'anomaly' && (
          <div className="page-shell">
            <div className="glass-card" style={{ padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Revenue Anomaly Detection</h3>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    Flags daily revenue outliers from recent branch activity using z-score detection.
                  </p>
                </div>
                <button onClick={loadAnomalies} className="btn-secondary" disabled={anomalyLoading}>
                  {anomalyLoading ? <Loader2 size={16} className="animate-spin-slow" /> : <RefreshCw size={16} />}
                  {anomalyLoading ? 'Checking...' : 'Refresh'}
                </button>
              </div>
              {anomalyError && (
                <p style={{ marginTop: 14, color: '#fb7185', fontSize: 13 }}>{anomalyError}</p>
              )}
            </div>

            {anomalyData ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
                  {[
                    {
                      label: 'Mean Daily Revenue',
                      value: `Rs. ${anomalyData.mean_daily_revenue?.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
                      color: '#3b82f6',
                    },
                    {
                      label: 'Std Deviation',
                      value: `Rs. ${anomalyData.std_dev?.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
                      color: '#8b5cf6',
                    },
                    {
                      label: 'Anomalies Found',
                      value: anomalyData.anomalies?.length || 0,
                      color: anomalyData.anomalies?.length > 0 ? '#f43f5e' : '#10b981',
                    },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="glass-card" style={{ padding: '20px 24px' }}>
                      <div style={{ fontSize: 26, fontWeight: 800, color, marginBottom: 4 }}>{value}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</div>
                    </div>
                  ))}
                </div>

                {anomalyData.anomalies?.length === 0 ? (
                  <div className="glass-card" style={{ padding: 40, textAlign: 'center' }}>
                    <AlertTriangle size={40} style={{ color: '#34d399', marginBottom: 12 }} />
                    <p style={{ fontSize: 16, fontWeight: 600 }}>No anomalies detected</p>
                    <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
                      Revenue stayed within expected range for the anchored business window.
                    </p>
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
                        {anomalyData.anomalies.map((a: any, index: number) => (
                          <tr key={index}>
                            <td>{new Date(a.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                            <td style={{ fontWeight: 600 }}>Rs. {Number(a.revenue).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                            <td>{a.orders}</td>
                            <td style={{ fontFamily: 'monospace', color: a.z_score > 0 ? '#34d399' : '#fb7185' }}>{a.z_score}</td>
                            <td>
                              <span className={`badge ${a.type === 'unusually_high' ? 'badge-green' : 'badge-rose'}`}>
                                {a.type === 'unusually_high' ? 'High' : 'Low'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <div className="glass-card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
                <AlertTriangle size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
                <p style={{ fontSize: 16, fontWeight: 600 }}>Run anomaly detection when you need it</p>
                <p style={{ fontSize: 13, marginTop: 6 }}>This tab no longer auto-fires scans on page load, so AI logs stay meaningful.</p>
              </div>
            )}
          </div>
        )}

        {tab === 'chat' && (
          <div className="ai-chat-layout">
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', minHeight: '65vh', padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Bot size={18} color="white" />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>PharmaNexus AI</div>
                  <div style={{ fontSize: 11, color: '#34d399' }}>Branch-aware operational assistant</div>
                </div>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {chatMessages.map((msg, index) => (
                  <div key={index} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                    {msg.role === 'ai' && (
                      <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 10, flexShrink: 0, alignSelf: 'flex-end' }}>
                        <Bot size={14} color="white" />
                      </div>
                    )}
                    <div
                      style={{
                        maxWidth: '78%',
                        padding: '12px 16px',
                        borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                        background: msg.role === 'user' ? 'linear-gradient(135deg, #3b82f6, #06b6d4)' : 'var(--bg-secondary)',
                        border: msg.role === 'ai' ? '1px solid var(--border)' : 'none',
                        fontSize: 13,
                        lineHeight: 1.6,
                        color: 'var(--text-primary)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Bot size={14} color="white" />
                    </div>
                    <div style={{ padding: '12px 16px', borderRadius: '16px 16px 16px 4px', background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {[0, 1, 2].map((index) => (
                          <div key={index} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-blue)', animation: `pulse-glow 1s ${index * 0.2}s infinite` }} />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <form onSubmit={sendChat} style={{ padding: '16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 12 }}>
                <input
                  className="pharma-input"
                  placeholder="Ask about stock pressure, sales, expiry, or product movement..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button type="submit" className="btn-primary" disabled={chatLoading || !chatInput.trim()} style={{ padding: '10px 16px' }}>
                  {chatLoading ? <Loader2 size={16} className="animate-spin-slow" /> : <Send size={16} />}
                </button>
              </form>
            </div>

            <div className="page-shell">
              <div className="glass-card" style={{ padding: 20 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Quick Questions</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {quickQuestions.map((question) => (
                    <button
                      key={question}
                      onClick={() => setChatInput(question)}
                      style={{
                        padding: '10px 14px',
                        borderRadius: 10,
                        background: 'rgba(59,130,246,0.06)',
                        border: '1px solid rgba(59,130,246,0.15)',
                        color: '#60a5fa',
                        cursor: 'pointer',
                        fontSize: 13,
                        textAlign: 'left',
                      }}
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
              <div className="glass-card" style={{ padding: 20 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>AI Behavior</h4>
                {[
                  'Uses a configured LLM provider on every chat request.',
                  'Builds retrieved context from live database records before answering.',
                  'Scopes answers to the signed-in branch whenever the role is store-bound.',
                  'Refuses to answer from guesswork when the retrieved data does not contain the fact.',
                ].map((item) => (
                  <div key={item} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '6px 0', borderBottom: '1px solid rgba(30,45,74,0.4)' }}>
                    {item}
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
