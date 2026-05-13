import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Check, CircleAlert, MessageCircle, Plus, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '../lib/api';

interface WhitelistStatus {
  mode: 'disabled' | 'dry-run' | 'enforced';
  entries: number;
  pendingRequests: number;
  discord: {
    enabled: boolean;
    guildId: string | null;
    statusChannelId: string | null;
    statusMessageId: string | null;
    updateIntervalSeconds: number;
    tokenConfigured: boolean;
    bot?: {
      configured: boolean;
      connected: boolean;
      lastUpdateAt: string | null;
      lastError: string | null;
    };
  };
}

interface WhitelistEntry {
  id: string;
  type: 'identifier' | 'discord' | 'player';
  value: string;
  note: string | null;
  createdAt: string;
  createdByUsername: string | null;
}

interface WhitelistRequest {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  playerName: string;
  identifiers: string[];
  discordId: string | null;
  reason: string | null;
  createdAt: string;
  reviewedByUsername: string | null;
}

const emptyStatus: WhitelistStatus = {
  mode: 'disabled',
  entries: 0,
  pendingRequests: 0,
  discord: {
    enabled: false,
    guildId: null,
    statusChannelId: null,
    statusMessageId: null,
    updateIntervalSeconds: 60,
    tokenConfigured: false,
  },
};

