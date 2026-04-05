'use client';
import { ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Capability, hasCapability } from '@/lib/permissions';
import { ShieldAlert } from 'lucide-react';

interface ProtectedPageProps {
  capability: Capability;
  children: ReactNode;
}

export default function ProtectedPage({ capability, children }: ProtectedPageProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 100px)' }}>
        <div className="spinner" style={{ width: 40, height: 40 }} />
      </div>
    );
  }

  if (!user) {
    return null; // The response interceptor or AuthContext will redirect to /login
  }

  if (!hasCapability(user.role, capability)) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: 'calc(100vh - 100px)', padding: 24, textAlign: 'center'
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: '50%', background: 'rgba(244,63,94,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20
        }}>
          <ShieldAlert size={40} color="#fb7185" />
        </div>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Access Denied</h2>
        <p style={{ color: 'var(--text-secondary)', maxWidth: 400, fontSize: 14 }}>
          You do not have permission to view this page. If you believe this is an error, please contact your administrator.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
