export const hasRole = (userRole: string | undefined | null, allowedRoles: string[]): boolean => {
  if (!userRole) return false;
  return allowedRoles.includes(userRole);
};

// Common role groups based on backend configurations
export const ROLE_GROUPS = {
  SUPER_ADMIN: ["super_admin"],
  ADMIN: ["super_admin", "regional_admin"],
  MANAGER: ["super_admin", "regional_admin", "store_manager"],
  INVENTORY: ["super_admin", "regional_admin", "store_manager", "inventory_supervisor"],
  ALL_EXCEPT_SALES: ["super_admin", "regional_admin", "store_manager", "inventory_supervisor"],
  BILLING: ["super_admin", "regional_admin", "store_manager", "sales_staff"],
};
