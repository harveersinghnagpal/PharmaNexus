export const CAPABILITIES = {
  DASHBOARD_VIEW: 'dashboard.view',
  DASHBOARD_ALERTS_VIEW: 'dashboard.alerts.view',
  DASHBOARD_KPIS_VIEW: 'dashboard.kpis.view',
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_ADD_BATCH: 'inventory.add_batch',
  INVENTORY_TRANSFER: 'inventory.transfer',
  BILLING_VIEW: 'billing.view',
  ANALYTICS_VIEW: 'analytics.view',
  AI_VIEW: 'ai.view',
  AUDIT_VIEW: 'audit.view',
  PRESCRIPTIONS_VIEW: 'prescriptions.view',
  PRESCRIPTIONS_REVIEW: 'prescriptions.review',
} as const;

export type Capability = typeof CAPABILITIES[keyof typeof CAPABILITIES];

const ROLE_PERMISSIONS: Record<string, Capability[]> = {
  sales_staff: [
    CAPABILITIES.DASHBOARD_VIEW,
    CAPABILITIES.DASHBOARD_ALERTS_VIEW,
    CAPABILITIES.BILLING_VIEW,
    CAPABILITIES.PRESCRIPTIONS_VIEW,
  ],
  inventory_supervisor: [
    CAPABILITIES.DASHBOARD_VIEW,
    CAPABILITIES.DASHBOARD_ALERTS_VIEW,
    CAPABILITIES.INVENTORY_VIEW,
    CAPABILITIES.INVENTORY_ADD_BATCH,
    CAPABILITIES.PRESCRIPTIONS_VIEW,
  ],
  store_manager: [
    CAPABILITIES.DASHBOARD_VIEW,
    CAPABILITIES.DASHBOARD_ALERTS_VIEW,
    CAPABILITIES.DASHBOARD_KPIS_VIEW,
    CAPABILITIES.INVENTORY_VIEW,
    CAPABILITIES.INVENTORY_ADD_BATCH,
    CAPABILITIES.INVENTORY_TRANSFER,
    CAPABILITIES.BILLING_VIEW,
    CAPABILITIES.ANALYTICS_VIEW,
    CAPABILITIES.AI_VIEW,
    CAPABILITIES.PRESCRIPTIONS_VIEW,
    CAPABILITIES.PRESCRIPTIONS_REVIEW,
  ],
  regional_admin: [
    CAPABILITIES.DASHBOARD_VIEW,
    CAPABILITIES.DASHBOARD_ALERTS_VIEW,
    CAPABILITIES.DASHBOARD_KPIS_VIEW,
    CAPABILITIES.INVENTORY_VIEW,
    CAPABILITIES.INVENTORY_ADD_BATCH,
    CAPABILITIES.INVENTORY_TRANSFER,
    CAPABILITIES.BILLING_VIEW,
    CAPABILITIES.ANALYTICS_VIEW,
    CAPABILITIES.AI_VIEW,
    CAPABILITIES.PRESCRIPTIONS_VIEW,
    CAPABILITIES.PRESCRIPTIONS_REVIEW,
  ],
  super_admin: [
    CAPABILITIES.DASHBOARD_VIEW,
    CAPABILITIES.DASHBOARD_ALERTS_VIEW,
    CAPABILITIES.DASHBOARD_KPIS_VIEW,
    CAPABILITIES.INVENTORY_VIEW,
    CAPABILITIES.INVENTORY_ADD_BATCH,
    CAPABILITIES.INVENTORY_TRANSFER,
    CAPABILITIES.BILLING_VIEW,
    CAPABILITIES.ANALYTICS_VIEW,
    CAPABILITIES.AI_VIEW,
    CAPABILITIES.AUDIT_VIEW,
    CAPABILITIES.PRESCRIPTIONS_VIEW,
    CAPABILITIES.PRESCRIPTIONS_REVIEW,
  ],
};

const ROUTE_CAPABILITIES: Array<{ prefix: string; capability: Capability }> = [
  { prefix: '/dashboard', capability: CAPABILITIES.DASHBOARD_VIEW },
  { prefix: '/inventory', capability: CAPABILITIES.INVENTORY_VIEW },
  { prefix: '/billing', capability: CAPABILITIES.BILLING_VIEW },
  { prefix: '/analytics', capability: CAPABILITIES.ANALYTICS_VIEW },
  { prefix: '/ai', capability: CAPABILITIES.AI_VIEW },
  { prefix: '/audit', capability: CAPABILITIES.AUDIT_VIEW },
  { prefix: '/prescriptions', capability: CAPABILITIES.PRESCRIPTIONS_VIEW },
];

export const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  regional_admin: 'Regional Admin',
  store_manager: 'Store Manager',
  inventory_supervisor: 'Inventory Sup.',
  sales_staff: 'Sales Staff',
};

export const ROLE_BADGE_CLASSES: Record<string, string> = {
  super_admin: 'badge-violet',
  regional_admin: 'badge-blue',
  store_manager: 'badge-green',
  inventory_supervisor: 'badge-amber',
  sales_staff: 'badge-rose',
};

export const hasCapability = (role: string | null | undefined, capability: Capability): boolean => {
  if (!role) return false;
  const capabilities = ROLE_PERMISSIONS[role];
  if (!capabilities) return false;
  return capabilities.includes(capability);
};

export const canAccessPath = (role: string | null | undefined, pathname: string): boolean => {
  const route = ROUTE_CAPABILITIES.find(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (!route) return true;
  return hasCapability(role, route.capability);
};
