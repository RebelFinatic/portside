import React, { useState, useEffect } from 'react';
import { Search, ShieldAlert, Zap, Loader2, Ban, X } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { toast } from 'sonner';

export default function Players() {
  const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  // Ban Modal State
  const [banModalOpen, setBanModalOpen] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<any>(null);
  const [banReason, setBanReason] = useState('');
  const [banDuration, setBanDuration] = useState('24h');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchPlayers();
  }, []);

  const fetchPlayers = async () => {
    try {
      const data = await apiFetch('/players');
      setPlayers(data);
    } catch (error) {
      toast.error('Failed to load players');
    } finally {
      setLoading(false);
    }
  };
  
  const handleKick = async (id: number) => {
    try {
      await apiFetch(`/players/${id}/kick`, { method: 'POST' });
      toast.success('Player kicked successfully');
      setPlayers(prev => prev.filter(p => p.id !== id));
    } catch (error) {
      toast.error('Failed to kick player');
    }
  };

  const openBanModal = (player: any) => {
    setSelectedPlayer(player);
    setBanReason('');
    setBanDuration('24h');
    setBanModalOpen(true);
  };

  const handleBan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlayer) return;
    setActionLoading(true);
    try {
      await apiFetch(`/players/${selectedPlayer.id}/ban`, {
        method: 'POST',
        body: JSON.stringify({ reason: banReason, duration: banDuration })
      });
      toast.success(`Player ${selectedPlayer.name} banned`);
      setPlayers(prev => prev.filter(p => p.id !== selectedPlayer.id));
      setBanModalOpen(false);
    } catch (error) {
      toast.error('Failed to ban player');
    } finally {
      setActionLoading(false);
    }
  };

  const filtered = players.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex-1 flex flex-col w-full h-full p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 gap-4">
        <div>
           <h1 className="text-2xl font-bold tracking-tight text-white m-0">Players</h1>
           <p className="text-sm text-zinc-500 m-0">Ban, kick, and manage player roles.</p>
        </div>
        
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <input 
            type="text" 
            placeholder="Search players..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 w-full sm:w-64 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500 transition-colors"
          />
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-[#111] border border-zinc-800 rounded-xl overflow-hidden min-h-0">
        {/* Table Header */}
        <div className="grid grid-cols-[80px_1fr_1fr_120px_150px] px-6 py-3 border-b border-zinc-800 bg-zinc-900 shrink-0">
          <div className="text-[10px] uppercase font-bold tracking-widest text-zinc-400">ID</div>
          <div className="text-[10px] uppercase font-bold tracking-widest text-zinc-400">Name</div>
          <div className="text-[10px] uppercase font-bold tracking-widest text-zinc-400">Identifiers</div>
          <div className="text-[10px] uppercase font-bold tracking-widest text-zinc-400">Ping</div>
          <div className="text-[10px] uppercase font-bold tracking-widest text-zinc-400 text-right">Actions</div>
        </div>
        
        {/* Table Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-12 text-center flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-zinc-500 text-sm">No players found.</div>
          ) : (
            <div className="flex flex-col">
              {filtered.map((player) => (
                <div key={player.id} className="grid grid-cols-[80px_1fr_1fr_120px_150px] items-center px-6 py-4 data-grid-row group hover:bg-zinc-800/50">
                  <div className="font-mono text-xs text-zinc-500">{player.id}</div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{player.name}</span>
                    {player.role === 'admin' || player.role === 'owner' ? (
                      <ShieldAlert className="w-3.5 h-3.5 text-orange-500" />
                    ) : null}
                  </div>
                  <div className="font-mono text-[11px] text-zinc-500 truncate pr-4">
                    {player.identifiers[0]}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${player.ping < 50 ? 'bg-green-500' : player.ping < 100 ? 'bg-yellow-500' : 'bg-red-500'}`}></span>
                    <span className="font-mono text-[11px] text-zinc-400">{player.ping}ms</span>
                  </div>
                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => handleKick(player.id)} className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-md transition-colors" title="Kick Player">
                      <Zap className="w-4 h-4" />
                    </button>
                    <button onClick={() => openBanModal(player)} className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors" title="Ban Player">
                      <Ban className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Ban Modal */}
      {banModalOpen && selectedPlayer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#111] border border-zinc-800 rounded-xl w-full max-w-md shadow-2xl flex flex-col shrink-0">
            <div className="flex items-center justify-between p-4 border-b border-zinc-800">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Ban className="w-5 h-5 text-red-500" />
                Ban {selectedPlayer.name}
              </h2>
              <button 
                onClick={() => setBanModalOpen(false)}
                className="p-1 text-zinc-400 hover:text-white transition-colors"
                disabled={actionLoading}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleBan} className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">
                  Reason
                </label>
                <input
                  type="text"
                  required
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                  className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-red-500 transition-colors"
                  placeholder="e.g. Mass RDM"
                  disabled={actionLoading}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">
                  Duration
                </label>
                <select
                  value={banDuration}
                  onChange={(e) => setBanDuration(e.target.value)}
                  className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-red-500 transition-colors appearance-none cursor-pointer"
                  disabled={actionLoading}
                >
                  <option value="1h">1 Hour</option>
                  <option value="24h">24 Hours</option>
                  <option value="3d">3 Days</option>
                  <option value="1w">1 Week</option>
                  <option value="permanent">Permanent</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-zinc-800/50 mt-6">
                <button
                  type="button"
                  onClick={() => setBanModalOpen(false)}
                  className="px-4 py-2 bg-transparent text-sm font-medium text-zinc-400 hover:text-white transition-colors"
                  disabled={actionLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600/10 text-red-500 border border-red-600/30 rounded-lg text-sm font-bold tracking-wider uppercase hover:bg-red-600/20 transition-colors disabled:opacity-50"
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                  Confirm Ban
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
