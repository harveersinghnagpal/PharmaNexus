'use client';
import { useEffect, useState, useCallback } from 'react';
import { offlineQueue, type OfflineFlushResult } from '@/lib/offlineQueue';

interface UseOfflineSyncReturn {
  isOnline: boolean;
  isSyncing: boolean;
  queueSize: number;
  lastSyncResult: OfflineFlushResult | null;
  syncNow: () => Promise<OfflineFlushResult | null>;
  refreshQueueSize: () => Promise<void>;
}

export function useOfflineSync(): UseOfflineSyncReturn {
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [queueSize, setQueueSize] = useState(0);
  const [lastSyncResult, setLastSyncResult] = useState<OfflineFlushResult | null>(null);

  const refreshQueueSize = useCallback(async () => {
    try {
      const size = await offlineQueue.count();
      setQueueSize(size);
    } catch {
      // IndexedDB not available (SSR) — ignore
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (typeof window === 'undefined') return null;
    const token = localStorage.getItem('pharma_token');
    if (!token || isSyncing) return null;

    setIsSyncing(true);
    try {
      const result = await offlineQueue.flush(token);
      setLastSyncResult(result);
      if (result.failed > 0) {
        console.warn(`OfflineSync: ${result.failed} events failed to sync`);
      }
      await refreshQueueSize();
      return result;
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, refreshQueueSize]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Set initial state
    setIsOnline(navigator.onLine);
    refreshQueueSize();

    const handleOnline = async () => {
      setIsOnline(true);
      // Auto-sync when back online
      await syncNow();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    // Refresh queue size periodically
    const interval = setInterval(refreshQueueSize, 5000);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [syncNow, refreshQueueSize]);

  return { isOnline, isSyncing, queueSize, lastSyncResult, syncNow, refreshQueueSize };
}
