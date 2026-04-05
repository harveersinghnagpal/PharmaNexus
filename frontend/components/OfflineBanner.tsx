'use client';
import { useEffect, useState } from 'react';
import { WifiOff, RefreshCw, CheckCircle } from 'lucide-react';

interface OfflineBannerProps {
  queueSize?: number;
  isSyncing?: boolean;
  onSyncNow?: () => void;
}

export default function OfflineBanner({ queueSize = 0, isSyncing = false, onSyncNow }: OfflineBannerProps) {
  const [isOnline, setIsOnline] = useState(typeof window !== 'undefined' ? navigator.onLine : true);
  const [showSynced, setShowSynced] = useState(false);

  useEffect(() => {
    if (isOnline !== navigator.onLine) {
      setIsOnline(navigator.onLine);
    }

    const handleOnline = () => {
      setIsOnline(true);
      // Show "synced" briefly
      if (queueSize > 0) {
        setShowSynced(true);
        setTimeout(() => setShowSynced(false), 3000);
      }
    };

    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [queueSize]);

  if (isOnline && queueSize === 0 && !showSynced) return null;

  if (showSynced) {
    return (
      <div className="offline-banner syncing" style={{ background: 'rgba(16, 185, 129, 0.95)', color: 'white' }}>
        <CheckCircle size={16} />
        <span>All changes synced successfully</span>
      </div>
    );
  }

  if (!isOnline) {
    return (
      <div className="offline-banner offline">
        <WifiOff size={16} />
        <span>
          You&apos;re offline.
          {queueSize > 0 && <strong> {queueSize} action{queueSize > 1 ? 's' : ''} queued</strong>}
          {' — '}changes will sync when connection returns.
        </span>
      </div>
    );
  }

  // Online but with pending queue
  if (queueSize > 0) {
    return (
      <div className="offline-banner syncing">
        <RefreshCw size={16} className={isSyncing ? 'animate-spin-slow' : ''} />
        <span>
          {isSyncing
            ? 'Syncing offline changes...'
            : <><strong>{queueSize}</strong> offline change{queueSize > 1 ? 's' : ''} ready to sync</>
          }
        </span>
        {!isSyncing && onSyncNow && (
          <button
            onClick={onSyncNow}
            style={{ marginLeft: 8, background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'white' }}
          >
            Sync now
          </button>
        )}
      </div>
    );
  }

  return null;
}
