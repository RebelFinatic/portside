import { useEffect, useMemo, useState } from 'react';
import { Ban, Loader2, RefreshCw, Search, ShieldX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { toast } from 'sonner';

type BanStatus = 'all' | 'active' | 'expired' | 'revoked';

interface BanRecord {
  id: string;
  playerId: string | null;
  playerDisplayName: string;
  targetName: string | null;
  targetIdentifiers: string[];
  reason: string | null;
  durationInput: string | null;
  expiresAt: string | null;
  authorUsername: string | null;
  createdAt: string;
  revokedAt: string | null;
}

const statusOptions: { value: BanStatus; label: string }[] = [
  { value: 'all', label: 'All bans' },
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'revoked', label: 'Revoked' },
];

const getBanStatus = (ban: BanRecord) => {
  if (ban.revokedAt) return 'revoked';
  if (ban.expiresAt && new Date(ban.expiresAt).getTime() <= Date.now()) return 'expired';
  return 'active';
};

export default function Bans() {
  const [bans, setBans] = useState<BanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<BanStatus>('active');
  const [revokingId, setRevokingId] = useState('');

  const fetchBans = async ({ silent = false } = {}) => {
    if (!silent) setRefreshing(true);
    try {
      const params = new URLSearchParams({
        status,
        limit: '100',
      });
      if (search.trim()) params.set('query', search.trim());
      const data = await apiFetch(`/moderation/bans?${params.toString()}`);
      setBans(Array.isArray(data) ? data : []);
    } catch (error: any) {
      if (!silent) toast.error(error.message || 'Failed to load bans');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchBans();
  }, [status]);

  const filteredBans = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return bans;
    return bans.filter(ban => {
      const haystack = [
        ban.playerDisplayName,
        ban.targetName,
        ban.reason,
        ban.authorUsername,
        ...ban.targetIdentifiers,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [bans, search]);

  const revokeBan = async (ban: BanRecord) => {
    setRevokingId(ban.id);
    try {
      await apiFetch(`/moderation/actions/${ban.id}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Revoked from Ban Manager' }),
      });
      toast.success('Ban revoked');
      await fetchBans({ silent: true });
    } catch (error: any) {
      toast.error(error.message || 'Failed to revoke ban');
    } finally {
      setRevokingId('');
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full w-full p-6 lg:p-8 overflow-y-auto">
      <div className="mb-6 flex flex-col gap-4 border-b border-zinc-800/50 pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white m-0">Ban Manager</h1>
          <p className="text-sm text-zinc-500 m-0">Search, review, and revoke player bans across the server.</p>
        </div>
        <button
          onClick={() => fetchBans()}
          disabled={refreshing}
          className="inline-flex items-center justify-center gap-2 rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:border-zinc-700 hover:bg-zinc-800 disabled:opacity-60"
        >
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin text-orange-500" /> : <RefreshCw className="h-3.5 w-3.5 text-zinc-400" />}
          Refresh
        </button>
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') fetchBans();
            }}
            placeholder="Search by player, reason, identifier, or admin..."
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-10 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-orange-600"
          />
        </div>
        <select
          value={status}
          onChange={event => setStatus(event.target.value as BanStatus)}
          style={{ colorScheme: 'dark' }}
          className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-orange-600"
        >
          {statusOptions.map(option => (
            <option key={option.value} value={option.value} className="bg-zinc-950 text-zinc-200">
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-[#111] overflow-hidden">
        <div className="hidden lg:grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_120px_140px_120px_120px] gap-4 px-6 py-3 border-b border-zinc-800 bg-zinc-950/60 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          <span>Player</span>
          <span>Reason</span>
          <span>Status</span>
          <span>Expires</span>
          <span>Admin</span>
          <span className="text-right">Actions</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-3 p-12 text-sm text-zinc-400">
            <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
            Loading bans...
          </div>
        ) : filteredBans.length === 0 ? (
          <div className="p-12 text-center">
            <ShieldX className="mx-auto h-8 w-8 text-zinc-600" />
            <p className="mt-3 text-sm text-zinc-500">No bans match the current filters.</p>
          </div>
        ) : (
          filteredBans.map(ban => {
            const banStatus = getBanStatus(ban);
            return (
              <div
                key={ban.id}
                className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_120px_140px_120px_120px] gap-3 lg:gap-4 items-start lg:items-center px-6 py-4 border-b border-zinc-800/70"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-white">{ban.playerDisplayName}</div>
                  <div className="truncate font-mono text-[11px] text-zinc-500">{ban.targetIdentifiers[0] || 'No identifier'}</div>
                </div>
                <div className="min-w-0 text-sm text-zinc-300">{ban.reason || 'No reason provided'}</div>
                <StatusBadge status={banStatus} />
                <div className="text-xs text-zinc-400">
                  {ban.expiresAt ? new Date(ban.expiresAt).toLocaleString() : 'Permanent'}
                </div>
                <div className="text-xs text-zinc-400">{ban.authorUsername || 'system'}</div>
                <div className="flex justify-start lg:justify-end gap-2">
                  {ban.playerId && (
                    <Link
                      to={`/players?profile=${ban.playerId}`}
                      className="rounded border border-zinc-800 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-300 hover:border-orange-600/40 hover:text-orange-300"
                    >
                      Profile
                    </Link>
                  )}
                  {banStatus === 'active' && (
                    <button
                      onClick={() => revokeBan(ban)}
                      disabled={revokingId === ban.id}
                      className="inline-flex items-center gap-1 rounded border border-red-900/60 bg-red-950/30 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-red-300 hover:border-red-700 disabled:opacity-50"
                    >
                      {revokingId === ban.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: 'active' | 'expired' | 'revoked' }) {
  const styles = {
    active: 'border-red-500/30 bg-red-500/10 text-red-300',
    expired: 'border-zinc-700 bg-zinc-900 text-zinc-400',
    revoked: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  }[status];

  return (
    <span className={`inline-flex w-fit rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${styles}`}>
      {status}
    </span>
  );
}
