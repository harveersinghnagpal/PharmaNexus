'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navConfig } from '@/lib/nav';
import { hasCapability } from '@/lib/permissions';
import { useAuth } from '@/context/AuthContext';

export default function BottomNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const items = user
    ? navConfig.filter(({ capability }) => hasCapability(user.role, capability)).slice(0, 5)
    : [];

  return (
    <nav className="bottom-nav">
      {items.map(({ href, icon: Icon, label }) => {
        const active = pathname === href || pathname.startsWith(href + '/');
        return (
          <Link
            key={href}
            href={href}
            className={`bottom-nav-item ${active ? 'active' : ''}`}
          >
            <Icon size={active ? 22 : 20} strokeWidth={active ? 2.5 : 1.8} />
            <span className="truncate w-full text-center" style={{ fontSize: '10px' }}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
