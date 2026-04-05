'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Cross, Menu, X } from 'lucide-react';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import OfflineBanner from './OfflineBanner';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { useAuth } from '@/context/AuthContext';
import { canAccessPath } from '@/lib/permissions';

const AUTH_ROUTES = ['/', '/login', '/register', '/unauthorized'];

export default function ShellProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { isOnline, isSyncing, queueSize, syncNow } = useOfflineSync();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [authError, setAuthError] = useState('');

  const isAuthRoute = AUTH_ROUTES.includes(pathname);
  const showShell = !!user && !isAuthRoute;

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthRoute && !user) {
      router.replace('/login');
      return;
    }
    if (user && !canAccessPath(user.role, pathname)) {
      router.replace('/unauthorized');
    }
  }, [isAuthRoute, isLoading, pathname, router, user]);

  useEffect(() => {
    const onAuthError = (event: Event) => {
      const customEvent = event as CustomEvent<{ message?: string }>;
      setAuthError(customEvent.detail?.message || 'Access denied for this action.');
      window.setTimeout(() => setAuthError(''), 3500);
    };

    window.addEventListener('auth-error', onAuthError as EventListener);
    return () => window.removeEventListener('auth-error', onAuthError as EventListener);
  }, []);

  if (isLoading && !isAuthRoute) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'var(--bg-primary)' }}>
        <div className="spinner" style={{ width: 40, height: 40 }} />
      </div>
    );
  }

  if (!showShell) {
    return <>{children}</>;
  }

  return (
    <>
      <OfflineBanner queueSize={queueSize} isSyncing={isSyncing} onSyncNow={syncNow} />

      <header className="mobile-header" style={{ top: !isOnline || queueSize > 0 ? '42px' : '0' }}>
        <button
          onClick={() => setSidebarOpen(true)}
          className="btn-secondary"
          style={{ padding: 8, minHeight: '38px', width: '38px', borderRadius: '10px' }}
        >
          <Menu size={18} />
        </button>
        <div className="flex items-center gap-2 flex-1">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #06b6d4)' }}
          >
            <Cross size={14} className="text-white" />
          </div>
          <span className="font-bold text-sm gradient-text">PharmaNexus</span>
        </div>
        <button
          onClick={() => setAuthError('')}
          className="btn-secondary"
          style={{
            padding: 0,
            minHeight: '32px',
            width: '32px',
            borderRadius: '999px',
            opacity: authError ? 1 : 0,
            pointerEvents: authError ? 'auto' : 'none',
          }}
        >
          <X size={14} />
        </button>
      </header>

      <Sidebar mobileOpen={sidebarOpen} onOpenChange={setSidebarOpen} />

      {authError && (
        <div
          className="glass-card"
          style={{
            position: 'fixed',
            right: 16,
            top: 16,
            zIndex: 120,
            maxWidth: 360,
            padding: '12px 14px',
            border: '1px solid rgba(244,63,94,0.2)',
            background: 'rgba(244,63,94,0.12)',
            color: '#fecdd3',
          }}
        >
          {authError}
        </div>
      )}

      <main className="main-content">{children}</main>
      <BottomNav />
    </>
  );
}
