import { LayoutDashboard, Package, ShoppingCart, BarChart2, Brain, ClipboardList, ShieldCheck, LucideIcon } from 'lucide-react';
import { CAPABILITIES, Capability } from './permissions';

export interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
  capability: Capability;
}

export const navConfig: NavItem[] = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', capability: CAPABILITIES.DASHBOARD_VIEW },
  { href: '/inventory', icon: Package, label: 'Inventory', capability: CAPABILITIES.INVENTORY_VIEW },
  { href: '/billing', icon: ShoppingCart, label: 'Billing', capability: CAPABILITIES.BILLING_VIEW },
  { href: '/analytics', icon: BarChart2, label: 'Analytics', capability: CAPABILITIES.ANALYTICS_VIEW },
  { href: '/ai', icon: Brain, label: 'AI Insights', capability: CAPABILITIES.AI_VIEW },
  { href: '/prescriptions', icon: ClipboardList, label: 'Prescriptions', capability: CAPABILITIES.PRESCRIPTIONS_VIEW },
  { href: '/audit', icon: ShieldCheck, label: 'Audit Trail', capability: CAPABILITIES.AUDIT_VIEW },
];
