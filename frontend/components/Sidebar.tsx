'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Cross, LogOut, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { navConfig } from '@/lib/nav';
import { hasCapability, ROLE_BADGE_CLASSES, ROLE_LABELS } from '@/lib/permissions';

interface SidebarProps {
  mobileOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function Sidebar({ mobileOpen, onOpenChange }: SidebarProps) {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[99] md:hidden"
          onClick={() => onOpenChange(false)}
        />
      )}

      <nav className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="p-5 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #3b82f6, #06b6d4)' }}
            >
              <Cross size={18} className="text-white" />
            </div>
            <div className="hidden-on-collapse">
              <div className="font-bold text-[15px] gradient-text">PharmaNexus</div>
              <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">Enterprise</div>
            </div>
          </div>
          <button onClick={() => onOpenChange(false)} className="md:hidden text-[var(--text-muted)] p-1">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 py-4 overflow-y-auto">
          {navConfig
            .filter(({ capability }) => hasCapability(user.role, capability))
            .map(({ href, icon: Icon, label }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`sidebar-link ${active ? 'active' : ''}`}
                  onClick={() => onOpenChange(false)}
                >
                  <Icon size={18} className="flex-shrink-0" />
                  <span>{label}</span>
                  {active && <ChevronRight size={14} className="ml-auto opacity-60" />}
                </Link>
              );
            })}
        </div>

        <div className="p-4 border-t border-[var(--border)]">
          <div className="glass-card p-3 mb-3">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                {user.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold truncate">{user.name}</p>
                <p className="text-[11px] text-[var(--text-muted)] truncate">{user.email}</p>
              </div>
            </div>
            <span className={`badge ${ROLE_BADGE_CLASSES[user.role] || 'badge-blue'} text-[10px]`}>
              {ROLE_LABELS[user.role] || user.role}
            </span>
          </div>
          <button onClick={logout} className="btn-secondary w-full text-[13px]">
            <LogOut size={14} />
            Sign Out
          </button>
        </div>
      </nav>
    </>
  );
}
