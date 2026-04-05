import axios from 'axios';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('pharma_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    config.headers['X-Request-ID'] = `web_${Date.now().toString(36)}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('pharma_token');
      localStorage.removeItem('pharma_user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }

    if (err.response?.status === 403 && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('auth-error', {
          detail: { message: 'Access denied: insufficient permissions for this action.' },
        })
      );
    }

    return Promise.reject(err);
  }
);

export default api;

export const authApi = {
  login: (email: string, password: string) => api.post('/auth/login', { email, password }),
  me: () => api.get('/auth/me'),
};

export const inventoryApi = {
  getInventory: (store_id?: number) => api.get('/inventory', { params: store_id ? { store_id } : {} }),
  addBatch: (data: unknown) => api.post('/inventory/add', data),
  getLowStock: () => api.get('/inventory/low-stock'),
  getExpiryAlerts: () => api.get('/inventory/expiry-alerts'),
  transfer: (data: unknown) => api.post('/inventory/transfer', data),
  getMedicines: () => api.get('/inventory/medicines'),
  getStores: () => api.get('/inventory/stores'),
  getBatches: (store_id?: number, medicine_id?: number) =>
    api.get('/inventory/batches', { params: { store_id, medicine_id } }),
  getTransferRecommendations: (store_id?: number) =>
    api.get('/inventory/transfer-recommendations', { params: store_id ? { store_id } : {} }),
  getReplenishmentPlan: (store_id?: number) =>
    api.get('/inventory/replenishment-plan', { params: store_id ? { store_id } : {} }),
};

export const billingApi = {
  createSale: (data: unknown) => api.post('/billing/create', data),
  getSale: (id: number) => api.get(`/billing/${id}`),
  listSales: (store_id?: number) => api.get('/billing', { params: store_id ? { store_id } : {} }),
};

export const analyticsApi = {
  getKPIs: (store_id?: number) => api.get('/analytics/kpis', { params: store_id ? { store_id } : {} }),
  getSalesTrend: (days = 30, store_id?: number) => api.get('/analytics/sales', { params: { days, store_id } }),
  getTopProducts: (days = 30, store_id?: number) => api.get('/analytics/top-products', { params: { days, store_id } }),
  getMargin: (days = 30, store_id?: number) => api.get('/analytics/margin', { params: { days, store_id } }),
  getExpiryLoss: (store_id?: number) => api.get('/analytics/expiry-loss', { params: store_id ? { store_id } : {} }),
  getStorePerformance: (days = 30) => api.get('/analytics/store-performance', { params: { days } }),
  getCategoryInsights: (days = 30, store_id?: number) => api.get('/analytics/category-insights', { params: { days, store_id } }),
};

export const aiApi = {
  forecast: (medicine_id: number, store_id?: number, days_ahead = 7) =>
    api.post('/ai/forecast', { medicine_id, store_id, days_ahead }),
  detectAnomalies: (store_id?: number, days = 30) => api.post('/ai/anomaly', { store_id, days }),
  chat: (message: string, store_id?: number) => api.post('/ai/query', { message, store_id }),
  listDecisions: (feature?: string, requires_review?: boolean) =>
    api.get('/ai/decisions', { params: { feature, requires_review } }),
  reviewDecision: (id: number, approved: boolean, notes?: string) =>
    api.put(`/ai/decisions/${id}/review`, { approved, notes }),
};

export const prescriptionApi = {
  create: (data: unknown) => api.post('/prescriptions', data),
  list: (status_filter?: string, store_id?: number) =>
    api.get('/prescriptions', { params: { status_filter, store_id } }),
  get: (id: number) => api.get(`/prescriptions/${id}`),
  approve: (id: number, notes?: string) => api.put(`/prescriptions/${id}/approve`, null, { params: { notes } }),
  reject: (id: number, reason: string) => api.put(`/prescriptions/${id}/reject`, null, { params: { reason } }),
  uploadDocument: (id: number, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post(`/prescriptions/${id}/upload-document`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export const auditApi = {
  list: (params?: Record<string, unknown>) => api.get('/audit', { params }),
  getEntityHistory: (entity_type: string, entity_id: string) => api.get(`/audit/entity/${entity_type}/${entity_id}`),
  getSummary: () => api.get('/audit/summary'),
};

export const syncApi = {
  pushEvents: (events: unknown[]) =>
    api.post('/sync/events', { events, client_timestamp: new Date().toISOString() }),
  status: () => api.get('/sync/status'),
};
