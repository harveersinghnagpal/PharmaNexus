'use client';
/**
 * IndexedDB-backed offline queue for PharmaNexus.
 * Stores actions when offline and flushes them to the server when reconnected.
 */

const DB_NAME = 'pharmanexus_offline';
const DB_VERSION = 1;
const STORE_NAME = 'pending_events';

type OfflineEventType = 'sale_create' | 'batch_add' | 'transfer_create';

interface OfflineEvent {
  local_id: string;
  event_type: OfflineEventType;
  payload: Record<string, unknown>;
  created_at: string;
  store_id: number;
}

interface SaleCreatePayload {
  store_id: number;
  prescription_number?: string;
  prescription_id?: number;
  payment_method?: string;
  discount_amount?: number;
  notes?: string;
  items: Array<{
    medicine_id: number;
    batch_id: number;
    quantity: number;
    price: number;
  }>;
}

interface BatchAddPayload {
  medicine_id: number;
  store_id: number;
  batch_number: string;
  expiry_date: string;
  cost_price: number;
  quantity: number;
}

interface TransferCreatePayload {
  from_store_id: number;
  to_store_id: number;
  medicine_id: number;
  quantity: number;
}

interface OfflineFlushResult {
  applied: number;
  failed: number;
  duplicates: number;
  conflicts: number;
}

class OfflineQueue {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'local_id' });
        }
      };
      request.onsuccess = (e) => {
        this.db = (e.target as IDBOpenDBRequest).result;
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async enqueue(event: Omit<OfflineEvent, 'local_id' | 'created_at'>): Promise<string> {
    await this.init();
    const local_id = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const full_event: OfflineEvent = {
      ...event,
      local_id,
      created_at: new Date().toISOString(),
    };

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.add(full_event);
      request.onsuccess = () => resolve(local_id);
      request.onerror = () => reject(request.error);
    });
  }

  async getAll(): Promise<OfflineEvent[]> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async remove(local_id: string): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(local_id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async count(): Promise<number> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async clear(): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Flush all queued events to the backend sync endpoint.
   * Returns sync summary counts.
   */
  async flush(token: string): Promise<OfflineFlushResult> {
    const events = await this.getAll();
    if (events.length === 0) return { applied: 0, failed: 0, duplicates: 0, conflicts: 0 };

    const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

    try {
      const response = await fetch(`${API_BASE}/sync/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          events,
          client_timestamp: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.status}`);
      }

      const data = await response.json();
      let applied = 0;
      let failed = 0;
      let duplicates = 0;
      let conflicts = 0;

      // Remove successfully processed events
      for (const result of data.results || []) {
        if (result.status === 'applied') {
          await this.remove(result.local_id);
          applied++;
        } else if (result.status === 'duplicate') {
          await this.remove(result.local_id);
          duplicates++;
        } else if (result.status === 'conflict') {
          await this.remove(result.local_id);
          conflicts++;
        } else {
          failed++;
        }
      }

      return { applied, failed, duplicates, conflicts };
    } catch (error) {
      console.error('OfflineQueue: Flush failed', error);
      return { applied: 0, failed: events.length, duplicates: 0, conflicts: 0 };
    }
  }

  async queueSaleCreate(payload: SaleCreatePayload): Promise<string> {
    return this.enqueue({
      event_type: 'sale_create',
      payload,
      store_id: payload.store_id,
    });
  }

  async queueBatchAdd(payload: BatchAddPayload): Promise<string> {
    return this.enqueue({
      event_type: 'batch_add',
      payload,
      store_id: payload.store_id,
    });
  }

  async queueTransferCreate(payload: TransferCreatePayload): Promise<string> {
    return this.enqueue({
      event_type: 'transfer_create',
      payload,
      store_id: payload.from_store_id,
    });
  }
}

// Singleton instance
export const offlineQueue = new OfflineQueue();
export type {
  BatchAddPayload,
  OfflineEvent,
  OfflineEventType,
  OfflineFlushResult,
  SaleCreatePayload,
  TransferCreatePayload,
};
