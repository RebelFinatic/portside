import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Ban, ChevronLeft, ChevronRight, FileText, History, Loader2, MessageSquareWarning, MoreHorizontal, Plus, RefreshCw, Search, Send, ShieldAlert, StickyNote, Users, X, Zap } from 'lucide-react';
import { apiFetch, hasPermission } from '../lib/api';
import { toast } from 'sonner';
import ConfirmModal from '../components/ConfirmModal';

const PAGE_SIZE = 50;
type ProfileFocus = 'actions' | 'dm' | null;

interface PlayerRow {
  id?: string;
  sourceId?: number | null;
  displayName: string;
  name?: string;
  ping?: number | null;
  online?: boolean;
  identifiers: string[];
  hwids?: string[];
  actionCounts?: {
    activeBans: number;
    warnings: number;
    kicks: number;
  };
}

interface PlayerProfile extends PlayerRow {
  recentNames: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  sessions: any[];
  notes: any[];
  actions: any[];
}

const defaultDurations = ['1h', '24h', '3d', '1w', 'permanent'];

const playerIsOnline = (player: Pick<PlayerRow, 'online' | 'sourceId'>) => Boolean(player.online || player.sourceId);

const hasActiveBan = (player: Pick<PlayerRow, 'actionCounts'> & { actions?: any[] }) => {
  if ((player.actionCounts?.activeBans || 0) > 0) return true;
  return Boolean(player.actions?.some(action => (
    action.type === 'ban' &&
    !action.revokedAt &&
    (!action.expiresAt || new Date(action.expiresAt).getTime() > Date.now())
  )));
};

