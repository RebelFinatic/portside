import { useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { apiFetch } from '../lib/api';
import { toast } from 'sonner';
import ConfirmModal from './ConfirmModal';

interface ServerStatus {
  online: boolean;
  fxserver?: { mode?: string; state?: string };
}

type HeaderProps = {
  onOpenMobileNav?: () => void;
};

export default function Header({ onOpenMobileNav }: HeaderProps) {
  const { logout, hasPermission } = useAuthStore();
  const [restarting, setRestarting] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const canControlServer = hasPermission('control.server');

  useEffect(() => {
    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const next = await apiFetch('/server/status');
        if (!cancelled) setStatus(next);
      } catch {
        if (!cancelled) setStatus(prev => prev ?? { online: false });
      }
    };

    fetchStatus();
    const interval = window.setInterval(fetchStatus, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const online = status?.online ?? false;
  const fxState = status?.fxserver?.state;
  const statusLabel = online ? 'Online' : 'Offline';
  const activityLabel = online ? 'Server Online' : 'Server Offline';
  const dotClass = online ? 'bg-emerald-500' : 'bg-red-500';

  const handleLogout = async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // Local logout still clears stale or expired sessions.
    } finally {
      logout();
    }
  };

  const handleRestart = async () => {
    setRestarting(true);
    try {
      await apiFetch('/server/control/restart', {
        method: 'POST',
        body: JSON.stringify({
          reason: 'Restarted from Portside navbar',
          message: 'Server restarting from Portside',
        }),
      });
      toast.success('Restart requested');
      setRestartOpen(false);
    } catch (error: any) {
      toast.error('Restart failed', { description: error.message });
    } finally {
      setRestarting(false);
    }
  };

  return (
    <>
      <header className="h-16 border-b border-zinc-800/50 bg-[#0a0a0a] flex items-center justify-between px-4 md:px-8 shrink-0 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {onOpenMobileNav && (
            <button
              type="button"
              onClick={onOpenMobileNav}
              className="md:hidden flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-white hover:bg-zinc-800"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </button>
          )}
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
            <span className="text-xs font-mono uppercase tracking-widest text-zinc-300 truncate">{activityLabel}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <div className="hidden sm:flex flex-col items-end mr-2">
            <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-tight">Status</span>
            <span className="text-sm font-semibold text-white">
              {statusLabel}
              {fxState && fxState !== 'external' ? ` · ${fxState}` : ''}
            </span>
          </div>
          {canControlServer && (
            <button
              onClick={() => setRestartOpen(true)}
              disabled={restarting}
              className="px-3 sm:px-4 py-1.5 bg-zinc-800 text-white rounded text-xs font-bold border border-zinc-700 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {restarting ? 'RESTARTING' : 'RESTART'}
            </button>
          )}
          <button
            onClick={handleLogout}
            className="px-3 sm:px-4 py-1.5 bg-red-600/20 text-red-500 rounded text-xs font-bold border border-red-600/30 transition-colors hover:bg-red-600/30"
          >
            LOGOUT
          </button>
        </div>
      </header>

      <ConfirmModal
        open={restartOpen}
        title="Restart FXServer?"
        description="This will restart the managed FXServer process. Online players may be disconnected during the restart."
        confirmLabel="Restart Server"
        danger
        loading={restarting}
        onConfirm={handleRestart}
        onCancel={() => setRestartOpen(false)}
      />
    </>
  );
}