export default function Whitelist() {
  const [status, setStatus] = useState<WhitelistStatus>(emptyStatus);
  const [entries, setEntries] = useState<WhitelistEntry[]>([]);
  const [requests, setRequests] = useState<WhitelistRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<'identifier' | 'discord' | 'player'>('identifier');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [discordForm, setDiscordForm] = useState({
    enabled: false,
    guildId: '',
    statusChannelId: '',
    statusMessageId: '',
    updateIntervalSeconds: 60,
  });

  const modeLabel = useMemo(() => {
    if (status.mode === 'enforced') return 'Enforced';
    if (status.mode === 'dry-run') return 'Dry Run';
    return 'Disabled';
  }, [status.mode]);

  const load = async () => {
    setLoading(true);
    try {
      const [nextStatus, nextEntries, nextRequests] = await Promise.all([
        apiFetch('/whitelist/status'),
        apiFetch('/whitelist/entries'),
        apiFetch('/whitelist/requests?status=pending'),
      ]);
      setStatus(nextStatus);
      setEntries(nextEntries);
      setRequests(nextRequests);
      setDiscordForm({
        enabled: Boolean(nextStatus.discord.enabled),
        guildId: nextStatus.discord.guildId || '',
        statusChannelId: nextStatus.discord.statusChannelId || '',
        statusMessageId: nextStatus.discord.statusMessageId || '',
        updateIntervalSeconds: nextStatus.discord.updateIntervalSeconds || 60,
      });
    } catch (error: any) {
      toast.error('Failed to load whitelist', { description: error.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const createEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!value.trim()) return;
    try {
      const entry = await apiFetch('/whitelist/entries', {
        method: 'POST',
        body: JSON.stringify({ type, value: value.trim(), note: note.trim() || null }),
      });
      setEntries(prev => [entry, ...prev]);
      setValue('');
      setNote('');
      toast.success('Whitelist entry added');
      load();
    } catch (error: any) {
      toast.error('Could not add entry', { description: error.message });
    }
  };

  const deleteEntry = async (id: string) => {
    try {
      await apiFetch(`/whitelist/entries/${id}`, { method: 'DELETE' });
      setEntries(prev => prev.filter(entry => entry.id !== id));
      toast.success('Whitelist entry removed');
      load();
    } catch (error: any) {
      toast.error('Could not remove entry', { description: error.message });
    }
  };

  const reviewRequest = async (id: string, decision: 'approve' | 'reject') => {
    try {
      await apiFetch(`/whitelist/requests/${id}/${decision}`, {
        method: 'POST',
        body: JSON.stringify({ reason: decision === 'approve' ? 'Approved in Portside' : 'Rejected in Portside' }),
      });
      toast.success(decision === 'approve' ? 'Request approved' : 'Request rejected');
      load();
    } catch (error: any) {
      toast.error('Could not review request', { description: error.message });
    }
  };

  const saveDiscordSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const next = await apiFetch('/discord/status-settings', {
        method: 'PUT',
        body: JSON.stringify(discordForm),
      });
      setStatus(prev => ({ ...prev, discord: { ...prev.discord, ...next } }));
      toast.success('Discord status settings saved');
    } catch (error: any) {
      toast.error('Could not save Discord settings', { description: error.message });
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Whitelist</h1>
          <p className="mt-1 text-sm text-zinc-500">Manage approved players, review join requests, and publish Discord server status.</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-bold uppercase text-zinc-200 hover:bg-zinc-800">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatusCard icon={<ShieldCheck className="h-5 w-5" />} label="Mode" value={modeLabel} detail="Set with PORTSIDE_WHITELIST_MODE" tone={status.mode === 'enforced' ? 'green' : status.mode === 'dry-run' ? 'yellow' : 'zinc'} />
        <StatusCard icon={<Check className="h-5 w-5" />} label="Approved" value={String(status.entries)} detail="Active whitelist entries" tone="green" />
        <StatusCard icon={<MessageCircle className="h-5 w-5" />} label="Discord" value={status.discord.bot?.connected ? 'Connected' : status.discord.tokenConfigured ? 'Configured' : 'Token missing'} detail={status.discord.bot?.lastError || 'Status embed foundation'} tone={status.discord.bot?.connected ? 'green' : 'zinc'} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-xl border border-zinc-800 bg-[#111]">
          <div className="border-b border-zinc-800 p-4">
            <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-300">Approved Entries</h2>
          </div>
          <form onSubmit={createEntry} className="grid grid-cols-1 gap-3 border-b border-zinc-800 p-4 lg:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <select value={type} onChange={(event) => setType(event.target.value as any)} className="rounded border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-orange-500">
              <option value="identifier">Identifier</option>
              <option value="discord">Discord ID</option>
              <option value="player">Player ID</option>
            </select>
            <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="license:..., discord id, or player uuid" className="rounded border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-orange-500" />
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional note" className="rounded border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-orange-500" />
            <button disabled={!value.trim()} className="flex items-center justify-center gap-2 rounded bg-orange-600 px-4 py-2 text-xs font-bold uppercase text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50">
              <Plus className="h-4 w-4" />
              Add
            </button>
          </form>
          <div className="divide-y divide-zinc-900">
            {entries.length === 0 ? (
              <EmptyState text="No whitelist entries yet." />
            ) : entries.map(entry => (
              <div key={entry.id} className="grid grid-cols-1 gap-3 p-4 md:grid-cols-[120px_minmax(0,1fr)_auto] md:items-center">
                <span className="w-fit rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400">{entry.type}</span>
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm text-white">{entry.value}</div>
                  <div className="mt-1 truncate text-xs text-zinc-500">{entry.note || `added by ${entry.createdByUsername || 'system'}`}</div>
                </div>
                <button onClick={() => deleteEntry(entry.id)} className="flex h-9 w-9 items-center justify-center rounded border border-red-500/20 text-red-400 hover:bg-red-500/10" title="Remove entry">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <div className="space-y-6">
          <section className="rounded-xl border border-zinc-800 bg-[#111]">
            <div className="border-b border-zinc-800 p-4">
              <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-300">Pending Requests</h2>
            </div>
            <div className="divide-y divide-zinc-900">
              {requests.length === 0 ? (
                <EmptyState text="No pending requests." />
              ) : requests.map(request => (
                <div key={request.id} className="p-4">
                  <div className="font-semibold text-white">{request.playerName}</div>
                  <div className="mt-1 truncate font-mono text-[11px] text-zinc-500">{request.identifiers[0] || request.discordId || 'no identifier captured'}</div>
                  {request.reason ? <p className="mt-2 text-xs text-zinc-400">{request.reason}</p> : null}
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => reviewRequest(request.id, 'approve')} className="flex items-center gap-2 rounded bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-500">
                      <Check className="h-3.5 w-3.5" />
                      Approve
                    </button>
                    <button onClick={() => reviewRequest(request.id, 'reject')} className="flex items-center gap-2 rounded border border-red-500/30 px-3 py-1.5 text-xs font-bold text-red-300 hover:bg-red-500/10">
                      <X className="h-3.5 w-3.5" />
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-zinc-800 bg-[#111]">
            <div className="border-b border-zinc-800 p-4">
              <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-300">Discord Status</h2>
            </div>
            <form onSubmit={saveDiscordSettings} className="space-y-3 p-4">
              {!status.discord.tokenConfigured && (
                <div className="flex gap-2 rounded border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs text-yellow-200">
                  <CircleAlert className="h-4 w-4 shrink-0" />
                  Set PORTSIDE_DISCORD_BOT_TOKEN before enabling the bot.
                </div>
              )}
              <label className="flex items-center justify-between rounded border border-zinc-800 bg-black/20 px-3 py-2 text-sm text-zinc-300">
                Enable status embed
                <input type="checkbox" checked={discordForm.enabled} onChange={(event) => setDiscordForm(prev => ({ ...prev, enabled: event.target.checked }))} />
              </label>
              <DiscordInput label="Guild ID" value={discordForm.guildId} onChange={(guildId) => setDiscordForm(prev => ({ ...prev, guildId }))} />
              <DiscordInput label="Channel ID" value={discordForm.statusChannelId} onChange={(statusChannelId) => setDiscordForm(prev => ({ ...prev, statusChannelId }))} />
              <DiscordInput label="Message ID" value={discordForm.statusMessageId} onChange={(statusMessageId) => setDiscordForm(prev => ({ ...prev, statusMessageId }))} />
              <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500">
                Update seconds
                <input type="number" min={30} max={3600} value={discordForm.updateIntervalSeconds} onChange={(event) => setDiscordForm(prev => ({ ...prev, updateIntervalSeconds: Number(event.target.value) }))} className="mt-2 w-full rounded border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-orange-500" />
              </label>
              <button className="w-full rounded bg-zinc-800 px-4 py-2 text-xs font-bold uppercase text-white hover:bg-zinc-700">Save Discord Settings</button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}

function StatusCard({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail: string; tone: 'green' | 'yellow' | 'zinc' }) {
  const tones = {
    green: 'border-green-500/20 text-green-300 bg-green-500/10',
    yellow: 'border-yellow-500/20 text-yellow-200 bg-yellow-500/10',
    zinc: 'border-zinc-700 text-zinc-300 bg-zinc-900',
  };
  return (
    <div className="rounded-xl border border-zinc-800 bg-[#111] p-4">
      <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded border ${tones[tone]}`}>{icon}</div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="mt-1 text-xl font-bold text-white">{value}</div>
      <div className="mt-2 truncate text-xs text-zinc-500">{detail}</div>
    </div>
  );
}

function DiscordInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500">
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full rounded border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-orange-500" />
    </label>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="p-6 text-center text-sm text-zinc-500">{text}</div>;
}
