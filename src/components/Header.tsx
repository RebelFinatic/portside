import { useAuthStore } from '../store/useAuthStore';
import { apiFetch } from '../lib/api';
import { toast } from 'sonner';
import { useState } from 'react';

export default function Header() {
  const { logout, hasPermission } = useAuthStore();
  const [restarting, setRestarting] = useState(false);
  const canControlServer = hasPermission('control.server');

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
    if (restarting) return;
    const confirmed = window.confirm('Restart the managed FXServer now?');
    if (!confirmed) return;

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
    } catch (error: any) {
      toast.error('Restart failed', { description: error.message });
    } finally {
      setRestarting(false);
    }
  };

  return (
    <header className="h-16 border-b border-zinc-800/50 bg-[#0a0a0a] flex items-center justify-between px-8 shrink-0">
      <div className="flex gap-8">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-green-500"></div>
          <span className="text-xs font-mono uppercase tracking-widest text-zinc-300">Server Active</span>
        </div>
      </div>
      
      <div className="flex items-center gap-4">
        <div className="mr-6 hidden sm:flex items-center gap-6">
          <div className="flex flex-col">
            <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-tight">Status</span>
            <span className="text-sm font-semibold text-white">Online</span>
          </div>
        </div>
        {canControlServer && (
          <button
            onClick={handleRestart}
            disabled={restarting}
            className="px-4 py-1.5 bg-zinc-800 text-white rounded text-xs font-bold border border-zinc-700 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {restarting ? 'RESTARTING' : 'RESTART'}
          </button>
        )}
        <button onClick={handleLogout} className="px-4 py-1.5 bg-red-600/20 text-red-500 rounded text-xs font-bold border border-red-600/30 transition-colors hover:bg-red-600/30">LOGOUT</button>
      </div>
    </header>
  );
}
