'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Cross, Eye, EyeOff, Loader2, Shield, TrendingUp, Package, Brain } from 'lucide-react';

const demoCredentials = [
  { role: 'Super Admin', email: 'admin@pharmanexus.com', color: '#8b5cf6' },
  { role: 'Regional Admin', email: 'regional@pharmanexus.com', color: '#3b82f6' },
  { role: 'Store Manager', email: 'manager@pharmanexus.com', color: '#10b981' },
  { role: 'Inventory Sup.', email: 'inventory@pharmanexus.com', color: '#f59e0b' },
  { role: 'Sales Staff', email: 'sales@pharmanexus.com', color: '#f43f5e' },
];

const demoPassword = 'PharmaNexus@2026!';

const features = [
  { icon: Package, label: 'Inventory', desc: 'Batch & expiry aware' },
  { icon: TrendingUp, label: 'Analytics', desc: 'Real-time BI dashboards' },
  { icon: Brain, label: 'AI Insights', desc: 'Demand forecasting' },
  { icon: Shield, label: 'RBAC', desc: 'Role-based access control' },
];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { user, login, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && user) {
      router.replace('/dashboard');
    }
  }, [isLoading, router, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Login failed. Check credentials.');
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword(demoPassword);
    setError('');
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      display: 'flex',
      alignItems: 'stretch',
    }}>
      {/* Left panel */}
      <div style={{
        flex: 1,
        background: 'linear-gradient(135deg, #0f1629 0%, #0a0e1a 50%, #0c1527 100%)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '60px',
        borderRight: '1px solid var(--border)',
        position: 'relative',
        overflow: 'hidden',
      }} className="hidden md:flex">
        {/* Background orbs */}
        <div style={{
          position: 'absolute', width: 400, height: 400, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)',
          top: -100, left: -100,
        }} />
        <div style={{
          position: 'absolute', width: 300, height: 300, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(139,92,246,0.1) 0%, transparent 70%)',
          bottom: 50, right: -50,
        }} />

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 48 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Cross size={24} color="white" />
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800 }} className="gradient-text">PharmaNexus</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Operations Hub</div>
          </div>
        </div>

        <h1 style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.2, marginBottom: 16 }}>
          Pharmacy Operations<br />
          <span className="gradient-text">Reimagined.</span>
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 16, lineHeight: 1.7, marginBottom: 48, maxWidth: 420 }}>
          Manage your entire pharmacy chain from a single platform. Real-time inventory,
          intelligent billing, and AI-powered insights.
        </p>

        {/* Features grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {features.map(({ icon: Icon, label, desc }) => (
            <div key={label} className="glass-card" style={{ padding: '16px 20px' }}>
              <Icon size={20} color="var(--accent-blue)" style={{ marginBottom: 8 }} />
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — login form */}
      <div style={{
        width: '100%', maxWidth: 480,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: '48px 40px',
        background: 'var(--bg-secondary)',
      }}>
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Welcome back</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Sign in to your PharmaNexus account</p>
        </div>

        {/* Demo credentials */}
        {process.env.NODE_ENV !== 'production' && (
          <div className="glass-card" style={{ padding: 16, marginBottom: 28 }}>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
              Demo Accounts (password: {demoPassword})
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {demoCredentials.map(({ role, email: demoEmail, color }) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => fillDemo(demoEmail)}
                  style={{
                    background: `${color}20`,
                    border: `1px solid ${color}40`,
                    borderRadius: 8,
                    padding: '5px 12px',
                    fontSize: 11,
                    color: color,
                    cursor: 'pointer',
                    fontWeight: 600,
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = `${color}35`)}
                  onMouseLeave={e => (e.currentTarget.style.background = `${color}20`)}
                >
                  {role}
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} autoComplete="on">
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
              Email Address
            </label>
            <input
              className="pharma-input"
              type="email"
              name="email"
              autoComplete="username"
              placeholder="you@pharmanexus.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                className="pharma-input"
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                style={{ paddingRight: 48 }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
                }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <div style={{
              background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)',
              borderRadius: 10, padding: '10px 16px', marginBottom: 20,
              fontSize: 13, color: '#fb7185',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn-primary"
            style={{ width: '100%', justifyContent: 'center', padding: '14px' }}
            disabled={loading}
          >
            {loading ? <Loader2 size={18} className="animate-spin-slow" /> : null}
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p style={{ marginTop: 24, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
          © 2024 PharmaNexus. All rights reserved.
        </p>
      </div>
    </div>
  );
}
