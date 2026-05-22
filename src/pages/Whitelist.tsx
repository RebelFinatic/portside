import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Check,
  ChevronUp,
  CircleAlert,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Select, SelectOption } from '../components/Select';
import { apiFetch } from '../lib/api';
import ConfirmModal from '../components/ConfirmModal';

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

const inputClass =
  'w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-orange-600';

type WhitelistTab = 'entries' | 'requests' | 'discord';

const entryPlaceholders: Record<WhitelistEntry['type'], string> = {
  identifier: 'license:abc123...',
  discord: 'Discord user ID (snowflake)',
  player: 'Player UUID from moderation profile',
};

export default function Whitelist() {
  const [status, setStatus] = useState<WhitelistStatus>(emptyStatus);
  const [entries, setEntries] = useState<WhitelistEntry[]>([]);
  const [requests, setRequests] = useState<WhitelistRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<WhitelistTab>('entries');
  const [entrySearch, setEntrySearch] = useState('');
  const [addFormOpen, setAddFormOpen] = useState(false);
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
  const [entryPendingDelete, setEntryPendingDelete] = useState<WhitelistEntry | null>(null);
  const [rejectingRequestId, setRejectingRequestId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const modeLabel = useMemo(() => {
    if (status.mode === 'enforced') return 'Enforced';
    if (status.mode === 'dry-run') return 'Dry Run';
    return 'Disabled';
  }, [status.mode]);

  const modeTone = useMemo(() => {
    if (status.mode === 'enforced') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    if (status.mode === 'dry-run') return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200';
    return 'border-zinc-700 bg-zinc-900 text-zinc-400';
  }, [status.mode]);

  const filteredEntries = useMemo(() => {
    const query = entrySearch.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter(entry => {
      const haystack = [entry.type, entry.value, entry.note, entry.createdByUsername].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [entries, entrySearch]);

  const alerts = useMemo(() => {
    const items: { tone: 'info' | 'warn' | 'yellow'; message: string; action?: () => void; actionLabel?: string }[] = [];

    if (status.mode === 'disabled') {
      items.push({
        tone: 'info',
        message: 'Whitelist is disabled. Set PORTSIDE_WHITELIST_MODE to dry-run or enforced in your server environment to gate joins.',
      });
    }
    if (status.mode === 'enforced' && status.entries === 0) {
      items.push({
        tone: 'warn',
        message: 'Enforced mode is on with no approved entries. Players not on the list will be blocked from joining.',
        action: () => setActiveTab('entries'),
        actionLabel: 'Add entry',
      });
    }
    if (status.pendingRequests > 0) {
      items.push({
        tone: 'yellow',
        message: `${status.pendingRequests} join request${status.pendingRequests === 1 ? '' : 's'} waiting for review.`,
        action: () => setActiveTab('requests'),
        actionLabel: 'Review',
      });
    }
    if (discordForm.enabled && !status.discord.tokenConfigured) {
      items.push({
        tone: 'yellow',
        message: 'Discord status embed is enabled but PORTSIDE_DISCORD_BOT_TOKEN is not configured.',
        action: () => setActiveTab('discord'),
        actionLabel: 'Discord settings',
      });
    }

    return items;
  }, [status, discordForm.enabled]);

  const load = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
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
      setRefreshing(false);
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
      setAddFormOpen(false);
      toast.success('Whitelist entry added');
      load({ silent: true });
    } catch (error: any) {
      toast.error('Could not add entry', { description: error.message });
    }
  };

  const deleteEntry = async (id: string) => {
    try {
      await apiFetch(`/whitelist/entries/${id}`, { method: 'DELETE' });
      setEntries(prev => prev.filter(entry => entry.id !== id));
      setEntryPendingDelete(null);
      toast.success('Whitelist entry removed');
      load({ silent: true });
    } catch (error: any) {
      toast.error('Could not remove entry', { description: error.message });
    }
  };

  const reviewRequest = async (id: string, decision: 'approve' | 'reject', reason: string) => {
    try {
      await apiFetch(`/whitelist/requests/${id}/${decision}`, {
        method: 'POST',
        body: JSON.stringify({
          reason: reason.trim() || (decision === 'approve' ? 'Approved in Portside' : 'Rejected in Portside'),
        }),
      });
      toast.success(decision === 'approve' ? 'Request approved' : 'Request rejected');
      setRejectingRequestId(null);
      setRejectReason('');
      load({ silent: true });
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

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex items-center gap-3 text-sm text-zinc-400">
          <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
          Loading whitelist...
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8">
      <section className="mb-6 rounded-xl border border-zinc-800 bg-[#111] p-5 lg:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className={`flex h-14 w-14 items-center justify-center rounded-xl border ${modeTone}`}>
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-white m-0">Whitelist</h1>
                <span className={`inline-flex items-center gap-2 rounded border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${modeTone}`}>
                  {modeLabel}
                </span>
              </div>
              <p className="mt-1 text-sm text-zinc-500 m-0">
                Control who can join, review requests, and publish Discord server status.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex gap-3">
              <HeroStat label="Approved" value={String(status.entries)} />
              <HeroStat label="Pending" value={String(status.pendingRequests)} highlight={status.pendingRequests > 0} />
            </div>
            <button
              onClick={() => load({ silent: true })}
              disabled={refreshing}
              className="inline-flex items-center justify-center gap-2 rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:border-zinc-700 hover:bg-zinc-800 disabled:opacity-60"
            >
              {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin text-orange-500" /> : <RefreshCw className="h-3.5 w-3.5 text-zinc-400" />}
              Refresh
            </button>
          </div>
        </div>
      </section>

      {alerts.length > 0 && (
        <div className="mb-6 space-y-2">
          {alerts.map(alert => (
            <div
              key={alert.message}
              className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
                alert.tone === 'warn'
                  ? 'border-red-500/30 bg-red-500/10 text-red-200'
                  : alert.tone === 'yellow'
                    ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-100'
                    : 'border-zinc-700 bg-zinc-950 text-zinc-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <CircleAlert className="h-4 w-4 shrink-0" />
                <span>{alert.message}</span>
              </div>
              {alert.action && alert.actionLabel && (
                <button
                  type="button"
                  onClick={alert.action}
                  className="shrink-0 text-xs font-bold uppercase tracking-wider text-white/80 hover:text-white"
                >
                  {alert.actionLabel}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatusCard
          icon={<ShieldCheck className="h-5 w-5" />}
          label="Mode"
          value={modeLabel}
          detail="Set PORTSIDE_WHITELIST_MODE in .env"
          tone={status.mode === 'enforced' ? 'green' : status.mode === 'dry-run' ? 'yellow' : 'zinc'}
        />
        <StatusCard
          icon={<Check className="h-5 w-5" />}
          label="Approved"
          value={String(status.entries)}
          detail="Active whitelist entries"
          tone="green"
        />
        <button
          type="button"
          onClick={() => status.pendingRequests > 0 && setActiveTab('requests')}
          className={`text-left ${status.pendingRequests > 0 ? 'cursor-pointer' : 'cursor-default'}`}
        >
          <StatusCard
            icon={<MessageCircle className="h-5 w-5" />}
            label="Pending"
            value={String(status.pendingRequests)}
            detail={status.pendingRequests > 0 ? 'Click to review requests' : 'No requests waiting'}
            tone={status.pendingRequests > 0 ? 'yellow' : 'zinc'}
          />
        </button>
      </div>

      <section className="rounded-xl border border-zinc-800 bg-[#111] overflow-hidden">
        <div className="border-b border-zinc-800 px-5 py-4">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Whitelist Management</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {([
              ['entries', 'Approved Entries'],
              ['requests', `Pending Requests${status.pendingRequests > 0 ? ` (${status.pendingRequests})` : ''}`],
              ['discord', 'Discord Status'],
            ] as const).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded border px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                  activeTab === tab
                    ? 'border-orange-600/40 bg-orange-600/10 text-orange-300'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'entries' && (
          <div className="p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  value={entrySearch}
                  onChange={event => setEntrySearch(event.target.value)}
                  placeholder="Search entries by value, type, or note..."
                  className={`${inputClass} pl-10`}
                />
              </div>
              <button
                type="button"
                onClick={() => setAddFormOpen(open => !open)}
                className="inline-flex items-center justify-center gap-2 rounded border border-orange-700/60 bg-orange-600/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-orange-300 hover:bg-orange-600/20"
              >
                {addFormOpen ? <ChevronUp className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                Add Entry
              </button>
            </div>

            {addFormOpen && (
              <form onSubmit={createEntry} className="mb-5 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <Select value={type} onChange={event => setType(event.target.value as WhitelistEntry['type'])}>
                    <SelectOption value="identifier">Identifier</SelectOption>
                    <SelectOption value="discord">Discord ID</SelectOption>
                    <SelectOption value="player">Player ID</SelectOption>
                  </Select>
                  <input
                    value={value}
                    onChange={event => setValue(event.target.value)}
                    placeholder={entryPlaceholders[type]}
                    className={inputClass}
                  />
                  <input
                    value={note}
                    onChange={event => setNote(event.target.value)}
                    placeholder="Optional note"
                    className={inputClass}
                  />
                  <button
                    type="submit"
                    disabled={!value.trim()}
                    className="flex items-center justify-center gap-2 rounded bg-orange-600 px-4 py-2 text-xs font-bold uppercase text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </button>
                </div>
              </form>
            )}

            <div className="rounded-lg border border-zinc-800 overflow-hidden">
              <div className="hidden lg:grid grid-cols-[100px_minmax(0,1.2fr)_minmax(0,1fr)_140px_80px] gap-4 px-5 py-3 border-b border-zinc-800 bg-zinc-950/60 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                <span>Type</span>
                <span>Value</span>
                <span>Note</span>
                <span>Added by</span>
                <span className="text-right">Actions</span>
              </div>
              {filteredEntries.length === 0 ? (
                <EmptyState text={entrySearch ? 'No entries match your search.' : 'No whitelist entries yet.'} />
              ) : (
                filteredEntries.map(entry => (
                  <div
                    key={entry.id}
                    className="grid grid-cols-1 lg:grid-cols-[100px_minmax(0,1.2fr)_minmax(0,1fr)_140px_80px] gap-3 lg:gap-4 items-start lg:items-center px-5 py-4 border-b border-zinc-800/70 last:border-b-0"
                  >
                    <span className="w-fit rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                      {entry.type}
                    </span>
                    <div className="min-w-0 font-mono text-sm text-white truncate">{entry.value}</div>
                    <div className="min-w-0 text-xs text-zinc-500 truncate">{entry.note || '—'}</div>
                    <div className="text-xs text-zinc-400">{entry.createdByUsername || 'system'}</div>
                    <div className="flex justify-start lg:justify-end">
                      <button
                        onClick={() => setEntryPendingDelete(entry)}
                        className="flex h-9 w-9 items-center justify-center rounded border border-red-500/20 text-red-400 hover:bg-red-500/10"
                        title="Remove entry"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'requests' && (
          <div className="divide-y divide-zinc-900">
            {requests.length === 0 ? (
              <EmptyState text="No pending requests." />
            ) : (
              requests.map(request => (
                <div key={request.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-white">{request.playerName}</div>
                      <div className="mt-1 truncate font-mono text-[11px] text-zinc-500">
                        {request.identifiers[0] || request.discordId || 'no identifier captured'}
                      </div>
                      <div className="mt-1 text-[10px] text-zinc-600">
                        Requested {new Date(request.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <span className="rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-yellow-300">
                      Pending
                    </span>
                  </div>
                  {request.reason ? <p className="mt-3 text-sm text-zinc-400">{request.reason}</p> : null}
                  {rejectingRequestId === request.id ? (
                    <div className="mt-4 space-y-2">
                      <textarea
                        value={rejectReason}
                        onChange={event => setRejectReason(event.target.value)}
                        placeholder="Rejection reason (required)"
                        rows={2}
                        className={`${inputClass} text-xs`}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => reviewRequest(request.id, 'reject', rejectReason)}
                          disabled={!rejectReason.trim()}
                          className="flex items-center gap-2 rounded bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500 disabled:opacity-50"
                        >
                          Confirm Reject
                        </button>
                        <button
                          type="button"
                          onClick={() => { setRejectingRequestId(null); setRejectReason(''); }}
                          className="rounded border border-zinc-700 px-3 py-1.5 text-xs font-bold text-zinc-400 hover:text-white"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 flex gap-2">
                      <button
                        onClick={() => reviewRequest(request.id, 'approve', 'Approved in Portside')}
                        className="flex items-center gap-2 rounded bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-500"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Approve
                      </button>
                      <button
                        onClick={() => { setRejectingRequestId(request.id); setRejectReason(''); }}
                        className="flex items-center gap-2 rounded border border-red-500/30 px-3 py-1.5 text-xs font-bold text-red-300 hover:bg-red-500/10"
                      >
                        <X className="h-3.5 w-3.5" />
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'discord' && (
          <form onSubmit={saveDiscordSettings} className="space-y-4 p-5">
            {!status.discord.tokenConfigured && (
              <div className="flex gap-2 rounded border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs text-yellow-200">
                <CircleAlert className="h-4 w-4 shrink-0" />
                Set PORTSIDE_DISCORD_BOT_TOKEN before enabling the bot.
              </div>
            )}
            <label className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm text-zinc-300">
              Enable status embed
              <input
                type="checkbox"
                checked={discordForm.enabled}
                onChange={event => setDiscordForm(prev => ({ ...prev, enabled: event.target.checked }))}
                className="h-4 w-4 accent-orange-600"
              />
            </label>
            <DiscordInput label="Guild ID" value={discordForm.guildId} onChange={guildId => setDiscordForm(prev => ({ ...prev, guildId }))} />
            <DiscordInput label="Channel ID" value={discordForm.statusChannelId} onChange={statusChannelId => setDiscordForm(prev => ({ ...prev, statusChannelId }))} />
            <DiscordInput label="Message ID" value={discordForm.statusMessageId} onChange={statusMessageId => setDiscordForm(prev => ({ ...prev, statusMessageId }))} />
            <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500">
              Update interval (seconds)
              <input
                type="number"
                min={30}
                max={3600}
                value={discordForm.updateIntervalSeconds}
                onChange={event => setDiscordForm(prev => ({ ...prev, updateIntervalSeconds: Number(event.target.value) }))}
                className={`${inputClass} mt-2`}
              />
            </label>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-500">
              Bot status: {status.discord.bot?.connected ? 'Connected' : status.discord.tokenConfigured ? 'Configured' : 'Not configured'}
              {status.discord.bot?.lastError ? ` · ${status.discord.bot.lastError}` : ''}
            </div>
            <button className="w-full rounded border border-zinc-700 bg-zinc-800 px-4 py-2 text-xs font-bold uppercase text-white hover:bg-zinc-700">
              Save Discord Settings
            </button>
          </form>
        )}
      </section>

      <ConfirmModal
        open={Boolean(entryPendingDelete)}
        title="Remove whitelist entry?"
        description={entryPendingDelete ? `Remove ${entryPendingDelete.value} from the approved list. This player may be blocked on join if whitelist is enforced.` : ''}
        confirmLabel="Remove Entry"
        danger
        onConfirm={() => entryPendingDelete && deleteEntry(entryPendingDelete.id)}
        onCancel={() => setEntryPendingDelete(null)}
      />
    </div>
  );
}

function HeroStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border px-4 py-3 text-center sm:text-left ${highlight ? 'border-yellow-500/30 bg-yellow-500/10' : 'border-zinc-800 bg-zinc-950'}`}>
      <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${highlight ? 'text-yellow-300' : 'text-white'}`}>{value}</div>
    </div>
  );
}

function StatusCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: 'green' | 'yellow' | 'zinc';
}) {
  const tones = {
    green: 'border-green-500/20 text-green-300 bg-green-500/10',
    yellow: 'border-yellow-500/20 text-yellow-200 bg-yellow-500/10',
    zinc: 'border-zinc-700 text-zinc-300 bg-zinc-900',
  };
  return (
    <div className="rounded-xl border border-zinc-800 bg-[#111] p-4 h-full">
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
      <input value={value} onChange={event => onChange(event.target.value)} className={`${inputClass} mt-2`} />
    </label>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="p-8 text-center text-sm text-zinc-500">{text}</div>;
}