export default function Players() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [onlineFallback, setOnlineFallback] = useState<PlayerRow[]>([]);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState('24h');
  const [note, setNote] = useState('');
  const [directMessage, setDirectMessage] = useState('');
  const [kickAllOpen, setKickAllOpen] = useState(false);
  const [kickAllReason, setKickAllReason] = useState('');
  const [kickAllConfirm, setKickAllConfirm] = useState('');
  const [openActionMenu, setOpenActionMenu] = useState('');
  const [actionLoading, setActionLoading] = useState('');
  const [page, setPage] = useState(0);
  const [pendingKick, setPendingKick] = useState<PlayerRow | null>(null);
  const [pendingBan, setPendingBan] = useState<PlayerRow | null>(null);
  const [rowActionReason, setRowActionReason] = useState('');
  const [rowBanDuration, setRowBanDuration] = useState('24h');
  const [profileFocus, setProfileFocus] = useState<ProfileFocus>(null);
  const profileActionsRef = useRef<HTMLElement>(null);
  const profileDmRef = useRef<HTMLElement>(null);

  useEffect(() => {
    fetchPlayers();
  }, []);

  useEffect(() => {
    if (!openActionMenu) return;
    const closeMenu = () => setOpenActionMenu('');
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openActionMenu]);

  const fetchPlayers = async () => {
    setLoading(true);
    try {
      const [knownResult, onlineResult] = await Promise.allSettled([
        apiFetch(`/moderation/players?query=${encodeURIComponent(search)}`),
        apiFetch('/players'),
      ]);

      const known = knownResult.status === 'fulfilled' && Array.isArray(knownResult.value) ? knownResult.value : [];
      const online = onlineResult.status === 'fulfilled' && Array.isArray(onlineResult.value) ? onlineResult.value : [];

      setPlayers(known);
      setOnlineFallback((Array.isArray(online) ? online : []).map((player: any) => ({
        sourceId: player.id,
        displayName: player.name,
        name: player.name,
        ping: player.ping,
        online: true,
        identifiers: player.identifiers || [],
        hwids: player.hwids || [],
      })));

      if (knownResult.status === 'rejected' && onlineResult.status === 'rejected') {
        toast.error('Failed to load players');
      }
    } catch {
      toast.error('Failed to load players');
    } finally {
      setLoading(false);
    }
  };

  const openProfile = async (player: PlayerRow, focus: ProfileFocus = null) => {
    if (!player.id) return;
    setProfileFocus(focus);
    setProfileLoading(true);
    try {
      setProfile(await apiFetch(`/moderation/players/${player.id}`));
      setReason('');
      setNote('');
      setDirectMessage('');
      setDuration('24h');
    } catch {
      toast.error('Failed to load player profile');
      setProfileFocus(null);
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    if (profileLoading || !profile) return;
    const target = profileFocus === 'dm' ? profileDmRef.current : profileFocus === 'actions' ? profileActionsRef.current : null;
    if (!target) return;
    window.setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const focusable = target.querySelector<HTMLElement>('input, textarea, select, button');
      focusable?.focus();
    }, 50);
  }, [profileLoading, profile, profileFocus]);

  const refreshProfile = async () => {
    if (!profile?.id) return;
    setProfile(await apiFetch(`/moderation/players/${profile.id}`));
    fetchPlayers();
  };

  const runLegacyKick = async (player: PlayerRow, kickReason: string) => {
    if (!player.sourceId) return;
    setActionLoading(`kick-${player.sourceId}`);
    try {
      await apiFetch(`/players/${player.sourceId}/kick`, {
        method: 'POST',
        body: JSON.stringify({ reason: kickReason || 'Kicked by Portside' }),
      });
      toast.success('Player kicked');
      setPendingKick(null);
      setRowActionReason('');
      fetchPlayers();
    } catch {
      toast.error('Failed to kick player');
    } finally {
      setActionLoading('');
    }
  };

  const createBan = async (player: PlayerRow, banReason: string, banDuration: string) => {
    if (hasActiveBan(player)) {
      toast.error('Player already has an active ban');
      return;
    }

    setActionLoading('ban');
    try {
      if (player.id) {
        await apiFetch(`/moderation/players/${player.id}/bans`, {
          method: 'POST',
          body: JSON.stringify({ reason: banReason || 'Banned by Portside', duration: banDuration }),
        });
      } else if (player.sourceId) {
        await apiFetch(`/players/${player.sourceId}/ban`, {
          method: 'POST',
          body: JSON.stringify({ reason: banReason || 'Banned by Portside', duration: banDuration }),
        });
      }
      setPendingBan(null);
      setRowActionReason('');
      toast.success('Ban recorded');
      if (profile?.id) {
        await refreshProfile();
      } else {
        await fetchPlayers();
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to ban player');
    } finally {
      setActionLoading('');
    }
  };

  const createWarning = async () => {
    if (!profile?.id) return;
    if (!playerIsOnline(profile)) {
      toast.error('Player must be online to receive a warning');
      return;
    }

    setActionLoading('warn');
    try {
      await apiFetch(`/moderation/players/${profile.id}/warnings`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason || 'Warned by Portside' }),
      });
      toast.success('Warning recorded');
      await refreshProfile();
    } catch (error: any) {
      toast.error(error.message || 'Failed to warn player');
    } finally {
      setActionLoading('');
    }
  };

  const createNote = async () => {
    if (!profile?.id || !note.trim()) return;
    setActionLoading('note');
    try {
      await apiFetch(`/moderation/players/${profile.id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      });
      toast.success('Note added');
      setNote('');
      await refreshProfile();
    } catch {
      toast.error('Failed to add note');
    } finally {
      setActionLoading('');
    }
  };

  const sendDirectMessage = async () => {
    if (!profile?.id || !directMessage.trim()) return;
    if (!playerIsOnline(profile)) {
      toast.error('Player must be online to receive a direct message');
      return;
    }

    setActionLoading('dm');
    try {
      await apiFetch(`/moderation/players/${profile.id}/direct-message`, {
        method: 'POST',
        body: JSON.stringify({ message: directMessage }),
      });
      toast.success('Direct message recorded');
      setDirectMessage('');
      await refreshProfile();
    } catch (error: any) {
      toast.error(error.message || 'Failed to send direct message');
    } finally {
      setActionLoading('');
    }
  };

  const kickAllPlayers = async () => {
    if (!kickAllReason.trim() || kickAllConfirm !== 'KICK ALL') return;
    setActionLoading('kick-all');
    try {
      const result = await apiFetch('/players/kick-all', {
        method: 'POST',
        body: JSON.stringify({ reason: kickAllReason }),
      });
      const failed = Array.isArray(result.results) ? result.results.filter((item: any) => !item.ok).length : 0;
      toast.success(failed ? `Kick-all finished with ${failed} failures` : 'Kick-all sent');
      setKickAllOpen(false);
      setKickAllReason('');
      setKickAllConfirm('');
      fetchPlayers();
    } catch {
      toast.error('Failed to kick all players');
    } finally {
      setActionLoading('');
    }
  };

  const revokeAction = async (actionId: string) => {
    setActionLoading(`revoke-${actionId}`);
    try {
      await apiFetch(`/moderation/actions/${actionId}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Revoked from Portside' }),
      });
      toast.success('Action revoked');
      await refreshProfile();
    } catch {
      toast.error('Failed to revoke action');
    } finally {
      setActionLoading('');
    }
  };

  const visiblePlayers = useMemo(() => {
    const knownSourceIds = new Set(players.map(player => player.sourceId).filter(Boolean));
    const fallback = onlineFallback.filter(player => !knownSourceIds.has(player.sourceId || null));
    const combined = [...players, ...fallback];
    const query = search.trim().toLowerCase();
    if (!query) return combined;
    return combined.filter(player => [
      player.displayName,
      String(player.sourceId || ''),
      ...(player.identifiers || []),
    ].join(' ').toLowerCase().includes(query));
  }, [players, onlineFallback, search]);

  const totalPages = Math.max(1, Math.ceil(visiblePlayers.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pagedPlayers = visiblePlayers.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [search, players.length, onlineFallback.length]);

  const profileOnline = profile ? playerIsOnline(profile) : false;
  const profileBanned = profile ? hasActiveBan(profile) : false;

  return (
    <div className="flex-1 flex flex-col w-full h-full p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white m-0">Players</h1>
          <p className="text-sm text-zinc-500 m-0">Search known players, review history, and record moderation actions.</p>
        </div>

        <div className="flex gap-2">
          {hasPermission('players.kick') && (
            <button
              onClick={() => setKickAllOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-300 hover:bg-red-500/20"
            >
              <Users className="h-4 w-4" />
              Kick All
            </button>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <input
              type="text"
              placeholder="Search name, ID, identifier..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && fetchPlayers()}
              className="pl-9 pr-4 py-2 w-full sm:w-72 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500 transition-colors"
            />
          </div>
          <button
            onClick={fetchPlayers}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:border-zinc-700 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-orange-500" /> : <RefreshCw className="h-4 w-4 text-zinc-400" />}
            Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-[#111] border border-zinc-800 rounded-xl overflow-hidden min-h-0">
        <div className="hidden lg:grid grid-cols-[90px_1.2fr_1.4fr_120px_160px_210px] px-6 py-3 border-b border-zinc-800 bg-zinc-900 shrink-0">
          <TableHead>ID</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Identifiers</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>History</TableHead>
          <TableHead align="text-right">Actions</TableHead>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-12 text-center flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>
          ) : visiblePlayers.length === 0 ? (
            <div className="p-12 text-center text-zinc-500 text-sm">No players found yet. The monitor resource will populate durable records as players connect.</div>
          ) : (
            pagedPlayers.map(player => {
              const rowKey = player.id || `online-${player.sourceId}`;
              const rowOnline = playerIsOnline(player);
              const rowBanned = hasActiveBan(player);
              const hasRowActions = Boolean(
                player.id ||
                (hasPermission('players.warn') && player.id && rowOnline) ||
                (hasPermission('players.direct_message') && player.id && rowOnline) ||
                (hasPermission('players.kick') && player.sourceId) ||
                hasPermission('players.ban')
              );

              return (
              <div
                key={rowKey}
                role={player.id ? 'button' : undefined}
                tabIndex={player.id ? 0 : undefined}
                title={player.id ? 'Open player profile' : undefined}
                onClick={() => player.id && openProfile(player)}
                onKeyDown={(event) => {
                  if (!player.id || (event.key !== 'Enter' && event.key !== ' ')) return;
                  event.preventDefault();
                  openProfile(player);
                }}
                className={`grid grid-cols-1 lg:grid-cols-[90px_1.2fr_1.4fr_120px_160px_210px] gap-3 lg:gap-4 items-center px-6 py-4 border-b border-zinc-800/70 hover:bg-zinc-800/40 focus:outline-none focus:bg-zinc-800/50 ${player.id ? 'cursor-pointer' : ''}`}
              >
                <div className="font-mono text-xs text-zinc-500">{player.sourceId ? `#${player.sourceId}` : 'offline'}</div>
                <div className="min-w-0 text-left">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-white">{player.displayName || player.name}</span>
                    {(player.actionCounts?.activeBans || 0) > 0 && <ShieldAlert className="w-3.5 h-3.5 text-red-400" />}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-600">{player.id ? 'known player' : 'online only'}</div>
                </div>
                <div className="font-mono text-[11px] text-zinc-500 truncate">{player.identifiers?.[0] || 'no identifier captured'}</div>
                <StatusBadge online={rowOnline} ping={player.ping} />
                <div className="flex gap-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  <span>{player.actionCounts?.activeBans || 0} bans</span>
                  <span>{player.actionCounts?.warnings || 0} warns</span>
                  <span>{player.actionCounts?.kicks || 0} kicks</span>
                </div>
                <div className="relative flex justify-end">
                  <button
                    type="button"
                    title="Player actions"
                    aria-label="Player actions"
                    aria-expanded={openActionMenu === rowKey}
                    disabled={!hasRowActions}
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenActionMenu(openActionMenu === rowKey ? '' : rowKey);
                    }}
                    className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>

                  {openActionMenu === rowKey && (
                    <div onClick={(event) => event.stopPropagation()} className="absolute right-0 top-8 z-20 w-48 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 py-1 shadow-xl">
                      {player.id && (
                        <MenuAction label="Open Profile" icon={<FileText className="h-4 w-4" />} onClick={() => { setOpenActionMenu(''); openProfile(player); }} />
                      )}
                      {hasPermission('players.warn') && player.id && rowOnline && (
                        <MenuAction label="Warn Player" icon={<MessageSquareWarning className="h-4 w-4" />} onClick={() => { setOpenActionMenu(''); void openProfile(player, 'actions'); }} />
                      )}
                      {hasPermission('players.direct_message') && player.id && rowOnline && (
                        <MenuAction label="Direct Message" icon={<Send className="h-4 w-4" />} onClick={() => { setOpenActionMenu(''); void openProfile(player, 'dm'); }} />
                      )}
                      {hasPermission('players.kick') && player.sourceId && (
                        <MenuAction label="Kick Player" icon={actionLoading === `kick-${player.sourceId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} onClick={() => { setOpenActionMenu(''); setRowActionReason(''); setPendingKick(player); }} />
                      )}
                      {hasPermission('players.ban') && (
                        <MenuAction
                          danger
                          disabled={rowBanned}
                          label={rowBanned ? 'Already Banned' : 'Ban Player'}
                          icon={actionLoading === 'ban' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                          onClick={() => { setOpenActionMenu(''); setRowActionReason(''); setRowBanDuration('24h'); setPendingBan(player); }}
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
              );
            })
          )}
        </div>

        {visiblePlayers.length > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-4 border-t border-zinc-800 bg-zinc-900/50 px-6 py-3 shrink-0">
            <span className="text-xs text-zinc-500">
              Showing {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, visiblePlayers.length)} of {visiblePlayers.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={currentPage === 0}
                onClick={() => setPage(p => Math.max(0, p - 1))}
                className="inline-flex items-center gap-1 rounded border border-zinc-800 px-2 py-1 text-xs font-bold text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Prev
              </button>
              <span className="text-xs font-mono text-zinc-500">
                {currentPage + 1} / {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages - 1}
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                className="inline-flex items-center gap-1 rounded border border-zinc-800 px-2 py-1 text-xs font-bold text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {(profile || profileLoading) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-5xl max-h-[88vh] overflow-hidden rounded-xl border border-zinc-800 bg-[#101010] shadow-2xl flex flex-col">
            <div className="flex items-start justify-between gap-4 p-5 border-b border-zinc-800">
              <div>
                <h2 className="text-lg font-bold text-white">{profile?.displayName || 'Loading player...'}</h2>
                <p className="mt-1 text-xs text-zinc-500 font-mono">{profile?.identifiers?.[0] || 'Loading identifiers'}</p>
              </div>
              <button onClick={() => { setProfile(null); setProfileFocus(null); }} className="p-1 text-zinc-500 hover:text-white"><X className="h-5 w-5" /></button>
            </div>

            {profileLoading || !profile ? (
              <div className="p-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-0 overflow-y-auto">
                <div className="p-5 space-y-5">
                  <Section title="Identifiers" icon={<ShieldAlert className="h-4 w-4" />}>
                    <CodeList items={[...profile.identifiers, ...(profile.hwids || []).map(value => `hwid:${value}`)]} />
                  </Section>

                  <Section title="Moderation History" icon={<History className="h-4 w-4" />}>
                    <div className="space-y-2">
                      {profile.actions.length === 0 ? <EmptyText>No moderation history.</EmptyText> : profile.actions.map(action => (
                        <div key={action.id} className="rounded-lg border border-zinc-800 bg-black/20 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <span className="text-xs font-bold uppercase tracking-wider text-orange-400">{action.type}</span>
                              <p className="mt-1 text-sm text-zinc-300">{action.reason || 'No reason provided'}</p>
                            </div>
                            {action.type === 'ban' && !action.revokedAt && hasPermission('players.ban') && (
                              <button onClick={() => revokeAction(action.id)} className="rounded border border-zinc-700 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-300 hover:text-white">
                                Revoke
                              </button>
                            )}
                          </div>
                          <div className="mt-2 text-[10px] text-zinc-600">
                            {action.authorUsername || 'system'} · {new Date(action.createdAt).toLocaleString()}
                            {action.expiresAt ? ` · expires ${new Date(action.expiresAt).toLocaleString()}` : ''}
                            {action.revokedAt ? ` · revoked ${new Date(action.revokedAt).toLocaleString()}` : ''}
                            {action.type === 'warn' ? action.acknowledgedAt ? ` - acknowledged ${new Date(action.acknowledgedAt).toLocaleString()}` : ' - awaiting acknowledgment' : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>

                  <Section title="Sessions" icon={<History className="h-4 w-4" />}>
                    <div className="space-y-2">
                      {profile.sessions.length === 0 ? <EmptyText>No sessions recorded.</EmptyText> : profile.sessions.map(session => (
                        <div key={session.id} className="rounded border border-zinc-800 bg-black/20 px-3 py-2 text-xs text-zinc-400">
                          #{session.sourceId || 'offline'} · {new Date(session.joinedAt).toLocaleString()}
                          {session.leftAt ? ` to ${new Date(session.leftAt).toLocaleString()}` : ' · active'}
                          {session.dropReason ? ` · ${session.dropReason}` : ''}
                        </div>
                      ))}
                    </div>
                  </Section>
                </div>

                <aside className="border-t xl:border-t-0 xl:border-l border-zinc-800 p-5 space-y-5 bg-zinc-950/40">
                  <Section ref={profileActionsRef} title="Actions" icon={<Ban className="h-4 w-4" />}>
                    <div className="space-y-3">
                      <input value={reason} onChange={event => setReason(event.target.value)} placeholder="Reason" className="w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-orange-500" />
                      <select value={duration} onChange={event => setDuration(event.target.value)} className="w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500">
                        {defaultDurations.map(item => <option key={item} value={item}>{item}</option>)}
                      </select>
                      <div className="grid grid-cols-2 gap-2">
                        {hasPermission('players.ban') && <ActionButton onClick={() => createBan(profile, reason, duration)} loading={actionLoading === 'ban'} disabled={profileBanned} label={profileBanned ? 'Banned' : 'Ban'} icon={<Ban className="h-4 w-4" />} />}
                        {hasPermission('players.warn') && profileOnline && <ActionButton onClick={createWarning} loading={actionLoading === 'warn'} label="Warn" icon={<MessageSquareWarning className="h-4 w-4" />} />}
                      </div>
                    </div>
                  </Section>

                  <Section title="Notes" icon={<StickyNote className="h-4 w-4" />}>
                    <div className="space-y-3">
                      {profile.notes.map(item => (
                        <div key={item.id} className="rounded border border-zinc-800 bg-black/30 p-3">
                          <p className="text-sm text-zinc-300">{item.note}</p>
                          <div className="mt-2 text-[10px] text-zinc-600">{item.authorUsername || 'system'} · {new Date(item.updatedAt).toLocaleString()}</div>
                        </div>
                      ))}
                      {profile.notes.length === 0 && <EmptyText>No notes yet.</EmptyText>}
                      {hasPermission('players.warn') && (
                        <div className="space-y-2">
                          <textarea value={note} onChange={event => setNote(event.target.value)} placeholder="Add staff note..." className="min-h-24 w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-orange-500" />
                          <button onClick={createNote} disabled={!note.trim() || actionLoading === 'note'} className="inline-flex items-center gap-2 rounded-lg border border-orange-600/30 bg-orange-600/10 px-3 py-2 text-sm font-bold text-orange-400 hover:bg-orange-600/20 disabled:opacity-50">
                            {actionLoading === 'note' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                            Add Note
                          </button>
                        </div>
                      )}
                    </div>
                  </Section>

                  {hasPermission('players.direct_message') && profileOnline && (
                    <Section ref={profileDmRef} title="Direct Message" icon={<Send className="h-4 w-4" />}>
                      <div className="space-y-2">
                        <textarea value={directMessage} onChange={event => setDirectMessage(event.target.value)} placeholder="Message player..." className="min-h-20 w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-orange-500" />
                        <button onClick={sendDirectMessage} disabled={!directMessage.trim() || actionLoading === 'dm'} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-bold text-white hover:border-zinc-700 disabled:opacity-50">
                          {actionLoading === 'dm' ? <Loader2 className="h-4 w-4 animate-spin text-orange-500" /> : <Send className="h-4 w-4" />}
                          Send DM
                        </button>
                      </div>
                    </Section>
                  )}
                </aside>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(pendingKick)}
        title="Kick player?"
        description={pendingKick ? `Remove ${pendingKick.displayName || pendingKick.name} from the server now.` : ''}
        confirmLabel="Kick Player"
        danger
        loading={Boolean(pendingKick?.sourceId && actionLoading === `kick-${pendingKick.sourceId}`)}
        confirmDisabled={!rowActionReason.trim()}
        onConfirm={() => pendingKick && runLegacyKick(pendingKick, rowActionReason.trim())}
        onCancel={() => { setPendingKick(null); setRowActionReason(''); }}
      >
        <input
          value={rowActionReason}
          onChange={event => setRowActionReason(event.target.value)}
          placeholder="Kick reason (required)"
          className="w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-red-500"
        />
      </ConfirmModal>

      <ConfirmModal
        open={Boolean(pendingBan)}
        title="Ban player?"
        description={pendingBan ? `Record a ban for ${pendingBan.displayName || pendingBan.name}. They will be blocked on next join when ban enforcement is active.` : ''}
        confirmLabel="Ban Player"
        danger
        loading={actionLoading === 'ban'}
        confirmDisabled={!rowActionReason.trim()}
        onConfirm={() => pendingBan && createBan(pendingBan, rowActionReason.trim(), rowBanDuration)}
        onCancel={() => { setPendingBan(null); setRowActionReason(''); }}
      >
        <div className="space-y-3">
          <input
            value={rowActionReason}
            onChange={event => setRowActionReason(event.target.value)}
            placeholder="Ban reason (required)"
            className="w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-red-500"
          />
          <select
            value={rowBanDuration}
            onChange={event => setRowBanDuration(event.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500"
          >
            {defaultDurations.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
      </ConfirmModal>

      {kickAllOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-red-500/30 bg-[#101010] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-white">Kick All Players</h2>
                <p className="mt-1 text-sm text-zinc-500">This sends a kick command to every currently online player.</p>
              </div>
              <button onClick={() => setKickAllOpen(false)} className="p-1 text-zinc-500 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-5 space-y-3">
              <input value={kickAllReason} onChange={event => setKickAllReason(event.target.value)} placeholder="Reason" className="w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-red-500" />
              <input value={kickAllConfirm} onChange={event => setKickAllConfirm(event.target.value)} placeholder="Type KICK ALL to confirm" className="w-full rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-red-500" />
              <button
                onClick={kickAllPlayers}
                disabled={!kickAllReason.trim() || kickAllConfirm !== 'KICK ALL' || actionLoading === 'kick-all'}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {actionLoading === 'kick-all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                Kick All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TableHead({ children, align = 'text-left' }: { children: React.ReactNode; align?: string }) {
  return <div className={`text-[10px] uppercase font-bold tracking-widest text-zinc-400 ${align}`}>{children}</div>;
}

function StatusBadge({ online, ping }: { online: boolean; ping?: number | null }) {
  return (
    <span className={`inline-flex w-fit items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${online ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : 'border-zinc-700 bg-zinc-900 text-zinc-500'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
      {online ? `${ping ?? 0}ms` : 'offline'}
    </span>
  );
}

function MenuAction({ label, icon, onClick, danger = false, disabled = false }: { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${danger ? 'text-red-300 hover:bg-red-500/10 disabled:hover:bg-transparent' : 'text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:hover:bg-transparent disabled:hover:text-zinc-300'}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Section({ title, icon, children, ref }: { title: string; icon: React.ReactNode; children: React.ReactNode; ref?: React.Ref<HTMLElement> }) {
  return (
    <section ref={ref}>
      <h3 className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
        <span className="text-orange-500">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function CodeList({ items }: { items: string[] }) {
  if (!items.length) return <EmptyText>No identifiers captured.</EmptyText>;
  return (
    <div className="space-y-2">
      {items.map(item => (
        <div key={item} className="rounded border border-zinc-800 bg-black/30 px-3 py-2 font-mono text-xs text-zinc-400 break-all">{item}</div>
      ))}
    </div>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <div className="rounded border border-dashed border-zinc-800 px-3 py-4 text-center text-xs text-zinc-600">{children}</div>;
}

function ActionButton({ label, icon, loading, onClick, disabled = false }: { label: string; icon: React.ReactNode; loading: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={loading || disabled} className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-bold text-white hover:border-zinc-700 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-zinc-800">
      {loading ? <Loader2 className="h-4 w-4 animate-spin text-orange-500" /> : icon}
      {label}
    </button>
  );
}
